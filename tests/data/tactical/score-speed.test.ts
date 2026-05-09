/**
 * TAC-T16..T18 — scoreSpeed pillar with TR inversion threshold (Q3 binding).
 * Stage-4 red.
 */

import { describe, expect, it } from "vitest";
import { scoreSpeed } from "../../../src/data/tactical/score-speed";
import type {
  ScenarioOverview,
  ThreatPanel,
} from "../../../src/schemas/tactical";
import type { UserTeam } from "../../../src/schemas/user-teams";
import type { SpeedTable } from "../../../src/data/tactical/speed-table";

const TEAM = {} as UserTeam;
const PANEL = {} as ThreatPanel;
const SCENARIOS: ScenarioOverview[] = [];
const SPEEDS: SpeedTable = { schema_version: 1, entries: [] };

describe("scoreSpeed (TAC-T16..T18)", () => {
  it("TAC-T16. golden: known-team vs known-panel → speed score within ±2", () => {
    const result = scoreSpeed(TEAM, PANEL, SCENARIOS, SPEEDS, {});
    expect(result.pillar).toBe("speed");
    expect(Math.abs(result.score - 50)).toBeLessThanOrEqual(2);
  });

  it("TAC-T17. TR inversion fires for team with TR setter + ≥ 2 attackers w/ base spe < 60 (Q3)", () => {
    const result = scoreSpeed(TEAM, PANEL, SCENARIOS, SPEEDS, {
      tr_min_slow_attackers: 2,
      tr_slow_base_spe: 60,
    });
    const ev = result.evidence as { tr_inversion_active?: boolean };
    expect(ev.tr_inversion_active).toBe(true);
  });

  it("TAC-T18. TR inversion does NOT fire when team has setter but only 1 slow attacker", () => {
    const result = scoreSpeed(TEAM, PANEL, SCENARIOS, SPEEDS, {
      tr_min_slow_attackers: 2,
      tr_slow_base_spe: 60,
    });
    const ev = result.evidence as { tr_inversion_active?: boolean };
    expect(ev.tr_inversion_active).toBe(false);
  });
});
