/**
 * Operator-facing demo: runs 5 hardcoded conceptual queries against the
 * populated knowledge_chunks DB, pretty-prints top-3 hits per query with
 * article title, section, and a 2-line snippet. Mirrors `scripts/pikalytics-demo.ts`.
 *
 * Run: `tsx scripts/vgc-knowledge-demo.ts`
 *
 * Env:
 *   VGC_DB_PATH       SQLite path (default `./data/db.sqlite`).
 *   VOYAGE_API_KEY    required to embed the queries at runtime.
 */

import { open } from "../src/db/open";
import { knowledgeSearch } from "../src/tools/knowledge/search";
import { createEmbedClient } from "../src/tools/knowledge/embed";

const QUERIES: ReadonlyArray<string> = [
  "how should I think about speed control on a sun team",
  "when should I switch a pokemon",
  "what makes a team consistent",
  "how do I read team preview",
  "predicting opponent moves",
];

/**
 * Demo entry point. Opens the DB read-only, embeds each query via Voyage,
 * runs `knowledge_search`, and prints the top hits.
 *
 * @returns Process exit code.
 */
export async function main(): Promise<number> {
  const apiKey = process.env.VOYAGE_API_KEY ?? "";
  if (!apiKey) {
    console.error("VOYAGE_API_KEY is required for the knowledge demo.");
    return 1;
  }
  const dbPath = process.env.VGC_DB_PATH ?? "./data/db.sqlite";
  const db = open(dbPath, { readonly: true });
  try {
    const embedClient = createEmbedClient({
      apiKey,
      model: "voyage-3-lite",
      maxBatch: 64,
      maxRetries: 3,
      backoffBaseMs: 1000,
    });

    for (const q of QUERIES) {
      process.stdout.write(`\nQ: ${q}\n`);
      const hits = await knowledgeSearch(
        { query: q, k: 3, exclude_subtypes: ["battle-replay"] },
        { db, embedClient },
      );
      if (hits.length === 0) {
        process.stdout.write("  (no hits)\n");
        continue;
      }
      for (const hit of hits) {
        const snippet = hit.chunk_text.slice(0, 240).replace(/\s+/g, " ");
        process.stdout.write(
          `  - ${hit.article_title} [${hit.article_section}] :: ${hit.section_heading}\n`,
        );
        process.stdout.write(
          `    ${hit.article_url}  (cosine=${hit.cosine_score.toFixed(3)})\n`,
        );
        process.stdout.write(`    "${snippet}"\n`);
      }
    }
    return 0;
  } finally {
    db.$client.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(
    (code) => process.exit(code),
    (e: unknown) => {
      console.error(e);
      process.exit(1);
    },
  );
}
