/**
 * Stage 4 — RED tests for recommend-plan integration (PS9..PS12 +
 * RP1..RP6). Spans plan composition, chain bonus, and end-to-end
 * output shape per plan §10.
 */

import { describe, expect, it } from "vitest";
import {
  recommendTeamPlan,
} from "../../../src/data/tactical/recommend-plan";
import { createCalcCache } from "../../../src/data/tactical/calc-cache";
import { open } from "../../../src/db/open";
import {
  TeamPlanScenarioSchema,
  type RoleTagAssignment,
  type RoleTag,
  type ScenarioOverview,
} from "../../../src/schemas/tactical";
import type { UserTeam } from "../../../src/schemas/user-teams";

const tag = (primary: RoleTag, all?: RoleTag[]): RoleTagAssignment => ({
  primary,
  all: all ?? [primary],
});

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
    mkSet(0, "sableye"), mkSet(1, "archaludon"), mkSet(2, "basculegion"),
    mkSet(3, "pelipper"), mkSet(4, "sinistcha"), mkSet(5, "dragonite"),
  ] as UserTeam["sets"],
  created_at: "2026-05-10T00:00:00Z",
  updated_at: "2026-05-10T00:00:00Z",
};

const archaEyeRoles = new Map<string, RoleTagAssignment>([
  ["sableye", tag("weather_setter", ["weather_setter", "screen_setter", "disruptor"])],
  ["archaludon", tag("setup_sweeper")],
  ["basculegion", tag("cleaner", ["cleaner", "pivot"])],
  ["pelipper", tag("weather_setter", ["weather_setter", "speed_control_setter", "disruptor"])],
  ["sinistcha", tag("speed_control_setter", ["speed_control_setter", "redirect", "cleric"])],
  ["dragonite", tag("speed_control_setter")],
]);

const rainScenario: ScenarioOverview = {
  name: "Rain",
  type: "archetype",
  field: {
    weather: "rain", terrain: "none", trick_room: false,
    tailwind_ours: false, tailwind_theirs: false,
    light_screen: false, reflect: false, gravity: false,
  },
  opposing_preview: ["pelipper", "archaludon"],
  recommended_leads: ["a", "b"],
  recommended_backline: ["a", "b"],
  rejected_bench: ["a", "b"],
  reasoning: "",
  key_calcs: [],
  citations: [],
  pair_score: 0,
};

describe("recommendTeamPlan integration (RP1..RP6)", () => {
  it("RP1. emits a TeamPlanScenario that parses against TeamPlanScenarioSchema", () => {
    const db = open(":memory:");
    try {
      const plan = recommendTeamPlan(archaEyeTeam, rainScenario, createCalcCache(), {
        db,
        roleAssignments: archaEyeRoles,
      });
      const parsed = TeamPlanScenarioSchema.safeParse(plan);
      expect(parsed.success).toBe(true);
    } finally {
      db.$client.close();
    }
  });

  it("RP2. on ArchaEye in a rain scenario, lead phase active contains a (rain weather_setter + setup_sweeper) pair", () => {
    const db = open(":memory:");
    try {
      const plan = recommendTeamPlan(archaEyeTeam, rainScenario, createCalcCache(), {
        db,
        roleAssignments: archaEyeRoles,
      });
      const leadIds = new Set(plan.phases[0].active);
      const hasRainSetter =
        [...leadIds].some((id) => archaEyeRoles.get(id)?.all.includes("weather_setter") ?? false);
      const hasSweeper =
        [...leadIds].some((id) => archaEyeRoles.get(id)?.all.includes("setup_sweeper") ?? false);
      expect(hasRainSetter && hasSweeper).toBe(true);
    } finally {
      db.$client.close();
    }
  });

  it("RP3. mid phase pivot_in carries a cleric or redirect role", () => {
    const db = open(":memory:");
    try {
      const plan = recommendTeamPlan(archaEyeTeam, rainScenario, createCalcCache(), {
        db,
        roleAssignments: archaEyeRoles,
      });
      const midRoles = archaEyeRoles.get(plan.phases[1].pivot_in)?.all ?? [];
      const hasClericOrRedirect = midRoles.includes("cleric") || midRoles.includes("redirect");
      expect(hasClericOrRedirect).toBe(true);
    } finally {
      db.$client.close();
    }
  });

  it("RP4. late phase cleaner has the `cleaner` role tag", () => {
    const db = open(":memory:");
    try {
      const plan = recommendTeamPlan(archaEyeTeam, rainScenario, createCalcCache(), {
        db,
        roleAssignments: archaEyeRoles,
      });
      const all = archaEyeRoles.get(plan.phases[2].cleaner)?.all ?? [];
      expect(all.includes("cleaner")).toBe(true);
    } finally {
      db.$client.close();
    }
  });

  it("RP5. plan_score is positive when the role-chain bonus fires", () => {
    const db = open(":memory:");
    try {
      const plan = recommendTeamPlan(archaEyeTeam, rainScenario, createCalcCache(), {
        db,
        roleAssignments: archaEyeRoles,
      });
      expect(plan.plan_score).toBeGreaterThan(0);
    } finally {
      db.$client.close();
    }
  });

  it("RP6. lead phase support_lift is present (Q9 §17 preserves Stage A signal)", () => {
    const db = open(":memory:");
    try {
      const plan = recommendTeamPlan(archaEyeTeam, rainScenario, createCalcCache(), {
        db,
        roleAssignments: archaEyeRoles,
      });
      expect(plan.phases[0].support_lift).toBeDefined();
    } finally {
      db.$client.close();
    }
  });
});
