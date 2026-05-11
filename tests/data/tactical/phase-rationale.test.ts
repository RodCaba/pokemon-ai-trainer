/**
 * Stage 4 — RED tests for the phase rationale builders (PR1..PR5).
 *
 * Plan §7 + Q8 §17:
 *   - Deterministic templates only (no LLM).
 *   - ≤ 300 chars per `rationale` field, ≤ 200 chars per
 *     `abandon_if` / `trigger` / `win_condition`.
 *   - Truncate on last word + append `…` when over budget.
 */

import { describe, expect, it } from "vitest";
import {
  buildLeadRationale,
  buildMidRationale,
  buildLateRationale,
  buildAbandonIf,
  buildMidTrigger,
  buildWinCondition,
} from "../../../src/data/tactical/phase-rationale";
import type { CalcResultRef, RoleTag, RoleTagAssignment, ScenarioSkeleton } from "../../../src/schemas/tactical";

const tag = (primary: RoleTag, all?: RoleTag[]): RoleTagAssignment => ({
  primary,
  all: all ?? [primary],
});

const roles = new Map<string, RoleTagAssignment>([
  ["sableye", tag("weather_setter", ["weather_setter", "screen_setter", "disruptor"])],
  ["archaludon", tag("setup_sweeper")],
  ["sinistcha", tag("speed_control_setter", ["speed_control_setter", "redirect", "cleric"])],
  ["basculegion", tag("cleaner")],
]);

const scenario: ScenarioSkeleton = {
  name: "Sand",
  type: "archetype",
  field: {
    weather: "sand", terrain: "none", trick_room: false,
    tailwind_ours: false, tailwind_theirs: false,
    light_screen: false, reflect: false, gravity: false,
  },
  opposing_preview: ["hippowdon", "excadrill"],
};

const calc: CalcResultRef = {
  attacker_species_id: "archaludon",
  defender_species_id: "hippowdon",
  move_id: "Electro Shot",
  max_roll_pct: 102.4,
  ko_chance_desc: "guaranteed OHKO",
  field_summary: "Rain|None|-",
};

describe("phase-rationale builders (PR1..PR5)", () => {
  it("PR1. lead rationale ≤ 300 chars + non-empty", () => {
    const r = buildLeadRationale({
      leads: ["sableye", "archaludon"],
      scenario,
      roleAssignments: roles,
      topCalc: calc,
    });
    expect(r.length).toBeGreaterThan(0);
    expect(r.length).toBeLessThanOrEqual(300);
  });

  it("PR2. mid rationale ≤ 300 chars + names the pivot", () => {
    const r = buildMidRationale({
      pivot_in: "sinistcha",
      scenario,
      roleAssignments: roles,
      topCalc: null,
    });
    expect(r.length).toBeLessThanOrEqual(300);
    expect(r.toLowerCase()).toContain("sinistcha");
  });

  it("PR3. late rationale ≤ 300 chars + names the cleaner", () => {
    const r = buildLateRationale({
      cleaner: "basculegion",
      scenario,
      roleAssignments: roles,
      topCalc: null,
    });
    expect(r.length).toBeLessThanOrEqual(300);
    expect(r.toLowerCase()).toContain("basculegion");
  });

  it("PR4. abandon_if / trigger / win_condition each ≤ 200 chars", () => {
    const a = buildAbandonIf({
      leads: ["sableye", "archaludon"],
      scenario,
      roleAssignments: roles,
      topCalc: calc,
    });
    const b = buildMidTrigger({
      pivot_in: "sinistcha",
      scenario,
      roleAssignments: roles,
      topCalc: null,
    });
    const c = buildWinCondition({
      cleaner: "basculegion",
      scenario,
      roleAssignments: roles,
      topCalc: null,
    });
    expect(a.length).toBeLessThanOrEqual(200);
    expect(b.length).toBeLessThanOrEqual(200);
    expect(c.length).toBeLessThanOrEqual(200);
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
    expect(c.length).toBeGreaterThan(0);
  });

  it("PR5. lead rationale includes the top-calc summary when present", () => {
    const r = buildLeadRationale({
      leads: ["sableye", "archaludon"],
      scenario,
      roleAssignments: roles,
      topCalc: calc,
    });
    // The template should mention the attacker or the move id, mirroring
    // recommend-leads.ts:199 style ("Move OHKOs defender (X% max).").
    expect(r.match(/electro shot|archaludon/i)).not.toBeNull();
  });
});
