/**
 * TAC-T14..T15 — scoreDefense pillar. Stage-4 red.
 */

import { describe, expect, it } from "vitest";
import { scoreDefense } from "../../../src/data/tactical/score-defense";
import type { ThreatPanel } from "../../../src/schemas/tactical";
import type { UserTeam } from "../../../src/schemas/user-teams";
import { createCalcCache } from "../../../src/data/tactical/calc-cache";

const TEAM = {} as UserTeam;
const PANEL = {} as ThreatPanel;

describe("scoreDefense (TAC-T14..T15)", () => {
  it("TAC-T14. golden: incoming damage from panel vs known-team → score in range", () => {
    const cache = createCalcCache();
    const result = scoreDefense(TEAM, PANEL, cache, { calc: () => ({}) });
    expect(result.pillar).toBe("defense");
    expect(Math.abs(result.score - 60)).toBeLessThanOrEqual(2);
  });

  it("TAC-T15. weakest-slot evidence reports the slot with the most OHKOs", () => {
    const cache = createCalcCache();
    const result = scoreDefense(TEAM, PANEL, cache, { calc: () => ({}) });
    const ev = result.evidence as { weakest_slot: number };
    expect(typeof ev.weakest_slot).toBe("number");
    expect(ev.weakest_slot).toBeGreaterThanOrEqual(0);
    expect(ev.weakest_slot).toBeLessThanOrEqual(5);
  });
});
