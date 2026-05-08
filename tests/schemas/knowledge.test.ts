/**
 * VGC-T1–VGC-T6 — knowledge zod schemas.
 *
 * Per CLAUDE.md §3 pure-data exemption: schemas land as a single batch and
 * these tests lock in correctness with happy-path + key rejection cases. The
 * implementation file (`src/schemas/knowledge.ts`) lands at Stage 4 alongside
 * these tests; the rest of the slice (extractor / chunker / embed / repo)
 * stays strict per-test red-first.
 */

import { describe, expect, it } from "vitest";
import {
  ChunkFilterSchema,
  KnowledgeChunkSchema,
  KnowledgeSearchArgsSchema,
} from "../../src/schemas/knowledge";

function chunkFixture(overrides: Record<string, unknown> = {}): unknown {
  return {
    schema_version: 1,
    id: "vgcguide:speed-control:0",
    source_site: "vgcguide",
    article_slug: "speed-control",
    article_title: "Speed Control",
    article_url: "https://www.vgcguide.com/speed-control",
    article_section: "teambuilding",
    section_heading: "Speed Control",
    chunk_index: 0,
    chunk_text: "Speed control is the cornerstone of doubles play.",
    chunk_token_count: 10,
    subtype: null,
    body_hash: "sha256:" + "a".repeat(64),
    embedding_ref: "knowledge_chunk_embeddings:42",
    source: {
      site: "vgcguide",
      fetched_at: "2026-05-06T00:00:00Z",
      author: null,
      captured_via: "vgcguide-ingest@deadbeef",
    },
    ...overrides,
  };
}

describe("knowledge schemas (VGC-T1–VGC-T6)", () => {
  it("VGC-T1. KnowledgeChunkSchema parses Speed Control fixture chunk", () => {
    const parsed = KnowledgeChunkSchema.parse(chunkFixture());
    expect(parsed.id).toBe("vgcguide:speed-control:0");
    expect(parsed.embedding_ref).toMatch(/^knowledge_chunk_embeddings:\d+$/);
  });

  it("VGC-T2. KnowledgeChunkSchema rejects unknown keys via .strict()", () => {
    const bad = chunkFixture({ tera_type: "Fire" });
    expect(() => KnowledgeChunkSchema.parse(bad)).toThrow();
  });

  it("VGC-T3. KnowledgeChunkSchema rejects chunk_token_count > 500", () => {
    const bad = chunkFixture({ chunk_token_count: 501 });
    expect(() => KnowledgeChunkSchema.parse(bad)).toThrow();
  });

  it("VGC-T4. KnowledgeChunkSchema accepts subtype: null and 'battle-replay'", () => {
    expect(() => KnowledgeChunkSchema.parse(chunkFixture({ subtype: null }))).not.toThrow();
    expect(() =>
      KnowledgeChunkSchema.parse(chunkFixture({ subtype: "battle-replay" })),
    ).not.toThrow();
    expect(() => KnowledgeChunkSchema.parse(chunkFixture({ subtype: "foo" }))).toThrow();
  });

  it("VGC-T5. KnowledgeSearchArgsSchema requires query length >= 3", () => {
    expect(() => KnowledgeSearchArgsSchema.parse({ query: "ab" })).toThrow();
    expect(() => KnowledgeSearchArgsSchema.parse({ query: "abc" })).not.toThrow();
  });

  it("VGC-T6. ChunkFilterSchema accepts every-field-optional empty object", () => {
    expect(() => ChunkFilterSchema.parse({})).not.toThrow();
  });
});
