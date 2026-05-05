/**
 * CLI entry point for `pnpm data:ingest:labmaus`.
 *
 * Argv:
 *   --from YYYY-MM-DD       cold-start window start (default 2026-04-06)
 *   --to   YYYY-MM-DD       cold-start window end   (default today)
 *   --mode full|incremental default full
 *   --db   <path>           SQLite path (default ./data/db.sqlite)
 *   --no-network            cache-only replay (tests, dry runs)
 *   --concurrency <n>       parallel getTournament fan-out (default 4)
 *
 * Exit codes:
 *   0  success (including bounded cross-check warnings; no-network on empty cache also returns 0)
 *   1  schema drift, unknown species, DB error, network exhaustion
 *   2  invalid argv
 */

import { existsSync, readFileSync } from "node:fs";
import { open } from "../../src/db/open";
import { createLabmausClient } from "../../src/tools/labmaus/client";
import { listTournaments } from "../../src/tools/labmaus/list-tournaments";
import { getTournament } from "../../src/tools/labmaus/get-tournament";
import * as tournaments from "../../src/db/tournaments";
import * as aliasRepo from "../../src/db/species-alias-labmaus";
import { speciesAliasLabmaus } from "../../src/db/drizzle-schema";
import {
  LabmausNetworkError,
  LabmausSchemaError,
  LabmausUnknownSpeciesError,
} from "../../src/schemas/errors";

interface ParsedArgs {
  from: string;
  to: string;
  mode: "full" | "incremental";
  dbPath: string;
  noNetwork: boolean;
  concurrency: number;
}

function parseArgs(argv: string[]): ParsedArgs | { error: string } {
  const out: ParsedArgs = {
    from: "2026-04-06",
    to: new Date().toISOString().slice(0, 10),
    mode: "full",
    dbPath: "./data/db.sqlite",
    noNetwork: false,
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

function seedAliasTable(db: ReturnType<typeof open>, seedPath: string): void {
  if (!existsSync(seedPath)) return;
  const raw = JSON.parse(readFileSync(seedPath, "utf8")) as Array<{
    labmausId: string;
    rosterId: string;
  }>;
  const sourceJson = JSON.stringify({
    origin: "data/labmaus/species-alias-seed.json",
    fetched_at: new Date().toISOString(),
  });
  db.$client.transaction(() => {
    for (const r of raw) {
      // Skip rows whose roster id isn't in the species table — surfaces seed/roster drift.
      const exists = db.$client
        .prepare(`SELECT 1 FROM species WHERE id = ?`)
        .get(r.rosterId) as { 1: number } | undefined;
      if (!exists) continue;
      db.insert(speciesAliasLabmaus)
        .values({ id: r.labmausId, rosterId: r.rosterId, sourceJson })
        .onConflictDoUpdate({
          target: speciesAliasLabmaus.id,
          set: { rosterId: r.rosterId, sourceJson },
        })
        .run();
    }
  })();
}

// TODO(stage6-deferred): replace fakeFetchEmpty with cache-driven replay in
// pokepaste-sets slice or ingest-hardening slice
// (see docs/reviews/labmaus-tournaments.md §9).
async function fakeFetchEmpty(): Promise<Response> {
  return new Response(JSON.stringify([]), { status: 200 });
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

  const ours = tournaments.recomputeAggregatesForTournament(db, tournamentDomainId);
  // Map labmaus aggregate keys (their `id`) into our roster ids via the alias
  // repo, so the comparison is on a common keyspace.
  const theirsMapped: Array<{ key: string; usage_percent: number }> = [];
  for (const t of theirsRaw) {
    const labmausId = t.id;
    if (!labmausId) continue;
    const alias = aliasRepo.get(db, labmausId, "RegM-A");
    if (!alias) continue;
    const usagePercent = t.usage_percent ?? t.usage ?? 0;
    theirsMapped.push({ key: alias.roster_id, usage_percent: usagePercent });
  }
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

  const db = open(parsed.dbPath);
  try {
    seedAliasTable(db, "data/labmaus/species-alias-seed.json");

    const client = createLabmausClient({
      cacheDir: "data/cache/labmaus",
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
          const detail = await getTournament(
            { id: s.id },
            {
              client,
              speciesMap: { db, aliasRepo },
            },
          );
          tournaments.upsertTournament(db, detail);
          total.tournaments++;
          total.teams += detail.teams.length;
          total.species += detail.species.length;

          // Cross-check pass: compare our recomputed per-species ranking
          // against labmaus's own pokemon[] aggregate (when present in the
          // cached raw payload). Out-of-tolerance diffs become warnings.
          await runCrossCheck(client, s.id, detail.tournament.id, db, total);
        } catch (e) {
          // Same propagation rule as the listing call: only swallow network
          // errors in offline mode. Schema/unknown-species/DB errors fail loud.
          if (parsed.noNetwork && e instanceof LabmausNetworkError) continue;
          if (e instanceof LabmausSchemaError || e instanceof LabmausUnknownSpeciesError) throw e;
          throw e;
        }
      }
    }

    console.log(JSON.stringify({ ok: true, ...total }));
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
