/**
 * Stage 5b reingest helper: wipes metavgc rows from the canonical SQLite DB
 * and reingests the three Stage-5b fixtures via the real ingest pipeline (with
 * an injected fixture-backed `KnowledgeArticleClient` so we don't burn live
 * HTTP). Used to verify the RSC-payload extractor uplifts species-tag coverage.
 *
 * **Hard rule:** never wipes the whole DB (memory `single_db_non_destructive_build`).
 * Only deletes from `knowledge_chunks` rows where `source_site='metavgc'`; tag
 * rows + vec0 rows cascade via the upsert path / FK.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { open } from "../../src/db/open";
import { main as ingestMain } from "./ingest-metavgc";
import type { KnowledgeArticleClient } from "../../src/tools/knowledge/article-client";

// Load .env.local manually (no dotenv dependency).
function loadEnvLocal(): void {
  const path = ".env.local";
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    let v = m[2]!;
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (process.env[m[1]!] === undefined) {
      process.env[m[1]!] = v;
    }
  }
}
loadEnvLocal();

const DB_PATH = process.env.METAVGC_DB ?? "./data/reg-m-a/db.sqlite";
const FIXTURE_DIR = "fixtures/metavgc";

function fixtureSlugs(): Array<{ slug: string; html: string }> {
  const files = readdirSync(FIXTURE_DIR).filter(
    (f) => f.endsWith(".html") && f.includes("__guides-"),
  );
  return files.map((f) => {
    const m = f.match(/__guides-(.+)\.html$/);
    if (!m) throw new Error(`unrecognized fixture filename: ${f}`);
    const slugSuffix = m[1]!;
    // Map fixture suffix → real article slug.
    const slug = ((): string => {
      switch (slugSuffix) {
        case "incineroar-counters":
          return "how-to-counter-incineroar-pokemon-champions";
        case "anti-meta-megas":
          return "anti-meta-underrated-megas-pokemon-champions-2026";
        case "leads-opening":
          return "regulation-m-a-leads-opening-pokemon-champions";
        default:
          throw new Error(`unmapped slug for fixture: ${slugSuffix}`);
      }
    })();
    return {
      slug,
      html: readFileSync(join(FIXTURE_DIR, f), "utf8"),
    };
  });
}

function buildFixtureClient(
  pages: Array<{ slug: string; html: string }>,
): KnowledgeArticleClient {
  const bySlug = new Map(pages.map((p) => [p.slug, p.html]));
  return {
    async fetchSitemap(): Promise<string[]> {
      return pages.map((p) => `https://metavgc.com/guides/${p.slug}`);
    },
    async fetchArticleHtml(slug: string) {
      const html = bySlug.get(slug);
      if (html === undefined) {
        throw new Error(`fixture missing for slug=${slug}`);
      }
      return {
        slug,
        html,
        article_url: `https://metavgc.com/guides/${slug}`,
        fetched_at: new Date().toISOString(),
      };
    },
  };
}

async function main(): Promise<number> {
  const db = open(DB_PATH);
  const raw = db.$client;

  // Stats BEFORE.
  const beforeChunks = (
    raw
      .prepare(
        "SELECT COUNT(*) AS c FROM knowledge_chunks WHERE source_site='metavgc'",
      )
      .get() as { c: number }
  ).c;
  const beforeTags = (
    raw
      .prepare(
        `SELECT COUNT(*) AS c FROM knowledge_chunk_species_tags
         WHERE chunk_id IN (SELECT id FROM knowledge_chunks WHERE source_site='metavgc')`,
      )
      .get() as { c: number }
  ).c;

  // Wipe metavgc rows ONLY. Tag rows cascade via FK ON DELETE.
  const wipeTx = raw.transaction(() => {
    const refs = raw
      .prepare(
        "SELECT embedding_ref FROM knowledge_chunks WHERE source_site='metavgc'",
      )
      .all() as Array<{ embedding_ref: string }>;
    for (const r of refs) {
      const m = r.embedding_ref.match(/^knowledge_chunk_embeddings:(\d+)$/);
      if (m) {
        raw
          .prepare("DELETE FROM knowledge_chunk_embeddings WHERE rowid = ?")
          .run(Number(m[1]));
      }
    }
    raw
      .prepare("DELETE FROM knowledge_chunks WHERE source_site='metavgc'")
      .run();
  });
  wipeTx();

  process.stderr.write(
    `[reingest-metavgc] wiped: chunks=${beforeChunks} tags=${beforeTags}\n`,
  );

  // Build fixture client.
  const pages = fixtureSlugs();
  const client = buildFixtureClient(pages);
  const scope = new Set(pages.map((p) => p.slug));

  // Run ingest.
  const code = await ingestMain(["--db", DB_PATH], {
    db,
    client,
    scope,
  });
  if (code !== 0) {
    process.stderr.write(`[reingest-metavgc] ingest exit=${code}\n`);
    return code;
  }

  // Stats AFTER.
  const afterChunks = (
    raw
      .prepare(
        "SELECT COUNT(*) AS c FROM knowledge_chunks WHERE source_site='metavgc'",
      )
      .get() as { c: number }
  ).c;
  const afterTags = (
    raw
      .prepare(
        `SELECT COUNT(*) AS c FROM knowledge_chunk_species_tags
         WHERE chunk_id IN (SELECT id FROM knowledge_chunks WHERE source_site='metavgc')`,
      )
      .get() as { c: number }
  ).c;
  const top5 = raw
    .prepare(
      `SELECT species_id, COUNT(*) AS n FROM knowledge_chunk_species_tags
       WHERE chunk_id IN (SELECT id FROM knowledge_chunks WHERE source_site='metavgc')
       GROUP BY species_id ORDER BY n DESC LIMIT 5`,
    )
    .all();
  const perArticle = raw
    .prepare(
      `SELECT article_slug, COUNT(*) AS chunks,
         SUM(LENGTH(chunk_text)) AS chars
       FROM knowledge_chunks WHERE source_site='metavgc'
       GROUP BY article_slug`,
    )
    .all();

  process.stdout.write(
    JSON.stringify(
      {
        before: { chunks: beforeChunks, species_tag_links: beforeTags },
        after: { chunks: afterChunks, species_tag_links: afterTags },
        top5_species: top5,
        per_article: perArticle,
      },
      null,
      2,
    ) + "\n",
  );
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(
    (c) => process.exit(c),
    (e: unknown) => {
      console.error(e);
      process.exit(1);
    },
  );
}
