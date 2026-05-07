/**
 * CLI entry point for `pnpm data:ingest:pikalytics`.
 *
 * Argv:
 *   --db <path>           SQLite path (default ./data/db.sqlite).
 *   --no-network          cache-only (tests and dry runs).
 *   --species <roster-id> debug single-species mode (repeatable).
 *
 * Env vars:
 *   PIKALYTICS_CACHE_DIR  override cache directory (default data/cache/pikalytics).
 *
 * Exit codes:
 *   0  success (including bounded 404s / parse failures / unknown teammates).
 *   1  PikalyticsTeraLeakError (programmer bug) or DB error.
 *
 * Run summary fields (stdout JSON, per plan §17 Q8):
 *   total_snapshots, skipped_existing, species_404s, parse_failures,
 *   unknown_teammate_names, network_failures, input_errors.
 */

import { existsSync, readdirSync } from "node:fs";
import { open, type Db } from "../../src/db/open";
import { createPikalyticsClient, type PikalyticsClient } from "../../src/tools/pikalytics/client";
import {
  fetchSpecies as defaultFetchSpecies,
  type FetchSpeciesResult,
} from "../../src/tools/pikalytics/fetch-species";
import * as roster from "../../src/db/roster";
import * as pikalytics from "../../src/db/pikalytics";
import {
  PikalyticsNetworkError,
  PikalyticsNotFoundError,
  PikalyticsParseError,
  PikalyticsTeraLeakError,
  PikalyticsInputError,
} from "../../src/schemas/errors";
import type { PikalyticsFetchSpeciesArgs } from "../../src/schemas/pikalytics";
import type { PikalyticsTransformDeps } from "../../src/tools/pikalytics/transform";

/**
 * Injection slot for the fetch-species call. Default is the production
 * `fetchSpecies`; tests inject a mock to drive specific failure modes
 * (e.g. PIKA-T48's `PikalyticsTeraLeakError` propagation).
 */
export type FetchSpeciesFn = (
  args: PikalyticsFetchSpeciesArgs,
  deps: { client: PikalyticsClient; transform: PikalyticsTransformDeps },
) => Promise<FetchSpeciesResult>;

interface ParsedArgs {
  dbPath: string;
  noNetwork: boolean;
  species: string[];
}

function parseArgs(argv: string[]): ParsedArgs | { error: string } {
  const out: ParsedArgs = {
    dbPath: "./data/db.sqlite",
    noNetwork: false,
    species: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--db":
        out.dbPath = argv[++i] ?? "";
        break;
      case "--no-network":
        out.noNetwork = true;
        break;
      case "--species":
        out.species.push(argv[++i] ?? "");
        break;
      default:
        return { error: `unknown argv ${a}` };
    }
  }
  return out;
}

interface RunSummary {
  total_snapshots: number;
  skipped_existing: number;
  species_404s: string[];
  parse_failures: string[];
  unknown_teammate_names: string[];
  network_failures: string[];
  /**
   * Programmer-error / unknown-roster-id surface. Routed here (not to
   * `species_404s`) so downstream consumers can distinguish "site doesn't
   * cover this species yet" from "the input was structurally invalid or
   * referenced a roster id we don't recognize."
   */
  input_errors: string[];
}

/**
 * Compute the ISO Monday of the calendar week that contains `date`.
 * Used as the skip-existing heuristic per plan §17 Q2 — within one calendar
 * week, a previously persisted (species, *) row means we skip the fetch.
 */
function isoWeekStart(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 1 - day);
  return d.toISOString().slice(0, 10);
}

// In `--no-network` mode the client must never reach the wire. The disk cache
// is the only source — a cache miss surfaces as a 404 and the script records
// it in `species_404s`. Mirrors the labmaus / pokepaste no-network shape.
//
// TODO(stage6-deferred): cache-driven replay test, ingest-fixture-replay slice
// — today the fixture cache is not pre-seeded for PIKA-T44/T46/T47/T49, so
// they exit 0 vacuously when the cache is empty. The pre-flight check below
// (in `main`) at least makes the operator-facing semantic clear: if you ask
// for `--no-network` against an empty cache dir, the script fails loud rather
// than silently 404ing every species.
async function fakeFetch404(): Promise<Response> {
  return new Response("not found", { status: 404 });
}

