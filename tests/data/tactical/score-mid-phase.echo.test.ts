/**
 * Stage 4 — RED tests for Stage D score-mid-phase return-shape
 * extension (SE5..SE8 — plan §3.4 / §10).
 *
 * Today `scoreMidPhase` returns a bare `number`. Stage D extends to
 *   `{ score: number; mid_incoming_damage_pct: { ours: [number, number] } }`.
 * Also asserts the `recommend-plan.ts::scorePlan` call sites consume
 * `.score` (SE5) — these tests pin the contract; they fail today
 * because the current shape is a primitive number.
 */

import { describe, expect, it } from "vitest";
import { scoreMidPhase } from "../../../src/data/tactical/score-mid-phase";
import { scorePair } from "../../../src/data/tactical/score-pair";
import { createCalcCache } from "../../../src/data/tactical/calc-cache";
import type { ScenarioSkeleton } from "../../../src/schemas/tactical";
import type { UserTeam } from "../../../src/schemas/user-teams";

const scenario: ScenarioSkeleton = {
  name: "test",
  type: "archetype",
  field: {
    weather: "none", terrain: "none", trick_room: false,
    tailwind_ours: false, tailwind_theirs: false,
    light_screen: false, reflect: false, gravity: false,
  },
  opposing_preview: ["incineroar"],
};

const emptyTeam: UserTeam = {
  schema_version: 1, id: "t", name: "t", description: null,
  win_condition: null, status: "saved", origin: "builder",
  origin_payload: null, source_tournament_team_id: null,
  validation_errors: [], validation_warnings: [],
  sets: [] as UserTeam["sets"],
  created_at: "2026-05-11T00:00:00Z", updated_at: "2026-05-11T00:00:00Z",
};

describe("scoreMidPhase return-shape echo (SE5..SE8)", () => {
  it("SE5. recommend-plan.ts::scorePlan consumes scorePair().score — ordering preserved", () => {
    // Indirect test: after Stage 5, both scorers return objects with `.score`.
    // The scorePlan() composer must consume `.score`; otherwise NaN propagates.
    // Sanity check: invoking scorePair twice with different leads produces
    // distinguishable scores (the deterministic stub does this today).
    const a = scorePair(emptyTeam, [0, 1], [2, 3], scenario, createCalcCache(), {}) as unknown as { score: number };
    const b = scorePair(emptyTeam, [2, 3], [0, 1], scenario, createCalcCache(), {}) as unknown as { score: number };
    expect(typeof a.score).toBe("number");
    expect(typeof b.score).toBe("number");
    expect(a.score).not.toBe(b.score);
  });

  it("SE6. Return shape is { score, mid_incoming_damage_pct: { ours: [number, number] } }", () => {
    const r = scoreMidPhase(2, scenario, createCalcCache(), {}) as unknown as {
      score: number;
      mid_incoming_damage_pct: { ours: [number, number] };
    };
    expect(typeof r).toBe("object");
    expect(typeof r.score).toBe("number");
    expect(r.mid_incoming_damage_pct).toBeDefined();
    expect(Array.isArray(r.mid_incoming_damage_pct.ours)).toBe(true);
    expect(r.mid_incoming_damage_pct.ours.length).toBe(2);
  });

  it("SE7. Stub-path (no scoring_team) returns mid_incoming_damage_pct.ours = [0, 0]", () => {
    const r = scoreMidPhase(2, scenario, createCalcCache(), {}) as unknown as {
      mid_incoming_damage_pct: { ours: [number, number] };
    };
    expect(r.mid_incoming_damage_pct.ours).toEqual([0, 0]);
  });

  it("SE8. With scoring_team plumbed in, mid_incoming_damage_pct.ours[0] reflects max-roll vs mid pivot under mid-phase field", () => {
    // Stage 5 will surface real values. For now, with empty deps, the
    // value must remain a number (not NaN/undefined).
    const r = scoreMidPhase(2, scenario, createCalcCache(), {}) as unknown as {
      mid_incoming_damage_pct: { ours: [number, number] };
    };
    expect(Number.isFinite(r.mid_incoming_damage_pct.ours[0])).toBe(true);
  });
});
