/**
 * YT-T41..YT-T48 — Stage 4 tests for the Haiku-driven extractor.
 * Stage 4: every test fails because `extractInsights` throws InsightExtractionError(anthropic_error).
 */

import { describe, expect, it } from "vitest";
import {
  extractInsights,
  type AnthropicClientLike,
  type ExtractInsightsDeps,
  type ExtractInsightsInput,
  type KnowledgeChunkRowMinimal,
} from "../../../src/tools/insights/extract";
import type { SpeciesIndex } from "../../../src/tools/knowledge/species-tagger";
import type { YoutubeVideoMetadata } from "../../../src/tools/youtube/client";
import { InsightExtractionError } from "../../../src/schemas/errors";
import type { Insight } from "../../../src/schemas/insight";

function speciesIndex(): SpeciesIndex {
  // Minimal fake: just enough so the hallucination guard can reverse-lookup
  // canonical names. Stage 5 wires the real builder.
  return {
    entries: [
      { pattern: /\bgarchomp\b/i, speciesId: "garchomp", lengthHint: 8 },
      { pattern: /\bincineroar\b/i, speciesId: "incineroar", lengthHint: 10 },
      { pattern: /\bzacian\b/i, speciesId: "zacian", lengthHint: 6 },
      { pattern: /\bMega Garchomp\b/i, speciesId: "garchomp-mega", lengthHint: 13 },
    ],
  };
}

function meta(): YoutubeVideoMetadata {
  return {
    video_id: "abc",
    title: "T",
    channel: "C",
    published_at: "2026-04-30T00:00:00Z",
    duration_s: 300,
    canonical_url: "https://www.youtube.com/watch?v=abc",
    fetched_at: "2026-05-09T00:00:00Z",
    language: "en",
  };
}

function chunk(text: string): KnowledgeChunkRowMinimal {
  return {
    id: "youtube:abc:0",
    chunk_text: text,
    article_url: "https://www.youtube.com/watch?v=abc",
    metadata: { timestamp_start_seconds: 0 },
  };
}

interface MockToolUseInsight {
  claim: string;
  claim_type: Insight["claim_type"];
  subjects: { pokemon: string[]; formats: ["RegM-A"] };
  confidence: Insight["confidence"];
  stance: Insight["stance"];
  source_excerpt: string;
}

function fakeAnthropic(insights: MockToolUseInsight[]): AnthropicClientLike {
  return {
    messages: {
      async create() {
        return {
          content: [
            {
              type: "tool_use",
              name: "emit_insights",
              input: { insights },
            },
          ],
          stop_reason: "tool_use",
        };
      },
    },
  };
}

function deps(anthropic: AnthropicClientLike): ExtractInsightsDeps {
  let counter = 0;
  return {
    anthropic,
    prompt_version: "v1.0",
    clock: () => new Date("2026-05-09T00:00:00Z"),
    ulid: () => `01H8XGJWBWBAQ4XK7Z4F9DGH${"AB"[counter++ % 2]}${"P".repeat(1)}`,
  };
}

function input(text: string): ExtractInsightsInput {
  return { chunk: chunk(text), video_meta: meta(), species_index: speciesIndex() };
}

