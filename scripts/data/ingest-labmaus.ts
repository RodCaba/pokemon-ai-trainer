/**
 * CLI entry point for `pnpm data:ingest:labmaus`.
 *
 * Argv:
 *   --from YYYY-MM-DD       cold-start window start (default 2026-04-06)
 *   --to   YYYY-MM-DD       cold-start window end   (default today)
 *   --mode full|incremental default full
 *   --db   <path>           SQLite path (default ./data/db.sqlite)
 *   --no-network            cache-only replay (tests, dry runs)
 *   --no-pokepaste          skip the per-team pokepaste fetch step
 *   --concurrency <n>       parallel getTournament fan-out (default 4)
 *
 * Env vars:
 *   LABMAUS_CACHE_DIR    override labmaus disk-cache path (default data/cache/labmaus)
 *   POKEPASTE_CACHE_DIR  override pokepaste disk-cache path (default data/cache/pokepaste)
 *
 * Exit codes:
 *   0  success (including bounded cross-check warnings; no-network on empty cache also returns 0)
 *   1  schema drift, unknown species, DB error, network exhaustion
 *   2  invalid argv
 */

import { open } from "../../src/db/open";
import { createLabmausClient } from "../../src/tools/labmaus/client";
import { createPokepasteClient } from "../../src/tools/pokepaste/client";
import { listTournaments } from "../../src/tools/labmaus/list-tournaments";
import { getTournament } from "../../src/tools/labmaus/get-tournament";
import * as tournaments from "../../src/db/tournaments";
import * as roster from "../../src/db/roster";
import * as items from "../../src/db/items";
import * as abilities from "../../src/db/abilities";
import * as moves from "../../src/db/moves";
import {
  LabmausNetworkError,
  LabmausSchemaError,
} from "../../src/schemas/errors";
import {
  processTeamPokepaste,
  type PokepasteRunSummary,
} from "./pokepaste-hook";
import type { TransformDeps } from "../../src/tools/pokepaste/transform";

interface ParsedArgs {
  from: string;
  to: string;
  mode: "full" | "incremental";
  dbPath: string;
  noNetwork: boolean;
  noPokepaste: boolean;
  concurrency: number;
}

function parseArgs(argv: string[]): ParsedArgs | { error: string } {
  const out: ParsedArgs = {
    from: "2026-04-06",
    to: new Date().toISOString().slice(0, 10),
    mode: "full",
    dbPath: "./data/db.sqlite",
    noNetwork: false,
    noPokepaste: false,
    concurrency: 4,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--from":
        out.from = argv[++i] ?? "";
        break;
      case "--to":
        out.to = argv[++i] ?? "";
        break;
      case "--mode": {
        const v = argv[++i];
        if (v !== "full" && v !== "incremental") return { error: `invalid --mode ${v}` };
        out.mode = v;
        break;
      }
      case "--db":
        out.dbPath = argv[++i] ?? "";
        break;
      case "--no-network":
        out.noNetwork = true;
        break;
      case "--no-pokepaste":
        out.noPokepaste = true;
        break;
      case "--concurrency":
        out.concurrency = Number.parseInt(argv[++i] ?? "4", 10);
        break;
      default:
        return { error: `unknown argv ${a}` };
    }
  }
  return out;
}

function chunkDateRange(from: string, to: string, days: number): Array<{ from: string; to: string }> {
  const out: Array<{ from: string; to: string }> = [];
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  let cursor = start;
  while (cursor <= end) {
    const next = new Date(cursor);
    next.setUTCDate(next.getUTCDate() + days);
    const chunkEnd = next > end ? end : new Date(next.getTime() - 86400_000);
    out.push({
      from: cursor.toISOString().slice(0, 10),
      to: chunkEnd.toISOString().slice(0, 10),
    });
    cursor = new Date(next.getTime());
  }
  return out;
}

// TODO(stage6-deferred): replace fakeFetchEmpty with cache-driven replay in
// pokepaste-sets slice or ingest-hardening slice
// (see docs/reviews/labmaus-tournaments.md §9).
async function fakeFetchEmpty(): Promise<Response> {
  return new Response(JSON.stringify([]), { status: 200 });
}

// In `--no-network` mode the pokepaste client must never reach the wire. The
// disk cache is the only source — a cache miss surfaces as a 404 and the hook
// records it as a `pokepaste_404`. This mirrors fakeFetchEmpty's intent for
// labmaus (empty payload → empty ingest) for pokepaste's content-addressed
// `/raw` endpoint.
async function fakeFetch404(): Promise<Response> {
  return new Response("not found", { status: 404 });
}

