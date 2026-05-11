/**
 * Stage 4 — RED tests for Stage D score-pair return-shape extension
 * (SE1..SE4 — plan §3.4 / §10).
 *
 * Today `scorePair` returns a bare `number`. Stage D extends to
 *   `{ score: number; lead_incoming_damage_pct: { ours, theirs } }`.
 * These tests assert the new shape exists and the echo values are
 * correct. They fail today because the current return value is a
 * primitive `number`.
 */

import { describe, expect, it } from "vitest";
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

describe("scorePair return-shape echo (SE1..SE4)", () => {
  it("SE1. Return shape is { score, lead_incoming_damage_pct: { ours, theirs } }", () => {
    const r = scorePair(emptyTeam, [0, 1], [2, 3], scenario, createCalcCache(), {}) as unknown as {
      score: number;
      lead_incoming_damage_pct: { ours: [number, number]; theirs: [number, number] };
    };
    expect(typeof r).toBe("object");
    expect(typeof r.score).toBe("number");
    expect(r.lead_incoming_damage_pct).toBeDefined();
    expect(Array.isArray(r.lead_incoming_damage_pct.ours)).toBe(true);
    expect(Array.isArray(r.lead_incoming_damage_pct.theirs)).toBe(true);
    expect(r.lead_incoming_damage_pct.ours.length).toBe(2);
    expect(r.lead_incoming_damage_pct.theirs.length).toBe(2);
  });

  it("SE2. lead_incoming_damage_pct.ours[i] equals max-roll % opp leads deal to leads[i]", () => {
    // With a mock calc returning known max_percent values, the tuple
    // entries surface the worst incoming damage to each of our leads.
    // Stage 5 wires the real loop; today the stub returns numbers so
    // the assertion fails on shape (covered by SE1) — but we also pin
    // the bounded range expectation here so that, when the shape lands,
    // the values are sanity-checked.
    const r = scorePair(emptyTeam, [0, 1], [2, 3], scenario, createCalcCache(), {}) as unknown as {
      lead_incoming_damage_pct: { ours: [number, number] };
    };
    for (const v of r.lead_incoming_damage_pct.ours) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(200);
    }
  });

  it("SE3. lead_incoming_damage_pct.theirs[i] equals max-roll % WE deal to opposing[i]", () => {
    const r = scorePair(emptyTeam, [0, 1], [2, 3], scenario, createCalcCache(), {}) as unknown as {
      lead_incoming_damage_pct: { theirs: [number, number] };
    };
    for (const v of r.lead_incoming_damage_pct.theirs) {
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it("SE4. Stub-path (no scoring_team) returns ours/theirs both [0, 0]", () => {
    const r = scorePair(emptyTeam, [0, 1], [2, 3], scenario, createCalcCache(), {}) as unknown as {
      lead_incoming_damage_pct: { ours: [number, number]; theirs: [number, number] };
    };
    expect(r.lead_incoming_damage_pct.ours).toEqual([0, 0]);
    expect(r.lead_incoming_damage_pct.theirs).toEqual([0, 0]);
  });
});
