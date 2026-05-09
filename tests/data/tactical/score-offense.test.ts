/**
 * TAC-T11..T13 — scoreOffense pillar scorer. Stage-4 red.
 */

import { describe, expect, it } from "vitest";
import { scoreOffense } from "../../../src/data/tactical/score-offense";
import type { ThreatPanel } from "../../../src/schemas/tactical";
import type { UserTeam } from "../../../src/schemas/user-teams";
import { createCalcCache } from "../../../src/data/tactical/calc-cache";

const TEAM = {} as UserTeam;
const PANEL = {} as ThreatPanel;

describe("scoreOffense (TAC-T11..T13)", () => {
  it("TAC-T11. golden: known-team vs known-panel produces score within ±2 of golden", () => {
    const cache = createCalcCache();
    const result = scoreOffense(TEAM, PANEL, cache, { calc: () => ({}) });
    // Golden value pinned at fixtures/tactical/2026-05-08__pillar_offense_golden.json
    // Stage 5 will plumb the fixture; here we assert the shape + bound.
    expect(result.pillar).toBe("offense");
    expect(Math.abs(result.score - 70)).toBeLessThanOrEqual(2);
  });

  it("TAC-T12. KO-chance evidence captures top-3 + worst-2 (5 entries)", () => {
    const cache = createCalcCache();
    const result = scoreOffense(TEAM, PANEL, cache, { calc: () => ({}) });
    const ev = result.evidence as { top: unknown[]; worst: unknown[] };
    expect(ev.top.length).toBe(3);
    expect(ev.worst.length).toBe(2);
  });

  it("TAC-T13. calc-engine throw on a single (our_set, threat_set) pair → skip + continue", () => {
    let throwOnce = true;
    const cache = createCalcCache();
    const result = scoreOffense(TEAM, PANEL, cache, {
      calc: () => {
        if (throwOnce) {
          throwOnce = false;
          throw new Error("simulated engine throw");
        }
        return {};
      },
    });
    // Pillar still produced (skip-and-continue), score in 0..100 range.
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});
