/**
 * TAC-T28..T30 — recommendLeads exhaustive 15-pair search; α/β/γ defaults.
 * Stage 5c: TAC-T28 tightened to assert against the precomputed golden pair
 * (regenerated via `scripts/data/build-tactical-goldens.ts`).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { recommendLeads } from "../../../src/data/tactical/recommend-leads";
import {
  ALPHA,
  BETA,
  GAMMA,
} from "../../../src/data/tactical/score-pair";
import { createCalcCache } from "../../../src/data/tactical/calc-cache";
import {
  fixtureToScoringTeam,
  fixtureToScoringPanel,
  type FixtureSet,
} from "../../../src/data/tactical/scoring-team";
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

interface TeamFixture { sets: FixtureSet[] }
interface PanelFixture { entries: Array<FixtureSet & { weight: number }> }

function loadGoldenInputs(): {
  team: ReturnType<typeof fixtureToScoringTeam>;
  panel: ReturnType<typeof fixtureToScoringPanel>;
  golden: {
    recommended_leads: [string, string];
    recommended_backline: [string, string];
    rejected_bench: [string, string];
    pair_score: number;
  };
} {
  const teamFx = JSON.parse(
    readFileSync(resolve("fixtures/tactical/2026-05-08__golden-team.json"), "utf8"),
  ) as TeamFixture;
  const panelFx = JSON.parse(
    readFileSync(resolve("fixtures/tactical/2026-05-08__golden-panel.json"), "utf8"),
  ) as PanelFixture;
  const golden = JSON.parse(
    readFileSync(resolve("fixtures/tactical/2026-05-08__recommend_golden.json"), "utf8"),
  ) as ReturnType<typeof loadGoldenInputs>["golden"];
  return {
    team: fixtureToScoringTeam(teamFx.sets),
    panel: fixtureToScoringPanel(panelFx.entries),
    golden,
  };
}

describe("recommendLeads (TAC-T28..T30)", () => {
  it("TAC-T28. real-engine 15-pair search picks the golden top pair (exact match)", () => {
    const db = open(":memory:"); opened = db;
    const cache = createCalcCache();
    const { team, panel, golden } = loadGoldenInputs();
    const neutralScenario: ScenarioOverview = {
      name: "neutral",
      type: "individual",
      field: {
        weather: "none", terrain: "none", trick_room: false,
        tailwind_ours: false, tailwind_theirs: false,
        light_screen: false, reflect: false, gravity: false,
      },
      opposing_preview: ["incineroar"],
      recommended_leads: ["a", "b"],
      recommended_backline: ["c", "d"],
      rejected_bench: ["e", "f"],
      reasoning: "",
      key_calcs: [],
      citations: [],
      pair_score: 0,
    };
    const r = recommendLeads(TEAM, neutralScenario, cache, {
      db,
      scoring_team: team,
      scoring_panel: panel,
    });
    expect(r.recommended_leads).toEqual(golden.recommended_leads);
    expect(r.recommended_backline).toEqual(golden.recommended_backline);
    expect(r.rejected_bench).toEqual(golden.rejected_bench);
    expect(r.pair_score).toBeCloseTo(golden.pair_score, 6);
  });

  it("TAC-T29. back pair = next-best 2 from remaining 4; rejected = remaining 2", () => {
    const db = open(":memory:"); opened = db;
    const cache = createCalcCache();
    const { team, panel } = loadGoldenInputs();
    const neutralScenario: ScenarioOverview = {
      name: "neutral",
      type: "individual",
      field: {
        weather: "none", terrain: "none", trick_room: false,
        tailwind_ours: false, tailwind_theirs: false,
        light_screen: false, reflect: false, gravity: false,
      },
      opposing_preview: ["incineroar"],
      recommended_leads: ["a", "b"],
      recommended_backline: ["c", "d"],
      rejected_bench: ["e", "f"],
      reasoning: "",
      key_calcs: [],
      citations: [],
      pair_score: 0,
    };
    const result = recommendLeads(TEAM, neutralScenario, cache, {
      db,
      scoring_team: team,
      scoring_panel: panel,
    });
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
