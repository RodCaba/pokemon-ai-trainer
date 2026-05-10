/**
 * Stage 4 — RED tests for the support_lift extension to scorePair (plan §9 SP1–SP5).
 * SP1 (regression: existing pair tests stay green) is enforced by NOT editing
 * `score-pair.test.ts`. SP2..SP5 here.
 *
 * Module under test: `src/data/tactical/score-pair.ts` — gains a new
 * `roleAssignments?: Map<species_id, RoleTagAssignment>` dep on `CalcDeps`.
 * When provided, the formula becomes:
 *   α·offense + β·speed − γ·defense_loss + δ·support_lift
 *   where δ = SUPPORT_LIFT_DELTA (default 1.0).
 *
 * support_lift rules (plan §3.3):
 *   +12  if any lead is a setter AND any back is setup_sweeper or cleaner
 *   + 8  if any lead is redirect AND any back is setup_sweeper
 *   + 6  if any lead is setup_sweeper AND any back is cleric
 *   +10  if any lead is anti_priority AND scenario.has_priority_threats
 *   −10  if BOTH leads are setters AND no back is setup_sweeper or cleaner
 */

import { describe, expect, it } from "vitest";
import {
  scorePair,
  computeSupportLift,
  SUPPORT_LIFT_DELTA,
} from "../../../src/data/tactical/score-pair";
import { createCalcCache } from "../../../src/data/tactical/calc-cache";
import type { ScenarioOverview, RoleTagAssignment, RoleTag } from "../../../src/schemas/tactical";

const tag = (primary: RoleTag, all?: RoleTag[]): RoleTagAssignment => ({
  primary,
  all: all ?? [primary],
});

const mkScenario = (
  has_priority_threats = false,
  preview: string[] = ["incineroar", "garchomp"],
): ScenarioOverview => ({
  name: "test",
  type: "archetype",
  field: {
    weather: "none", terrain: "none", trick_room: false,
    tailwind_ours: false, tailwind_theirs: false,
    light_screen: false, reflect: false, gravity: false,
  },
  opposing_preview: preview as [string, ...string[]],
  recommended_leads: ["a", "b"],
  recommended_backline: ["c", "d"],
  rejected_bench: ["e", "f"],
  reasoning: "x",
  key_calcs: [],
  citations: [],
  pair_score: 0,
  // Stage A test extension: scenarios may carry has_priority_threats so the
  // anti_priority lift fires only when relevant.
  ...(has_priority_threats ? { has_priority_threats: true } : {}),
} as ScenarioOverview & { has_priority_threats?: boolean });

