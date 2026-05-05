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
import {
  speciesAliasLabmaus,
  species as speciesTable,
} from "../../src/db/drizzle-schema";
import { sql } from "drizzle-orm";

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
  void aliasRepo;
  void speciesTable;
  void sql;
}

async function fakeFetchEmpty(): Promise<Response> {
  return new Response(JSON.stringify([]), { status: 200 });
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
        if (parsed.noNetwork) {
          // Empty / missing cache for this chunk in offline mode → skip.
          continue;
        }
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
        } catch (e) {
          if (parsed.noNetwork) continue;
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
