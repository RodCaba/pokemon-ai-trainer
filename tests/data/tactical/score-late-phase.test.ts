/**
 * Stage 4 — RED tests for the late-phase scorer (PS5..PS8).
 *
 * Plan §6.2:
 *   late_phase_score = Σ weight_i * best_max_roll_pct(cleaner vs bulky_i)
 *   range 0..100. Picks the 2 most-bulky panel members.
 */

import { describe, expect, it } from "vitest";
import { scoreLatePhase } from "../../../src/data/tactical/score-late-phase";
import { createCalcCache } from "../../../src/data/tactical/calc-cache";
import type { ScenarioSkeleton, ThreatPanel } from "../../../src/schemas/tactical";

const scenario: ScenarioSkeleton = {
  name: "Sun",
  type: "archetype",
  field: {
    weather: "sun", terrain: "none", trick_room: false,
    tailwind_ours: false, tailwind_theirs: false,
    light_screen: false, reflect: false, gravity: false,
  },
  opposing_preview: ["charizardmegay"],
};

const panel: ThreatPanel = {
  schema_version: 1,
  as_of: "2026-05-10",
  generated_at: "2026-05-10T00:00:00Z",
  entries: [],
};

describe("scoreLatePhase (PS5..PS8)", () => {
  it("PS5. returns a number in [0, 100]", () => {
    const v = scoreLatePhase(2, scenario, panel, createCalcCache(), {});
    expect(typeof v).toBe("number");
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(100);
  });

  it("PS6. empty panel → 0", () => {
    expect(scoreLatePhase(2, scenario, panel, createCalcCache(), {})).toBe(0);
  });

  it("PS7. deterministic", () => {
    const cache = createCalcCache();
    const a = scoreLatePhase(2, scenario, panel, cache, {});
    const b = scoreLatePhase(2, scenario, panel, cache, {});
    expect(a).toBe(b);
  });

  it("PS8. no-engine inputs (empty deps) emit 0 without throwing", () => {
    expect(() => scoreLatePhase(2, scenario, panel, createCalcCache(), {})).not.toThrow();
  });
});
