/**
 * Stage 4 — RED tests for the mid-phase scorer (PS1..PS4).
 *
 * Plan §6.1:
 *   mid_phase_score = survival_score + 0.5 * outgoing_damage_score
 *   range 0..150.
 *
 * Stub today returns 0 so the assertions fail at "0 vs expected non-zero".
 */

import { describe, expect, it } from "vitest";
import { scoreMidPhase } from "../../../src/data/tactical/score-mid-phase";
import { createCalcCache } from "../../../src/data/tactical/calc-cache";
import type { ScenarioSkeleton } from "../../../src/schemas/tactical";

const scenario: ScenarioSkeleton = {
  name: "Sun",
  type: "archetype",
  field: {
    weather: "sun", terrain: "none", trick_room: false,
    tailwind_ours: false, tailwind_theirs: false,
    light_screen: false, reflect: false, gravity: false,
  },
  opposing_preview: ["charizardmegay", "venusaur"],
};

describe("scoreMidPhase (PS1..PS4)", () => {
  it("PS1. returns a number in [0, 150]", () => {
    const v = scoreMidPhase(4, scenario, createCalcCache(), {});
    expect(typeof v).toBe("number");
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(150);
  });

  it("PS2. a bulky cleric scoring well on survival beats a fragile attacker", () => {
    // Same scenario, different mid slot. Without a real scoring_team /
    // scoring_panel the stub returns 0; Stage 5 will distinguish.
    const bulkyCleric = scoreMidPhase(4 /* sinistcha */, scenario, createCalcCache(), {});
    const fragileAttacker = scoreMidPhase(5 /* dragonite */, scenario, createCalcCache(), {});
    expect(bulkyCleric).toBeGreaterThanOrEqual(fragileAttacker);
  });

  it("PS3. deterministic: same input → identical output", () => {
    const cache = createCalcCache();
    const a = scoreMidPhase(4, scenario, cache, {});
    const b = scoreMidPhase(4, scenario, cache, {});
    expect(a).toBe(b);
  });

  it("PS4. no-engine inputs (empty deps) emit 0 without throwing", () => {
    expect(() => scoreMidPhase(0, scenario, createCalcCache(), {})).not.toThrow();
  });
});
