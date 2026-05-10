/**
 * YT-T1..YT-T3 — Stage 4 schema tests for the youtube-insights slice.
 *
 * Per plan §7 these are pure-data exemption tests (CLAUDE.md §3 carve-out for
 * schema definitions). Stage 4 expectation: tests compile + the schemas
 * already accept/reject the documented shapes (we extended `insight.ts` and
 * `knowledge.ts` for Stage 4 stub-import correctness; if any assertion below
 * fails it means we need to revisit the schema definition).
 */

import { describe, expect, it } from "vitest";
import {
  InsightSchema,
  InsightSearchArgsSchema,
  InsightSearchHitSchema,
  InsightSubjectRowSchema,
  type Insight,
} from "../../src/schemas/insight";
import {
  KnowledgeChunkSchema,
  SourceSiteSchema,
  KnowledgeChunkMetadataSchema,
} from "../../src/schemas/knowledge";

const baseInsight: Insight = {
  id: "01H8XGJWBWBAQ4XK7Z4F9DGH4P",
  schema_version: 1,
  claim: "Garchomp leads with Earthquake.",
  claim_type: "lead",
  subjects: { pokemon: ["garchomp"], formats: ["RegM-A"] },
  confidence: "medium",
  stance: "supports",
  source: {
    type: "youtube",
    url: "https://youtu.be/example",
    excerpt: "Garchomp leads with Earthquake.",
    timestamp_seconds: 42,
  },
  extracted_by: {
    model: "claude-haiku-4-5-20251001",
    prompt_version: "v1.0",
    extracted_at: "2026-05-09T00:00:00Z",
  },
  embedding_ref: "insight_embeddings:1",
  chunk_id: null,
  phase_tag: null,
};

describe("youtube-insights schemas (YT-T1..YT-T3)", () => {
  it("YT-T1a. InsightSchema accepts chunk_id: string", () => {
    const parsed = InsightSchema.parse({ ...baseInsight, chunk_id: "youtube:abc:0" });
    expect(parsed.chunk_id).toBe("youtube:abc:0");
  });

  it("YT-T1b. InsightSchema accepts chunk_id: null", () => {
    const parsed = InsightSchema.parse({ ...baseInsight, chunk_id: null });
    expect(parsed.chunk_id).toBeNull();
  });

  it("YT-T1c. InsightSchema rejects unknown extra keys (strict mode)", () => {
    const r = InsightSchema.safeParse({ ...baseInsight, tera_type: "fire" });
    expect(r.success).toBe(false);
  });

  it("YT-T2a. InsightSearchArgsSchema applies default limit = 5", () => {
    const r = InsightSearchArgsSchema.parse({ query: "garchomp lead" });
    expect(r.limit).toBe(5);
  });

  it("YT-T2b. InsightSearchArgsSchema rejects limit > 20", () => {
    const r = InsightSearchArgsSchema.safeParse({ query: "x", limit: 21 });
    expect(r.success).toBe(false);
  });

  it("YT-T2c. InsightSearchArgsSchema rejects empty query", () => {
    const r = InsightSearchArgsSchema.safeParse({ query: "" });
    expect(r.success).toBe(false);
  });

  it("YT-T2d. InsightSearchArgsSchema accepts species_id_filter regex", () => {
    const r = InsightSearchArgsSchema.parse({
      query: "x",
      species_id_filter: "incineroar",
    });
    expect(r.species_id_filter).toBe("incineroar");
  });

  it("YT-T2e. InsightSearchHitSchema requires score in [0,1]", () => {
    const ok = InsightSearchHitSchema.safeParse({ insight: baseInsight, score: 0.7 });
    expect(ok.success).toBe(true);
    const bad = InsightSearchHitSchema.safeParse({ insight: baseInsight, score: 1.5 });
    expect(bad.success).toBe(false);
  });

  it("YT-T2f. InsightSubjectRowSchema rejects unknown subject_kind", () => {
    const r = InsightSubjectRowSchema.safeParse({
      insight_id: "01H8XGJWBWBAQ4XK7Z4F9DGH4P",
      subject_kind: "tera_type",
      subject_value: "fire",
    });
    expect(r.success).toBe(false);
  });

  it("YT-T3a. SourceSiteSchema accepts 'youtube'", () => {
    expect(SourceSiteSchema.parse("youtube")).toBe("youtube");
  });

  it("YT-T3b. KnowledgeChunkSchema accepts source_site:'youtube' + subtype:'youtube-transcript' + youtube id format + metadata round-trip", () => {
    const chunk = {
      schema_version: 1 as const,
      id: "youtube:J0eVKJyJ_DQ:0",
      source_site: "youtube" as const,
      article_slug: "J0eVKJyJ_DQ",
      article_title: "Team Deep Dive",
      article_url: "https://www.youtube.com/watch?v=J0eVKJyJ_DQ",
      article_section: "intro" as const,
      section_heading: "t=0s",
      chunk_index: 0,
      chunk_text: "Hi everyone, today we're talking about Incineroar.",
      chunk_token_count: 12,
      subtype: "youtube-transcript" as const,
      body_hash:
        "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      embedding_ref: "knowledge_chunk_embeddings:1",
      source: {
        site: "youtube" as const,
        fetched_at: "2026-05-09T00:00:00+00:00",
        author: null,
        captured_via: "ingest-youtube@dev",
      },
      metadata: { timestamp_start_seconds: 0, timestamp_end_seconds: 90 },
    };
    const parsed = KnowledgeChunkSchema.parse(chunk);
    expect(parsed.source_site).toBe("youtube");
    expect(parsed.subtype).toBe("youtube-transcript");
    expect(parsed.metadata?.timestamp_start_seconds).toBe(0);
  });

  it("YT-T3c. KnowledgeChunkMetadataSchema accepts null", () => {
    expect(KnowledgeChunkMetadataSchema.parse(null)).toBeNull();
  });
});