describe("computeSupportLift — pure rule table (SP2..SP4)", () => {
  it("SP2. setter leads + setup_sweeper back → +12", () => {
    const roles = new Map<string, RoleTagAssignment>([
      ["sableye", tag("weather_setter")],
      ["pelipper", tag("weather_setter")],
      ["archaludon", tag("setup_sweeper")],
      ["basculegion", tag("cleaner")],
    ]);
    const scenario = mkScenario(false);
    const lift = computeSupportLift({
      leadIds: ["sableye", "pelipper"],
      backIds: ["archaludon", "basculegion"],
      roleAssignments: roles,
      scenario,
    });
    // setter+setter leads with setup_sweeper back → +12
    // BOTH leads are setters AND back HAS setup_sweeper → no -10 penalty
    // setup_sweeper in back is also cleaner; no other rule fires.
    expect(lift).toBe(12);
  });

  it("SP3. two setter leads with NO payoff in back → −10", () => {
    const roles = new Map<string, RoleTagAssignment>([
      ["sableye", tag("weather_setter")],
      ["pelipper", tag("weather_setter")],
      ["dragonite", tag("wallbreaker")],
      ["other", tag("disruptor")],
    ]);
    const lift = computeSupportLift({
      leadIds: ["sableye", "pelipper"],
      backIds: ["dragonite", "other"],
      roleAssignments: roles,
      scenario: mkScenario(false),
    });
    expect(lift).toBe(-10);
  });

  it("SP4a. anti_priority lead + scenario.has_priority_threats=true → +10", () => {
    const roles = new Map<string, RoleTagAssignment>([
      ["farigiraf", tag("speed_control_setter", ["speed_control_setter", "anti_priority"])],
      ["other", tag("wallbreaker")],
      ["b1", tag("wallbreaker")],
      ["b2", tag("wallbreaker")],
    ]);
    const scenarioWithPriority = mkScenario(true);
    const liftOn = computeSupportLift({
      leadIds: ["farigiraf", "other"],
      backIds: ["b1", "b2"],
      roleAssignments: roles,
      scenario: scenarioWithPriority,
    });
    expect(liftOn).toBe(10);
  });

  it("SP4b. anti_priority lead + scenario.has_priority_threats=false → 0 (no fire)", () => {
    const roles = new Map<string, RoleTagAssignment>([
      ["farigiraf", tag("anti_priority")],
      ["other", tag("wallbreaker")],
      ["b1", tag("wallbreaker")],
      ["b2", tag("wallbreaker")],
    ]);
    const lift = computeSupportLift({
      leadIds: ["farigiraf", "other"],
      backIds: ["b1", "b2"],
      roleAssignments: roles,
      scenario: mkScenario(false),
    });
    expect(lift).toBe(0);
  });

  it("SP4c. redirect lead + setup_sweeper back → +8", () => {
    const roles = new Map<string, RoleTagAssignment>([
      ["amoonguss", tag("redirect")],
      ["other", tag("disruptor")],
      ["sweeper", tag("setup_sweeper")],
      ["b2", tag("wallbreaker")],
    ]);
    const lift = computeSupportLift({
      leadIds: ["amoonguss", "other"],
      backIds: ["sweeper", "b2"],
      roleAssignments: roles,
      scenario: mkScenario(false),
    });
    expect(lift).toBe(8);
  });

  it("SP4d. setup_sweeper lead + cleric back → +6", () => {
    const roles = new Map<string, RoleTagAssignment>([
      ["archaludon", tag("setup_sweeper")],
      ["other", tag("wallbreaker")],
      ["sinistcha", tag("cleric")],
      ["b2", tag("wallbreaker")],
    ]);
    const lift = computeSupportLift({
      leadIds: ["archaludon", "other"],
      backIds: ["sinistcha", "b2"],
      roleAssignments: roles,
      scenario: mkScenario(false),
    });
    expect(lift).toBe(6);
  });
});

describe("scorePair — support_lift integration (SP5)", () => {
  it("SP5. SUPPORT_LIFT_DELTA exported as a named constant (no magic numbers)", () => {
    expect(typeof SUPPORT_LIFT_DELTA).toBe("number");
    expect(SUPPORT_LIFT_DELTA).toBe(1.0);
  });

  it("SP5b. scorePair with roleAssignments and a setter+sweeper config produces a higher score than without", () => {
    // Without roleAssignments, the deterministic stub fires (real-engine path
    // requires scoring_team + scoring_panel — out of scope here). The stub
    // path also fires when no calc deps; we assert that adding roleAssignments
    // shifts the score by exactly support_lift × δ.
    const team = {
      schema_version: 1 as const,
      id: "test",
      name: "test",
      description: null,
      win_condition: null,
      status: "saved" as const,
      origin: "builder" as const,
      origin_payload: null,
      source_tournament_team_id: null,
      validation_errors: [],
      validation_warnings: [],
      created_at: "2026-05-09T00:00:00Z",
      updated_at: "2026-05-09T00:00:00Z",
      sets: [],
    };
    const scenario = mkScenario(false);
    const cache = createCalcCache();
    const baseScore = scorePair(team, [0, 1], [2, 3], scenario, cache, {});

    const roleAssignments = new Map<string, RoleTagAssignment>([
      // Map indices 0..3 to species ids by overlay; the test confirms the lift
      // is applied conditionally on roleAssignments being present.
      ["sableye", tag("weather_setter")],
      ["pelipper", tag("weather_setter")],
      ["archaludon", tag("setup_sweeper")],
      ["basculegion", tag("cleaner")],
    ]);
    const liftedScore = scorePair(team, [0, 1], [2, 3], scenario, cache, {
      roleAssignments,
      teamSlotSpeciesIds: ["sableye", "pelipper", "archaludon", "basculegion", "x", "y"],
    });
    // setter+setter → setup_sweeper+cleaner back: +12 lift.
    expect(liftedScore - baseScore).toBeCloseTo(12 * SUPPORT_LIFT_DELTA, 5);
  });
});
