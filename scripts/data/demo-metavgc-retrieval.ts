/**
 * One-off retrieval demo: query the metavgc knowledge corpus end-to-end via
 * Voyage embeddings + sqlite-vec cosine, with optional species-id filtering
 * over the link table. Prints top hits for a handful of representative
 * queries — useful as a smoke check after a live ingest.
 *
 * Run: VOYAGE_API_KEY=... pnpm tsx scripts/data/demo-metavgc-retrieval.ts
 */
import { open } from "../../src/db/open";
import { search } from "../../src/db/knowledge";
import { createEmbedClient } from "../../src/tools/knowledge/embed";

interface DemoQuery {
  q: string;
  speciesFilter?: string[];
}

async function main(): Promise<void> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    console.error("VOYAGE_API_KEY is required");
    process.exit(1);
  }
  const dbPath = process.argv[2] ?? "data/reg-m-a/db.sqlite";
  const db = open(dbPath);
  const embed = createEmbedClient({ apiKey, model: "voyage-3-lite" });

  const queries: DemoQuery[] = [
    { q: "How do I counter Incineroar in Reg M-A?" },
    { q: "What's a good lead opener for tournament play?" },
    { q: "Tell me about Mega Glimmora's role", speciesFilter: ["glimmoramega"] },
    { q: "Trick room or tailwind for speed control?" },
    { q: "How to start playing competitive Pokemon" },
    { q: "Farigiraf Armor Tail anti-priority", speciesFilter: ["farigiraf"] },
  ];

  // Pre-fetch source_site for each chunk id we'll see.
  const siteByChunk = new Map<string, string>();
  const allChunks = db.$client
    .prepare("SELECT id, source_site FROM knowledge_chunks")
    .all() as Array<{ id: string; source_site: string }>;
  for (const r of allChunks) siteByChunk.set(r.id, r.source_site);

  for (const { q, speciesFilter } of queries) {
    const [vec] = await embed.embed([q], "query");
    let hits = search(db, { query_vector: vec!, k: 12 });
    hits = hits.filter((h) => siteByChunk.get(h.id) === "metavgc");
    if (speciesFilter !== undefined && speciesFilter.length > 0) {
      const placeholders = speciesFilter.map(() => "?").join(",");
      const ids = db.$client
        .prepare(
          `SELECT DISTINCT chunk_id FROM knowledge_chunk_species_tags
           WHERE species_id IN (${placeholders})`,
        )
        .all(...speciesFilter) as Array<{ chunk_id: string }>;
      const allow = new Set(ids.map((r) => r.chunk_id));
      hits = hits.filter((h) => allow.has(h.id));
    }
    hits = hits.slice(0, 3);
    const tagStr = speciesFilter ? ` [filter: ${speciesFilter.join(",")}]` : "";
    console.log(`\n━━━ "${q}"${tagStr}`);
    if (hits.length === 0) {
      console.log("  (no metavgc hits)");
      continue;
    }
    for (const h of hits) {
      const preview = h.chunk_text.slice(0, 110).replace(/\n+/g, " ");
      console.log(
        `  ${h.cosine_score.toFixed(3)}  [${h.section_heading}] ${preview}…`,
      );
      console.log(`         → ${h.article_slug}`);
    }
  }

  db.$client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
