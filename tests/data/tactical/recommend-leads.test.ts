/**
 * TAC-T28..T30 — recommendLeads exhaustive 15-pair search; α/β/γ defaults.
 * Stage-4 red.
 */

import { afterEach, describe, expect, it } from "vitest";
import { recommendLeads } from "../../../src/data/tactical/recommend-leads";
import {
  ALPHA,
  BETA,
  GAMMA,
} from "../../../src/data/tactical/score-pair";
import { createCalcCache } from "../../../src/data/tactical/calc-cache";
import type { ScenarioOverview } from "../../../src/schemas/tactical";
import type { UserTeam } from "../../../src/schemas/user-teams";
import { open, type Db } from "../../../src/db/open";

let opened: Db | null = null;
afterEach(() => {
  if (opened) {
    try {
      opened.$client.close();
    } catch {
      /* noop */
    }
    opened = null;
  }
});

const TEAM = {} as UserTeam;
const SCENARIO = {} as ScenarioOverview;

describe("recommendLeads (TAC-T28..T30)", () => {
  it("TAC-T28. exhaustive 15-pair search picks the highest-scoring pair (deterministic)", () => {
    const db = open(":memory:"); opened = db;
    const cache = createCalcCache();
    const a = recommendLeads(TEAM, SCENARIO, cache, { db });
    const b = recommendLeads(TEAM, SCENARIO, cache, { db });
    expect(a.recommended_leads).toEqual(b.recommended_leads);
    expect(a.pair_score).toEqual(b.pair_score);
  });

  it("TAC-T29. back pair = next-best 2 from remaining 4; rejected = remaining 2", () => {
    const db = open(":memory:"); opened = db;
    const cache = createCalcCache();
    const result = recommendLeads(TEAM, SCENARIO, cache, { db });
    const all = new Set([
      ...result.recommended_leads,
      ...result.recommended_backline,
      ...result.rejected_bench,
    ]);
    expect(all.size).toBe(6);
    expect(result.recommended_backline.length).toBe(2);
    expect(result.rejected_bench.length).toBe(2);
  });

  it("TAC-T30. α/β/γ defaults are 1.0 / 0.5 / 0.7 per Q6 binding", () => {
    expect(ALPHA).toBe(1.0);
    expect(BETA).toBe(0.5);
    expect(GAMMA).toBe(0.7);
  });
});