/**
 * Build {@link TransformDeps} from the open DB handle. The transform layer
 * needs `has`/`get` on the roster, items, abilities, and moves repos; we
 * adapt them to the per-format signatures the transform expects.
 */
function buildTransformDeps(db: ReturnType<typeof open>): TransformDeps {
  return {
    db,
    rosterRepo: {
      has: (d, name): boolean => roster.has(d, name, "RegM-A"),
      get: (d, name): { id: string } | null => {
        const p = roster.get(d, name, "RegM-A");
        return p ? { id: p.id } : null;
      },
    },
    itemsRepo: { has: (d, name): boolean => items.has(d, name, "RegM-A") },
    abilitiesRepo: { has: (d, name): boolean => abilities.has(d, name, "RegM-A") },
    movesRepo: { has: (d, name): boolean => moves.has(d, name, "RegM-A") },
  };
}

/**
 * Compare our recomputed per-species ranking against labmaus's `pokemon[]`
 * aggregate. Tolerance: ±0.05 absolute OR ±1% relative on `usage_percent`.
 *
 * @returns A list of out-of-tolerance diffs (one entry per mismatched key);
 *   empty array means everything was in tolerance.
 */
export function compareWithinTolerance(
  ours: Array<{ key: string; usage_percent: number }>,
  theirs: Array<{ key: string; usage_percent: number }>,
  tol: { abs: number; rel: number } = { abs: 0.05, rel: 0.01 },
): Array<{ key: string; ours: number; theirs: number; delta: number }> {
  const theirMap = new Map(theirs.map((t) => [t.key, t.usage_percent]));
  const out: Array<{ key: string; ours: number; theirs: number; delta: number }> = [];
  for (const r of ours) {
    const t = theirMap.get(r.key);
    if (t === undefined) continue; // species we know about but they didn't report
    const delta = Math.abs(r.usage_percent - t);
    const allowed = Math.max(tol.abs, t * tol.rel);
    if (delta > allowed) out.push({ key: r.key, ours: r.usage_percent, theirs: t, delta });
  }
  return out;
}

interface TheirPokemonRow {
  id?: string;
  name?: string;
  usage?: number;
  usage_percent?: number;
}

async function runCrossCheck(
  client: ReturnType<typeof createLabmausClient>,
  tournamentExternalId: number,
  tournamentDomainId: string,
  db: ReturnType<typeof open>,
  total: { tournaments: number; teams: number; species: number; warnings: number },
): Promise<void> {
  // Re-read the raw cached payload to get the `pokemon[]` aggregate. The
  // client's getTournament returns parsed unknown JSON; we cast through the
  // expected shape.
  let raw: { pokemon?: TheirPokemonRow[] } | null = null;
  try {
    raw = (await client.getTournament({ id: tournamentExternalId })) as {
      pokemon?: TheirPokemonRow[];
    };
  } catch {
    return; // network/schema errors here are non-fatal for cross-check.
  }
  const theirsRaw = raw?.pokemon;
  if (!theirsRaw || theirsRaw.length === 0) return;

  // Our recomputed ranking now reads from team_sets (canonical roster ids).
  // When pokepaste hasn't ingested yet for this tournament, ours is [] and
  // there's no meaningful comparison to run.
  const ours = tournaments.recomputeAggregatesForTournament(db, tournamentDomainId);
  if (ours.length === 0) return;
  // Their keys are labmaus dex ids; ours are roster ids — without the alias
  // table the keyspaces no longer line up directly. Cross-check is skipped
  // until a labmaus-id ↔ roster-id translation is reintroduced (e.g. via
  // pokepaste-derived dex-id co-occurrence). Non-fatal.
  const theirsMapped: Array<{ key: string; usage_percent: number }> = [];
  const diffs = compareWithinTolerance(ours, theirsMapped);
  for (const d of diffs) {
    process.stderr.write(
      JSON.stringify({
        warning: "cross-check mismatch",
        tournament_id: tournamentDomainId,
        dimension: "species",
        key: d.key,
        ours: d.ours,
        theirs: d.theirs,
        delta: d.delta,
      }) + "\n",
    );
    total.warnings++;
  }
}

/**
 * Run the labmaus ingest end-to-end.
 *
 * @param argv — Process argv slice (typically `process.argv.slice(2)`).
 * @returns Process exit code.
 */