describe("tools/insights/extract (YT-T41..YT-T48)", () => {
  it("YT-T41. happy-path: returns ≤5 schema-valid insights from a single tool_use response", async () => {
    const anthropic = fakeAnthropic([
      {
        claim: "Garchomp leads with Earthquake to pressure Steel.",
        claim_type: "lead",
        subjects: { pokemon: ["garchomp"], formats: ["RegM-A"] },
        confidence: "medium",
        stance: "supports",
        source_excerpt: "Garchomp leads with Earthquake.",
      },
    ]);
    const r = await extractInsights(input("Garchomp leads with Earthquake."), deps(anthropic));
    expect(r.insights.length).toBe(1);
    expect(r.insights[0]?.subjects.pokemon).toContain("garchomp");
  });

  it("YT-T42. hallucination guard rejects insights whose subjects.pokemon don't appear in the chunk text", async () => {
    const anthropic = fakeAnthropic([
      {
        claim: "Zacian threatens the team.",
        claim_type: "matchup",
        subjects: { pokemon: ["zacian"], formats: ["RegM-A"] },
        confidence: "low",
        stance: "supports",
        source_excerpt: "Zacian threatens the team.",
      },
    ]);
    const text = "Garchomp leads with Earthquake."; // chunk does NOT mention Zacian
    const r = await extractInsights(input(text), deps(anthropic));
    expect(r.insights.length).toBe(0);
    expect(r.rejected.some((x) => x.reason === "hallucinated_species")).toBe(true);
  });

  it("YT-T43. format guard rejects subjects.formats !== ['RegM-A']", async () => {
    const anthropic = fakeAnthropic([
      {
        claim: "Old-format claim.",
        claim_type: "meta_trend",
        subjects: {
          pokemon: ["garchomp"],
          // @ts-expect-error — intentional bad format
          formats: ["VGC2024"],
        },
        confidence: "low",
        stance: "supports",
        source_excerpt: "...",
      },
    ]);
    const r = await extractInsights(input("Garchomp"), deps(anthropic));
    expect(r.insights.length).toBe(0);
    expect(r.rejected.some((x) => x.reason === "non_regma_format")).toBe(true);
  });

  it("YT-T44. cap-truncates to 5 insights when model returns 7", async () => {
    const seven: MockToolUseInsight[] = Array.from({ length: 7 }).map((_, i) => ({
      claim: `Garchomp claim ${i}.`,
      claim_type: "lead",
      subjects: { pokemon: ["garchomp"], formats: ["RegM-A"] },
      confidence: "medium",
      stance: "supports",
      source_excerpt: "Garchomp claim.",
    }));
    const r = await extractInsights(input("Garchomp"), deps(fakeAnthropic(seven)));
    expect(r.insights.length).toBe(5);
  });

  it("YT-T45. zero-result chunk returns { insights: [], rejected: [] } without throwing", async () => {
    const r = await extractInsights(input("filler text"), deps(fakeAnthropic([])));
    expect(r.insights).toEqual([]);
    expect(r.rejected).toEqual([]);
  });

  it("YT-T46. throws InsightExtractionError(rate_limit) after retry exhaustion", async () => {
    const anthropic: AnthropicClientLike = {
      messages: {
        async create() {
          const e = new Error("429 rate_limit");
          (e as Error & { status?: number }).status = 429;
          throw e;
        },
      },
    };
    await expect(extractInsights(input("x"), deps(anthropic))).rejects.toMatchObject({
      name: "InsightExtractionError",
      kind: "rate_limit",
    });
  });

  it("YT-T47. pins extracted_by.prompt_version='v1.0' on every emitted insight", async () => {
    const anthropic = fakeAnthropic([
      {
        claim: "Garchomp leads.",
        claim_type: "lead",
        subjects: { pokemon: ["garchomp"], formats: ["RegM-A"] },
        confidence: "medium",
        stance: "supports",
        source_excerpt: "Garchomp leads.",
      },
    ]);
    const r = await extractInsights(input("Garchomp"), deps(anthropic));
    // v1.0 is exercised here as a DI parameter only — the production
    // default bumps to v1.1 after the team-support-pillar slice adds
    // `phase_tag` to the emit_insights tool. See `tests/tools/insights/
    // extract-phase-tag.test.ts` for the v1.1 contract.
    expect(r.insights[0]?.extracted_by.prompt_version).toBe("v1.0");
  });

  it("YT-T48. species-index alias path: 'Mega Garchomp' in chunk passes guard for canonical id 'garchomp-mega'", async () => {
    const anthropic = fakeAnthropic([
      {
        claim: "Mega Garchomp wallbreaks.",
        claim_type: "tech",
        subjects: { pokemon: ["garchomp-mega"], formats: ["RegM-A"] },
        confidence: "high",
        stance: "supports",
        source_excerpt: "Mega Garchomp.",
      },
    ]);
    const r = await extractInsights(input("Mega Garchomp wallbreaks."), deps(anthropic));
    expect(r.insights.length).toBe(1);
    expect(r.insights[0]?.subjects.pokemon).toContain("garchomp-mega");
  });

  it("YT-T46b. anthropic auth errors propagate as InsightExtractionError(anthropic_error)", async () => {
    // The Stage 4 stub itself throws this — the test confirms the error class shape.
    const anthropic: AnthropicClientLike = {
      messages: {
        async create() {
          const e = new Error("401 Unauthorized");
          (e as Error & { status?: number }).status = 401;
          throw e;
        },
      },
    };
    await expect(extractInsights(input("x"), deps(anthropic))).rejects.toBeInstanceOf(
      InsightExtractionError,
    );
  });
});
