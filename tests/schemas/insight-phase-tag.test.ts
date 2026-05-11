/**
 * Stage 4 — RED tests for the cross-slice phase_tag schema extension.
 * Plan §9 S7–S9, §15. Pure-data exemption: batched.
 *
 * Fails today because `PhaseTagSchema` doesn't exist, `Insight.phase_tag`
 * isn't on the schema, and `InsightSearchArgsSchema.phase_tag_filter` isn't
 * threaded through.
 */

import { describe, expect, it } from "vitest";
import {
  PhaseTagSchema,
  InsightSchema,
  InsightSearchArgsSchema,
} from "../../src/schemas/insight";

const baseInsight = {
  id: "01H8XGJWBWBAQ4XK7Z4F9DGH4P",
  schema_version: 1 as const,
  claim: "Lead Sableye + Archaludon to set screens and Stamina-stack.",
  claim_type: "lead" as const,
  subjects: { pokemon: ["sableye", "archaludon"], formats: ["RegM-A"] as ["RegM-A"] },
  confidence: "medium" as const,
  stance: "supports" as const,
  source: {
    type: "youtube" as const,
    url: "https://youtu.be/example",
    excerpt: "Lead Sableye + Archaludon.",
  },
  extracted_by: {
    model: "claude-haiku-4-5-20251001",
    prompt_version: "v1.1",
    extracted_at: "2026-05-09T00:00:00Z",
  },
  embedding_ref: "insight_embeddings:1",
  chunk_id: null,
  phase_tag: null,
};

describe("PhaseTagSchema (S7)", () => {
  it("S7a. round-trips lead/mid/late", () => {
    expect(PhaseTagSchema.parse("lead")).toBe("lead");
    expect(PhaseTagSchema.parse("mid")).toBe("mid");
    expect(PhaseTagSchema.parse("late")).toBe("late");
  });

  it("S7b. rejects synonyms", () => {
    for (const bad of ["early", "opener", "midgame", "endgame", "cleanup", "Lead"]) {
      expect(PhaseTagSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe("InsightSchema.phase_tag (S8)", () => {
  it("S8a. accepts phase_tag null", () => {
    const r = InsightSchema.safeParse({ ...baseInsight, phase_tag: null });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.phase_tag).toBeNull();
  });

  it("S8b. accepts phase_tag = lead/mid/late", () => {
    for (const tag of ["lead", "mid", "late"] as const) {
      const r = InsightSchema.safeParse({ ...baseInsight, phase_tag: tag });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.phase_tag).toBe(tag);
    }
  });

  it("S8c. rejects invalid phase_tag", () => {
    expect(
      InsightSchema.safeParse({ ...baseInsight, phase_tag: "opener" }).success,
    ).toBe(false);
  });

  it("S8d. parses cleanly when phase_tag is null", () => {
    // phase_tag is required (mirrors chunk_id) — callers pass null explicitly.
    const r = InsightSchema.safeParse(baseInsight);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.phase_tag).toBeNull();
  });
});

describe("InsightSearchArgsSchema.phase_tag_filter (S9)", () => {
  it("S9a. accepts mid as a filter value", () => {
    const r = InsightSearchArgsSchema.parse({
      query: "what's the lead plan",
      phase_tag_filter: "mid",
    });
    expect(r.phase_tag_filter).toBe("mid");
  });

  it("S9b. rejects non-enum filter values", () => {
    expect(
      InsightSearchArgsSchema.safeParse({
        query: "x",
        phase_tag_filter: "midgame",
      }).success,
    ).toBe(false);
  });

  it("S9c. omitted phase_tag_filter is allowed (parameter is optional)", () => {
    const r = InsightSearchArgsSchema.parse({ query: "x" });
    expect(r.phase_tag_filter).toBeUndefined();
  });
});