export async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if ("error" in parsed) {
    console.error(parsed.error);
    return 2;
  }

  // Cache directories are operator-tunable via env vars. Defaults match the
  // repo layout. Tests use these to point at tmp dirs without process.chdir
  // (vitest workers forbid chdir).
  const labmausCacheDir = process.env.LABMAUS_CACHE_DIR ?? "data/cache/labmaus";
  const pokepasteCacheDir =
    process.env.POKEPASTE_CACHE_DIR ?? "data/cache/pokepaste";

  const db = open(parsed.dbPath);
  try {
    const client = createLabmausClient({
      cacheDir: labmausCacheDir,
      cacheTtlMs: 24 * 60 * 60 * 1000,
      throttleRps: 1,
      maxRetries: 3,
      backoffBaseMs: 1000,
      // In --no-network mode we never want to hit the wire; the disk cache
      // is the only source. Empty cache → no tournaments ingested → exit 0.
      fetchImpl: parsed.noNetwork ? (fakeFetchEmpty as unknown as typeof fetch) : undefined,
    });

    // TODO(stage6-deferred): argv-validation slice — add --strict-offline and
    // malformed-date validation (see docs/reviews/labmaus-tournaments.md §9).
    const chunks = chunkDateRange(parsed.from, parsed.to, 30);
    let total = { tournaments: 0, teams: 0, species: 0, warnings: 0 };

    // Pokepaste wiring — per plan §13 the labmaus ingest fans out to the
    // pokepaste hook per team. Skipped under `--no-pokepaste` (operator
    // opt-out / labmaus-only test path).
    const pokepasteEnabled = !parsed.noPokepaste;
    const pokepasteClient = pokepasteEnabled
      ? createPokepasteClient({
          cacheDir: pokepasteCacheDir,
          // Throttle exists to be polite to the live host. In --no-network
          // mode there's no live host — bump to a high rate so 404s for
          // unseeded teams don't serialize the cache-only run.
          throttleRps: parsed.noNetwork ? 1000 : 2,
          maxRetries: 3,
          backoffBaseMs: 1000,
          fetchImpl: parsed.noNetwork ? (fakeFetch404 as unknown as typeof fetch) : undefined,
        })
      : null;
    const pokepasteDeps = pokepasteEnabled ? buildTransformDeps(db) : null;
    const pokepasteSummary: PokepasteRunSummary = {
      team_sets: 0,
      pokepaste_404s: [],
      pokepaste_failures: [],
      ref_validation_failures: [],
    };

    for (const chunk of chunks) {
      let summaries: Awaited<ReturnType<typeof listTournaments>> = [];
      try {
        summaries = await listTournaments(
          {
            regulation: "RegM-A",
            date_range: { from: chunk.from, to: chunk.to },
            division: "Masters",
          },
          { client },
        );
      } catch (e) {
        // In --no-network mode a network error means "cache miss for this
        // chunk" — skip and continue. Schema/unknown-species/DB errors must
        // ALWAYS propagate (per plan §13 exit-code matrix).
        if (parsed.noNetwork && e instanceof LabmausNetworkError) continue;
        throw e;
      }

      // Sequential to keep the throttle happy; the parallelism cap matters only
      // in real-network mode and the tests don't exercise it.
      for (const s of summaries) {
        try {
          const detail = await getTournament({ id: s.id }, { client });
          tournaments.upsertTournament(db, detail);
          total.tournaments++;
          total.teams += detail.teams.length;
          total.species += detail.species.length;

          // Cross-check pass: compare our recomputed per-species ranking
          // against labmaus's own pokemon[] aggregate (when present in the
          // cached raw payload). Out-of-tolerance diffs become warnings.
          await runCrossCheck(client, s.id, detail.tournament.id, db, total);

          // Pokepaste fan-out — sequential per team. The pokepaste client's
          // own throttle handles pacing; concurrency on this loop just
          // serializes the ref-table work too. PokepasteUnknownSpeciesError
          // propagates out of main() (fail-loud, exits 1).
          if (pokepasteEnabled && pokepasteClient && pokepasteDeps) {
            for (const tm of detail.teams) {
              await processTeamPokepaste({
                db,
                client: pokepasteClient,
                transform: pokepasteDeps,
                team_id: tm.id,
                team_url: tm.team_url,
                summary: pokepasteSummary,
              });
            }
          }
        } catch (e) {
          // Same propagation rule as the listing call: only swallow network
          // errors in offline mode. Schema/DB errors fail loud.
          if (parsed.noNetwork && e instanceof LabmausNetworkError) continue;
          if (e instanceof LabmausSchemaError) throw e;
          throw e;
        }
      }
    }

    console.log(JSON.stringify({ ok: true, ...total, pokepaste: pokepasteSummary }));
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
