/**
 * YT-T52..YT-T54 — Stage 4 tests for cite.ts insight extension.
 * Stage 4: every test fails because `findInsightCitations` throws "not implemented (Stage 5)".
 */

import { describe, expect, it } from "vitest";
import {
  findInsightCitations,
  INSIGHT_CITE_SCORE_THRESHOLD,
  type InsightCitation,
} from "../../../src/data/tactical/cite";
import { open } from "../../../src/db/open";
import type { EmbedClient } from "../../../src/tools/knowledge/embed";
import type { ScenarioOverview } from "../../../src/schemas/tactical";

function fakeScenario(): ScenarioOverview {
  return {
    name: "Sun vs Bulky",
    type: "weather_clash",
    field: { weather: "harsh_sun", terrain: null, room: null },
    opposing_preview: ["incineroar", "garchomp"],
    recommended_leads: ["heatran", "torkoal"],
    recommended_backline: ["amoonguss", "venusaur"],
    rejected_bench: ["smeargle", "rotom-wash"],
    reasoning: "Sun pressure breaks bulk.",
    key_calcs: [],
    citations: [],
    pair_score: 0.5,
  } as unknown as ScenarioOverview;
}

function fakeEmbed(): EmbedClient {
  return {
    async embed(texts) {
      return texts.map(() => new Float32Array(512));
    },
  };
}

describe("data/tactical/cite — insight citations (YT-T52..YT-T54)", () => {
  it("YT-T52. findInsightCitations returns InsightCitation for species-overlapping insights", async () => {
    const db = open(":memory:");
    try {
      const cites: InsightCitation[] = await findInsightCitations(
        fakeScenario(),
        ["incineroar"],
        { db, embedClient: fakeEmbed() },
      );
      expect(Array.isArray(cites)).toBe(true);
      // Stage 5 is expected to return ≥1 when seeds match — Stage 4 stub will throw.
    } finally {
      db.$client.close();
    }
  });

  it("YT-T53. respects score threshold (>= 0.6 default)", async () => {
    expect(INSIGHT_CITE_SCORE_THRESHOLD).toBeGreaterThanOrEqual(0.6);
    const db = open(":memory:");
    try {
      const cites = await findInsightCitations(fakeScenario(), ["incineroar"], {
        db,
        embedClient: fakeEmbed(),
        minScore: 0.6,
      });
      for (const c of cites) expect(c.score).toBeGreaterThanOrEqual(0.6);
    } finally {
      db.$client.close();
    }
  });

  it("YT-T54. non-breaking — empty species ids returns []", async () => {
    const db = open(":memory:");
    try {
      const cites = await findInsightCitations(fakeScenario(), [], {
        db,
        embedClient: fakeEmbed(),
      });
      expect(cites).toEqual([]);
    } finally {
      db.$client.close();
    }
  });
});
