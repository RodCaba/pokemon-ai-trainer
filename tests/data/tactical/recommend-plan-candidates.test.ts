/**
 * Stage 4 — RED tests for plan candidate generation (PG1..PG6).
 * Module under test: `src/data/tactical/recommend-plan.ts`
 *   `generatePlanCandidates(team, scenario, roleAssignments) → PlanCandidate[]`
 *
 * Rules per plan §5:
 *   - Disjointness: |{leads[0], leads[1], mid, cleaner}| = 4.
 *   - Leads gate: at least one lead carries a "lead-eligible" role tag
 *     (any setter / redirect / disruptor / wallbreaker).
 *   - Mid gate: mid carries cleric / redirect / pivot / wallbreaker /
 *     setup_sweeper / disruptor. Pure-cleaner mids are dropped.
 *   - Cleaner gate: cleaner satisfies `base_spe ≥ 90 OR Choice Scarf OR
 *     has_priority_move`. Q1 §17 fallback when no slot passes — Stage 5
 *     covers this; PG6 here pins the empty-set behavior.
 */

import { describe, expect, it } from "vitest";
import {
  generatePlanCandidates,
} from "../../../src/data/tactical/recommend-plan";
import type { RoleTag, RoleTagAssignment, ScenarioOverview } from "../../../src/schemas/tactical";
import type { UserTeam } from "../../../src/schemas/user-teams";

const tag = (primary: RoleTag, all?: RoleTag[]): RoleTagAssignment => ({
  primary,
  all: all ?? [primary],
});

// Minimal 6-set UserTeam shaped just for the candidate-generation algorithm.
// The classifier consumes species_id only; sets are otherwise opaque to it.
const mkSet = (slot: number, species_id: string): Record<string, unknown> => ({
  slot,
  species_id,
  nickname: null,
  item_id: null,
  ability_id: null,
  nature: null,
  hp_sps: 0, atk_sps: 0, def_sps: 0, spa_sps: 0, spd_sps: 0, spe_sps: 0,
  move_1_id: null, move_2_id: null, move_3_id: null, move_4_id: null,
  notes: null,
});

const archaEyeTeam: UserTeam = {
  schema_version: 1,
  id: "01H000000000000000000000AE",
  name: "ArchaEye",
  description: null,
  win_condition: null,
  status: "saved",
  origin: "paste",
  origin_payload: null,
  source_tournament_team_id: null,
  validation_errors: [],
  validation_warnings: [],
  sets: [
    mkSet(0, "sableye"),
    mkSet(1, "archaludon"),
    mkSet(2, "basculegion"),
    mkSet(3, "pelipper"),
    mkSet(4, "sinistcha"),
    mkSet(5, "dragonite"),
  ] as UserTeam["sets"],
  created_at: "2026-05-10T00:00:00Z",
  updated_at: "2026-05-10T00:00:00Z",
};

const archaEyeRoles = new Map<string, RoleTagAssignment>([
  ["sableye", tag("weather_setter", ["weather_setter", "screen_setter", "disruptor"])],
  ["archaludon", tag("setup_sweeper", ["setup_sweeper"])],
  ["basculegion", tag("cleaner", ["cleaner", "pivot"])],
  ["pelipper", tag("weather_setter", ["weather_setter", "speed_control_setter", "disruptor"])],
  ["sinistcha", tag("speed_control_setter", ["speed_control_setter", "redirect", "cleric"])],
  ["dragonite", tag("speed_control_setter")],
]);

const sunScenario: ScenarioOverview = {
  name: "Sun",
  type: "archetype",
  field: {
    weather: "sun", terrain: "none", trick_room: false,
    tailwind_ours: false, tailwind_theirs: false,
    light_screen: false, reflect: false, gravity: false,
  },
  opposing_preview: ["charizardmegay", "venusaur"],
  recommended_leads: ["x", "y"],
  recommended_backline: ["x", "y"],
  rejected_bench: ["x", "y"],
  reasoning: "",
  key_calcs: [],
  citations: [],
  pair_score: 0,
};

describe("generatePlanCandidates (PG1..PG6)", () => {
  it("PG1. emits at least one candidate for the ArchaEye fixture team", () => {
    const cands = generatePlanCandidates(archaEyeTeam, sunScenario, archaEyeRoles);
    expect(cands.length).toBeGreaterThan(0);
  });

  it("PG2. all returned candidates have disjoint slot indices", () => {
    const cands = generatePlanCandidates(archaEyeTeam, sunScenario, archaEyeRoles);
    for (const c of cands) {
      const ids = new Set([c.leads[0], c.leads[1], c.mid, c.cleaner]);
      expect(ids.size).toBe(4);
    }
  });

  it("PG3. every leads pair has at least one lead-eligible role tag", () => {
    const cands = generatePlanCandidates(archaEyeTeam, sunScenario, archaEyeRoles);
    const leadEligible = new Set<RoleTag>([
      "weather_setter", "speed_control_setter", "screen_setter",
      "redirect", "disruptor", "wallbreaker",
    ]);
    for (const c of cands) {
      const a = archaEyeRoles.get(archaEyeTeam.sets[c.leads[0]]!.species_id!);
      const b = archaEyeRoles.get(archaEyeTeam.sets[c.leads[1]]!.species_id!);
      const anyEligible =
        (a?.all.some((t) => leadEligible.has(t)) ?? false) ||
        (b?.all.some((t) => leadEligible.has(t)) ?? false);
      expect(anyEligible).toBe(true);
    }
  });

  it("PG4. mid slot has a mid-eligible role tag (not a pure cleaner)", () => {
    const cands = generatePlanCandidates(archaEyeTeam, sunScenario, archaEyeRoles);
    const midEligible = new Set<RoleTag>([
      "cleric", "redirect", "pivot", "wallbreaker", "setup_sweeper", "disruptor",
    ]);
    for (const c of cands) {
      const a = archaEyeRoles.get(archaEyeTeam.sets[c.mid]!.species_id!);
      const hasMid = a?.all.some((t) => midEligible.has(t)) ?? false;
      expect(hasMid).toBe(true);
    }
  });

  it("PG5. candidate count after pruning is bounded — flow §6.2 says ~30–60", () => {
    const cands = generatePlanCandidates(archaEyeTeam, sunScenario, archaEyeRoles);
    expect(cands.length).toBeLessThanOrEqual(180);
  });

  it("PG6. empty roleAssignments produces zero candidates (defensive)", () => {
    const cands = generatePlanCandidates(archaEyeTeam, sunScenario, new Map());
    expect(cands).toEqual([]);
  });
});
