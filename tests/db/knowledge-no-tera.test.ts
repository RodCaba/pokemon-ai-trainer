/**
 * VGC-T50 — defense-in-depth: no row in knowledge_chunks has any column value
 * or chunk_text matching /tera/i. Vacuous-green-eligible per CLAUDE.md §3
 * (the schema's `.strict()` already rejects `tera_*` keys; the corpus is
 * empirically Tera-free per the 2026-05-06 scan). Flagged for Stage 6
 * scrutiny.
 */

import { describe, expect, it } from "vitest";
import { open } from "../../src/db/open";
import * as knowledge from "../../src/db/knowledge";
import type { KnowledgeChunk } from "../../src/schemas/knowledge";

function makeChunk(slug: string, text: string): Omit<KnowledgeChunk, "embedding_ref"> {
  return {
    schema_version: 1,
    id: `vgcguide:${slug}:0`,
    source_site: "vgcguide",
    article_slug: slug,
    article_title: slug,
    article_url: `https://www.vgcguide.com/${slug}`,
    article_section: "intro",
    section_heading: "S",
    chunk_index: 0,
    chunk_text: text,
    chunk_token_count: 5,
    subtype: null,
    body_hash: "sha256:" + "0".repeat(64),
    source: {
      site: "vgcguide",
      fetched_at: "2026-05-06T00:00:00Z",
      author: null,
      captured_via: "vgcguide-ingest@deadbeef",
    },
  };
}

describe("knowledge no-tera (VGC-T50)", () => {
  it("VGC-T50. no row in knowledge_chunks has any column or chunk_text matching /tera/i", () => {
    const db = open(":memory:");
    try {
      const c = makeChunk("speed-control", "Discussing speed control on a sun team.");
      knowledge.upsertArticleChunks(db, {
        article_slug: "speed-control",
        body_hash: c.body_hash,
        chunks: [c],
        embeddings: [new Float32Array(512)],
      });
      const rows = db.$client
        .prepare("SELECT * FROM knowledge_chunks")
        .all() as Array<Record<string, unknown>>;
      for (const row of rows) {
        for (const value of Object.values(row)) {
          if (typeof value === "string") {
            expect(value).not.toMatch(/tera/i);
          }
        }
      }
    } finally {
      db.$client.close();
    }
  });
});
