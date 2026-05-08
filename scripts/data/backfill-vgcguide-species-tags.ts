/**
 * One-shot backfill: populate `knowledge_chunk_species_tags` for the existing
 * vgcguide knowledge_chunks rows. Per plan §19.4.
 *
 * Idempotent — running twice produces zero deltas. Each chunk's link rows
 * are recomputed from `chunk_text` against the in-process species index and
 * upserted via delete-then-insert in a single transaction.
 *
 * Argv:
 *   --db <path>   SQLite path (default ./data/db.sqlite).
 *
 * Exit codes:
 *   0  success.
 *   1  SpeciesTaggerError, DB error, uncaught exception.
 */

import { open, type Db } from "../../src/db/open";
import {
  buildSpeciesIndex,
  detectSpeciesTags,
} from "../../src/tools/knowledge/species-tagger";

/** Injection slots for {@link main} — overridable in tests. */
export interface BackfillDeps {
  db?: Db;
}

interface ParsedArgs {
  db: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { db: "./data/db.sqlite" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--db") out.db = argv[++i] ?? out.db;
  }
  return out;
}

interface ChunkRow {
  id: string;
  chunk_text: string;
}

/**
 * Run the backfill. Reads every `knowledge_chunks` row with
 * `source_site = 'vgcguide'`, runs the species tagger over each `chunk_text`,
 * and replaces the row's link entries in `knowledge_chunk_species_tags`.
 *
 * **When to use it:** the one-shot operator script (after the metavgc-guides
 * slice lands and the species tagger is wired). Re-runs are safe.
 *
 * @param argv — Argv slice.
 * @param deps — Optional injection slots; defaults wire to production.
 * @returns Process exit code (0 success, 1 fatal).
 *
 * @example
 * ```bash
 * pnpm data:backfill:vgcguide-species-tags --db data/reg-m-a/db.sqlite
 * ```
 */
export async function main(
  argv: string[],
  deps: BackfillDeps = {},
): Promise<number> {
  const opts = parseArgs(argv);
  const db = deps.db ?? open(opts.db);
  const ownsDb = deps.db === undefined;

  try {
    const index = buildSpeciesIndex(db);
    const rows = db.$client
      .prepare(
        "SELECT id, chunk_text FROM knowledge_chunks WHERE source_site = 'vgcguide' ORDER BY id",
      )
      .all() as ChunkRow[];

    let chunksScanned = 0;
    let linkRowsWritten = 0;

    const tx = db.$client.transaction(() => {
      const del = db.$client.prepare(
        "DELETE FROM knowledge_chunk_species_tags WHERE chunk_id = ?",
      );
      const ins = db.$client.prepare(
        "INSERT OR IGNORE INTO knowledge_chunk_species_tags (chunk_id, species_id) VALUES (?, ?)",
      );
      for (const row of rows) {
        chunksScanned += 1;
        const tags = detectSpeciesTags(row.chunk_text, index);
        del.run(row.id);
        for (const speciesId of tags) {
          ins.run(row.id, speciesId);
          linkRowsWritten += 1;
        }
      }
    });
    tx();

    process.stdout.write(
      JSON.stringify({
        ok: true,
        chunks_scanned: chunksScanned,
        link_rows_written: linkRowsWritten,
      }) + "\n",
    );
    return 0;
  } finally {
    if (ownsDb) {
      try {
        db.$client.close();
      } catch {
        /* ignore close errors */
      }
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e: unknown) => {
      console.error(e);
      process.exit(1);
    },
  );
}
