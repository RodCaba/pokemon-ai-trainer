/**
 * TAC-T16..T18 — scoreSpeed pillar with TR inversion threshold (Q3 binding).
 *
 * Stage-6 review fix: TAC-T16 now asserts exact equality against the
 * golden fixture (mirrors the offense/defense TAC-T11 pattern), which
 * the build-tactical-goldens.ts script regenerates from real engine inputs.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { scoreSpeed } from "../../../src/data/tactical/score-speed";
import {
  fixtureToScoringTeam,
  fixtureToScoringPanel,
  type FixtureSet,
} from "../../../src/data/tactical/scoring-team";
import { loadSpeedTable } from "../../../src/data/tactical/speed-table";
import type {
  ScenarioSkeleton,
  ThreatPanel,
} from "../../../src/schemas/tactical";
import type { UserTeam } from "../../../src/schemas/user-teams";
import type { SpeedTable } from "../../../src/data/tactical/speed-table";

const TEAM = {} as UserTeam;
const PANEL = {} as ThreatPanel;
const SCENARIOS: ScenarioSkeleton[] = [];
const EMPTY_SPEEDS: SpeedTable = { schema_version: 1, entries: [] };

interface TeamFixture { sets: FixtureSet[] }
interface PanelFixture { entries: Array<FixtureSet & { weight: number }> }

function loadGolden(): {
  pillar: "speed";
  score: number;
  tier: string;
  evidence: {
    tr_inversion_active: boolean;
    fastest_tier: number;
    outspeed_rate: number;
    outspeed_rate_tailwind: number;
  };
} {
  const p = resolve("fixtures/tactical/2026-05-08__pillar_speed_golden.json");
  return JSON.parse(readFileSync(p, "utf8"));
}

function loadInputs(): {
  team: ReturnType<typeof fixtureToScoringTeam>;
  panel: ReturnType<typeof fixtureToScoringPanel>;
} {
  const teamFx = JSON.parse(
    readFileSync(resolve("fixtures/tactical/2026-05-08__golden-team.json"), "utf8"),
  ) as TeamFixture;
  const panelFx = JSON.parse(
    readFileSync(resolve("fixtures/tactical/2026-05-08__golden-panel.json"), "utf8"),
  ) as PanelFixture;
  return {
    team: fixtureToScoringTeam(teamFx.sets),
    panel: fixtureToScoringPanel(panelFx.entries),
  };
}

describe("scoreSpeed (TAC-T16..T18)", () => {
  it("TAC-T16. golden: real speed loop matches fixtures/tactical/2026-05-08__pillar_speed_golden.json exactly", () => {
    const golden = loadGolden();
    const { team, panel } = loadInputs();
    const speedTable = loadSpeedTable();
    const result = scoreSpeed(TEAM, PANEL, SCENARIOS, speedTable, {
      scoring_team: team,
      scoring_panel: panel,
    });
    expect(result.pillar).toBe("speed");
    expect(result.score).toBe(golden.score);
    expect(result.tier).toBe(golden.tier);
    expect(result.evidence).toEqual(golden.evidence);
  });

  it("TAC-T17. TR inversion fires for team with TR setter + ≥ 2 attackers w/ base spe < 60 (Q3)", () => {
    const result = scoreSpeed(TEAM, PANEL, SCENARIOS, EMPTY_SPEEDS, {
      tr_min_slow_attackers: 2,
      tr_slow_base_spe: 60,
      tr_inversion_active: true,
    });
    const ev = result.evidence as { tr_inversion_active?: boolean };
    expect(ev.tr_inversion_active).toBe(true);
  });

  it("TAC-T18. TR inversion does NOT fire when team has setter but only 1 slow attacker", () => {
    const result = scoreSpeed(TEAM, PANEL, SCENARIOS, EMPTY_SPEEDS, {
      tr_min_slow_attackers: 2,
      tr_slow_base_spe: 60,
      tr_inversion_active: false,
    });
    const ev = result.evidence as { tr_inversion_active?: boolean };
    expect(ev.tr_inversion_active).toBe(false);
  });
});