async function processSpecies(
  db: Db,
  client: PikalyticsClient,
  species_roster_id: string,
  summary: RunSummary,
  fetchSpeciesFn: FetchSpeciesFn,
): Promise<void> {
  // Calendar-week skip-existing pre-check. We don't know the upstream `as_of`
  // until we fetch + parse, so the pre-check is a coarse "did we already see
  // anything for this species this week?". The repo's ON CONFLICT DO NOTHING
  // handles the (species, as_of) precision.
  const weekStart = isoWeekStart(new Date());
  const recent = db.$client
    .prepare(
      "SELECT 1 FROM pikalytics_snapshots WHERE species_roster_id = ? AND fetched_at >= ? LIMIT 1",
    )
    .get(species_roster_id, weekStart);
  if (recent !== undefined) {
    summary.skipped_existing++;
    return;
  }

  let result;
  try {
    result = await fetchSpeciesFn(
      { format: "RegM-A", species_roster_id },
      {
        client,
        transform: {
          db,
          rosterRepo: {
            has: roster.has,
            get: (d, name): { id: string; display_name: string } | null => {
              const p = roster.get(d, name, "RegM-A");
              return p ? { id: p.id, display_name: p.display_name } : null;
            },
          },
        },
      },
    );
  } catch (e) {
    if (e instanceof PikalyticsTeraLeakError) {
      // Programmer bug — propagate.
      throw e;
    }
    if (e instanceof PikalyticsNotFoundError) {
      summary.species_404s.push(species_roster_id);
      return;
    }
    if (e instanceof PikalyticsParseError) {
      summary.parse_failures.push(species_roster_id);
      return;
    }
    if (e instanceof PikalyticsNetworkError) {
      summary.network_failures.push(species_roster_id);
      return;
    }
    if (e instanceof PikalyticsInputError) {
      // Unknown roster id / structurally-invalid input — distinct from a 404
      // (site doesn't cover the species). Recorded in `input_errors[]` per
      // plan §13 / Stage 6 finding 6.
      summary.input_errors.push(species_roster_id);
      return;
    }
    throw e;
  }

  if (result.unknown_teammate_names.length > 0) {
    summary.unknown_teammate_names.push(...result.unknown_teammate_names);
  }

  pikalytics.upsertSnapshot(db, result.snapshot);
  summary.total_snapshots++;
}

/** Injection slots for {@link main} — overridable in tests. */
export interface MainDeps {
  /** Override the production `fetchSpecies` (used by PIKA-T48 to throw). */
  fetchSpecies?: FetchSpeciesFn;
}

/**
 * Run the pikalytics ingest. Accepts argv (without `node script.js` prefix);
 * returns the exit code.
 *
 * **When to use it:** the cron / CLI entry point. Tests inject a
 * `fetchSpecies` mock via `deps` to drive specific failure modes — the
 * production code path has no test-only branches.
 *
 * @param argv — Argv slice (per `docs/plans/pikalytics.md` §13).
 * @param deps — Optional injection slots; defaults wire to production.
 * @returns Process exit code.
 */
export async function main(argv: string[], deps: MainDeps = {}): Promise<number> {
  const parsed = parseArgs(argv);
  if ("error" in parsed) {
    console.error(parsed.error);
    return 2;
  }

  const cacheDir = process.env.PIKALYTICS_CACHE_DIR ?? "data/cache/pikalytics";
  const fetchSpeciesFn = deps.fetchSpecies ?? defaultFetchSpecies;

  // --no-network preflight: if there is no cache directory or it's empty,
  // every fetch will silently 404. Operator-facing fail-loud per plan §19.2
  // / review item 10.
  if (parsed.noNetwork) {
    const hasCache = existsSync(cacheDir) && readdirSync(cacheDir).length > 0;
    if (!hasCache) {
      console.error(
        `pikalytics --no-network: no cache to replay at ${cacheDir} (empty or missing). ` +
          `Either run without --no-network, or pre-seed the cache.`,
      );
      return 1;
    }
  }

  const db = open(parsed.dbPath);
  try {
    const client = createPikalyticsClient({
      cacheDir,
      throttleRps: parsed.noNetwork ? 1000 : 1,
      maxRetries: 3,
      backoffBaseMs: 1000,
      fetchImpl: parsed.noNetwork ? (fakeFetch404 as unknown as typeof fetch) : undefined,
    });

    const summary: RunSummary = {
      total_snapshots: 0,
      skipped_existing: 0,
      species_404s: [],
      parse_failures: [],
      unknown_teammate_names: [],
      network_failures: [],
      input_errors: [],
    };

    const targetSpecies =
      parsed.species.length > 0
        ? parsed.species
        : roster.list(db, "RegM-A").map((r) => r.id);

    for (const sid of targetSpecies) {
      try {
        await processSpecies(db, client, sid, summary, fetchSpeciesFn);
      } catch (e) {
        if (e instanceof PikalyticsTeraLeakError) {
          console.error("pikalytics tera leak — aborting:", e);
          return 1;
        }
        throw e;
      }
    }

    console.log(JSON.stringify({ ok: true, ...summary }));
    return 0;
  } catch (e) {
    console.error(e);
    return 1;
  } finally {
    db.$client.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(e);
      process.exit(1);
    },
  );
}
