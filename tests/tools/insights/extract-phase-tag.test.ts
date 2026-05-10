/**
 * Stage 4 — RED tests for the extractor's phase_tag emission (EX1, EX2).
 *
 * Module under test: `src/tools/insights/extract.ts` —
 *   - `emit_insights` tool input schema gains an optional `phase_tag` per item.
 *   - extracted Insight carries phase_tag end-to-end.
 *   - prompt_version bumps from `v1.0` → `v1.1` per Q8 binding.
 */

import { describe, expect, it } from "vitest";
import {
  extractInsights,
  type AnthropicClientLike,
  type ExtractInsightsDeps,
} from "../../../src/tools/insights/extract";
import type { SpeciesIndex } from "../../../src/tools/knowledge/species-tagger";
import type { YoutubeVideoMetadata } from "../../../src/tools/youtube/client";

const speciesIndex: SpeciesIndex = {
  entries: [
    { speciesId: "sableye", pattern: /\bSableye\b/gi, lengthHint: 7 },
    { speciesId: "archaludon", pattern: /\bArchaludon\b/gi, lengthHint: 10 },
  ],
};

const meta: YoutubeVideoMetadata = {
  video_id: "TEST_PHASE",
  title: "ArchaEye lead plan",
  channel: "TestChannel",
  canonical_url: "https://www.youtube.com/watch?v=TEST_PHASE",
  published_at: "2026-05-09T00:00:00Z",
  language: null,
  duration_s: 600,
  fetched_at: "2026-05-09T00:00:00Z",
};

const chunk = {
  id: "youtube:TEST_PHASE:0",
  chunk_text:
    "Lead Sableye + Archaludon — screens up turn one, then Quash to disable priority. Archaludon Stamina-stacks behind that.",
  article_url: "https://www.youtube.com/watch?v=TEST_PHASE",
  metadata: { timestamp_start_seconds: 0, timestamp_end_seconds: 60 },
};

const mkAnthropic = (insights: Array<Record<string, unknown>>): AnthropicClientLike => ({
  messages: {
    async create(args: unknown) {
      const a = args as { tools: Array<{ input_schema: { properties: { insights: { items: { properties: Record<string, unknown>; required?: string[] } } } } }> };
      // EX1: assert the tool schema accepts phase_tag.
      const props = a.tools[0]?.input_schema?.properties?.insights?.items?.properties ?? {};
      // Stash the schema on a global so the test can read it.
      (globalThis as unknown as { __toolProps?: Record<string, unknown> }).__toolProps = props;
      return {
        content: [
          {
            type: "tool_use",
            name: "emit_insights",
            input: { insights },
          },
        ],
      };
    },
  },
});

describe("extractInsights — phase_tag (EX1, EX2)", () => {
  it("EX1. emit_insights tool input schema includes phase_tag (enum lead/mid/late, nullable)", async () => {
    const anthropic = mkAnthropic([]);
    await extractInsights(
      { chunk, video_meta: meta, species_index: speciesIndex },
      {
        anthropic,
        prompt_version: "v1.1" as ExtractInsightsDeps["prompt_version"],
        clock: () => new Date("2026-05-09T00:00:00Z"),
        ulid: () => "01HZZZZZZZZZZZZZZZZZZZZZZZ",
      },
    );
    const props = (globalThis as unknown as { __toolProps?: Record<string, { enum?: string[]; type?: string | string[] } | undefined> }).__toolProps ?? {};
    expect(props.phase_tag).toBeDefined();
    // phase_tag should accept lead/mid/late, plus null/missing.
    const phaseTag = props.phase_tag!;
    if (phaseTag.enum) {
      expect(phaseTag.enum).toEqual(expect.arrayContaining(["lead", "mid", "late"]));
    }
  });

  it("EX2. extracted Insight carries phase_tag = 'lead' end-to-end", async () => {
    const anthropic = mkAnthropic([
      {
        claim: "Lead Sableye + Archaludon to set up screens turn one.",
        claim_type: "lead",
        subjects: { pokemon: ["sableye", "archaludon"], formats: ["RegM-A"] },
        confidence: "medium",
        stance: "supports",
        source_excerpt: "Lead Sableye + Archaludon — screens up turn one",
        phase_tag: "lead",
      },
    ]);
    const r = await extractInsights(
      { chunk, video_meta: meta, species_index: speciesIndex },
      {
        anthropic,
        prompt_version: "v1.1" as ExtractInsightsDeps["prompt_version"],
        clock: () => new Date("2026-05-09T00:00:00Z"),
        ulid: () => "01HZZZZZZZZZZZZZZZZZZZZZZZ",
      },
    );
    expect(r.insights).toHaveLength(1);
    expect(r.insights[0]?.phase_tag).toBe("lead");
    expect(r.insights[0]?.extracted_by.prompt_version).toBe("v1.1");
  });

  it("EX2b. extractor accepts insights without phase_tag → emits null (backwards-compat)", async () => {
    const anthropic = mkAnthropic([
      {
        claim: "Lead Sableye + Archaludon turn one.",
        claim_type: "lead",
        subjects: { pokemon: ["sableye", "archaludon"], formats: ["RegM-A"] },
        confidence: "medium",
        stance: "supports",
        source_excerpt: "Lead Sableye + Archaludon",
        // phase_tag omitted
      },
    ]);
    const r = await extractInsights(
      { chunk, video_meta: meta, species_index: speciesIndex },
      {
        anthropic,
        prompt_version: "v1.1" as ExtractInsightsDeps["prompt_version"],
        clock: () => new Date("2026-05-09T00:00:00Z"),
        ulid: () => "01HZZZZZZZZZZZZZZZZZZZZZZZ",
      },
    );
    expect(r.insights).toHaveLength(1);
    expect(r.insights[0]?.phase_tag).toBeNull();
  });
});
