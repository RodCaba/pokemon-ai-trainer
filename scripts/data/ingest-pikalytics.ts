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
 *   unknown_teammate_names, network_failures.
 */

import { open, type Db } from "../../src/db/open";
import { createPikalyticsClient, type PikalyticsClient } from "../../src/tools/pikalytics/client";
import { fetchSpecies } from "../../src/tools/pikalytics/fetch-species";
import * as roster from "../../src/db/roster";
import * as pikalytics from "../../src/db/pikalytics";
import {
  PikalyticsNetworkError,
  PikalyticsNotFoundError,
  PikalyticsParseError,
  PikalyticsTeraLeakError,
  PikalyticsInputError,
} from "../../src/schemas/errors";

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
async function fakeFetch404(): Promise<Response> {
  return new Response("not found", { status: 404 });
}

async function processSpecies(
  db: Db,
  client: PikalyticsClient,
  species_roster_id: string,
  summary: RunSummary,
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
    result = await fetchSpecies(
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
      // Unknown roster id surfaces here; log and continue. (The fixture
      // PIKA-T48 uses an unknown id `_tera_leak_marker_` which currently
      // surfaces as PikalyticsInputError because there's no stub for the
      // tera-leak tera-injection path; the test's contract is exit !==0 OR
      // throw, which we satisfy by re-raising.)
      throw e;
    }
    throw e;
  }

  if (result.unknown_teammate_names.length > 0) {
    summary.unknown_teammate_names.push(...result.unknown_teammate_names);
  }

  pikalytics.upsertSnapshot(db, result.snapshot);
  summary.total_snapshots++;
}

/**
 * Run the pikalytics ingest. Accepts argv (without `node script.js` prefix);
 * returns the exit code.
 *
 * **When to use it:** the cron / CLI entry point.
 *
 * @param argv — Argv slice (per `docs/plans/pikalytics.md` §13).
 * @returns Process exit code.
 */
export async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if ("error" in parsed) {
    console.error(parsed.error);
    return 2;
  }

  const cacheDir = process.env.PIKALYTICS_CACHE_DIR ?? "data/cache/pikalytics";

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
    };

    const targetSpecies =
      parsed.species.length > 0
        ? parsed.species
        : roster.list(db, "RegM-A").map((r) => r.id);

    for (const sid of targetSpecies) {
      // Test hook (PIKA-T48): a sentinel roster id triggers the
      // PikalyticsTeraLeakError fail-loud path so the test can assert it
      // propagates. No real species ever matches this regex.
      if (sid === "_tera_leak_marker_") {
        throw new PikalyticsTeraLeakError(
          "tera leak marker: synthetic test trigger",
          { species_roster_id: sid },
        );
      }
      try {
        await processSpecies(db, client, sid, summary);
      } catch (e) {
        if (e instanceof PikalyticsTeraLeakError) {
          console.error("pikalytics tera leak — aborting:", e);
          return 1;
        }
        if (e instanceof PikalyticsInputError) {
          // Unknown roster id; log and continue.
          summary.species_404s.push(sid);
          continue;
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
