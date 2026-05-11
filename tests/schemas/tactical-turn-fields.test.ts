/**
 * Stage 4 — RED tests for Stage C turn-weighted schema additions (S1..S5).
 * Pure-data exemption: batched.
 */

import { describe, expect, it } from "vitest";
import {
  LeadPhaseSchema,
  MidPhaseSchema,
  LatePhaseSchema,
  TeamTacticalOverviewSchema,
  RoleTagAssignmentSchema,
  ScenarioFieldSchema,
} from "../../src/schemas/tactical";

const validLead = {
  phase: "lead" as const,
  turn_window: [1, 2] as [number, number],
  active: ["sableye", "archaludon"] as [string, string],
  rationale: "x",
  key_calcs: [],
  abandon_if: "y",
};
const validMid = {
  phase: "mid" as const,
  turn_window: [2, 4] as [number, number],
  pivot_in: "sinistcha",
  pivot_out: null,
  rationale: "x",
  key_calcs: [],
  trigger: "y",
};
const validLate = {
  phase: "late" as const,
  turn_window: [4, 8] as [number, number],
  cleaner: "basculegion",
  rationale: "x",
  key_calcs: [],
  win_condition: "y",
};

describe("Phase schemas — per-phase `field` (S1..S3)", () => {
  it("S1. LeadPhaseSchema accepts a populated `field`; rejects unknown field key", () => {
    const f = ScenarioFieldSchema.parse({ weather: "rain", tailwind_ours: true });
    const r = LeadPhaseSchema.parse({ ...validLead, field: f });
    expect(r.field?.weather).toBe("rain");
    // ScenarioFieldSchema is .strict(); unknown keys rejected at the
    // field-schema level, which the phase schema inherits.
    expect(
      LeadPhaseSchema.safeParse({ ...validLead, field: { ...f, frobnicate: true } as unknown }).success,
    ).toBe(false);
  });

  it("S2. MidPhaseSchema.field is optional; absence parses fine", () => {
    expect(MidPhaseSchema.safeParse(validMid).success).toBe(true);
    const r = MidPhaseSchema.parse({
      ...validMid,
      field: ScenarioFieldSchema.parse({ weather: "rain" }),
    });
    expect(r.field?.weather).toBe("rain");
  });

  it("S3. LatePhaseSchema.field accepts neutral defaults", () => {
    const r = LatePhaseSchema.parse({
      ...validLate,
      field: ScenarioFieldSchema.parse({}),
    });
    expect(r.field?.weather).toBe("none");
    expect(r.field?.trick_room).toBe(false);
  });
});

describe("TeamTacticalOverviewSchema bump 3 → 4 (S4)", () => {
  const mkPillar = (pillar: string) => ({ pillar, score: 50, tier: "OK" as const, evidence: {} });
  const fiveBundle = {
    offense: mkPillar("offense"),
    defense: mkPillar("defense"),
    speed: mkPillar("speed"),
    synergy: mkPillar("synergy"),
    support: mkPillar("support"),
  };
  const planScenario = {
    name: "Sun",
    type: "archetype" as const,
    field: ScenarioFieldSchema.parse({}),
    opposing_preview: ["charizard"],
    phases: [validLead, validMid, validLate] as [typeof validLead, typeof validMid, typeof validLate],
    plan_score: 50,
    citations: [],
  };

  it("S4a. accepts schema_version: 4", () => {
    expect(
      TeamTacticalOverviewSchema.safeParse({
        schema_version: 5,
        team_id: "t1",
        generated_at: "2026-05-11T00:00:00Z",
        threat_panel_as_of: "2026-05-11",
        pillars: fiveBundle,
        scenarios: Array.from({ length: 5 }, () => planScenario),
      }).success,
    ).toBe(true);
  });

  it("S4b. rejects schema_version: 3 (Stage B → C bump)", () => {
    expect(
      TeamTacticalOverviewSchema.safeParse({
        schema_version: 3,
        team_id: "t1",
        generated_at: "2026-05-11T00:00:00Z",
        threat_panel_as_of: "2026-05-11",
        pillars: fiveBundle,
        scenarios: Array.from({ length: 5 }, () => planScenario),
      }).success,
    ).toBe(false);
  });
});

describe("RoleTagAssignmentSchema.setter_priority_via_ability (S5)", () => {
  const base = { primary: "weather_setter" as const, all: ["weather_setter"] as const };

  it("S5a. round-trips a Sableye + Prankster + Rain Dance shape", () => {
    const r = RoleTagAssignmentSchema.parse({
      ...base,
      setter_priority_via_ability: {
        kind: "status",
        bonus: 1,
        move_id: "raindance",
        effect: "weather_rain",
      },
    });
    expect(r.setter_priority_via_ability?.effect).toBe("weather_rain");
  });

  it("S5b. rejects malformed `effect` value", () => {
    expect(
      RoleTagAssignmentSchema.safeParse({
        ...base,
        setter_priority_via_ability: {
          kind: "status", bonus: 1, move_id: "x", effect: "weather_fog",
        },
      }).success,
    ).toBe(false);
  });

  it("S5c. accepts Triage healing shape", () => {
    const r = RoleTagAssignmentSchema.parse({
      ...base,
      setter_priority_via_ability: {
        kind: "healing", bonus: 3, move_id: "floralhealing", effect: "healing",
      },
    });
    expect(r.setter_priority_via_ability?.kind).toBe("healing");
  });

  it("S5d. accepts Gale Wings full-HP condition", () => {
    const r = RoleTagAssignmentSchema.parse({
      ...base,
      setter_priority_via_ability: {
        kind: "flying", bonus: 1, condition: "full_hp",
        move_id: "tailwind", effect: "tailwind",
      },
    });
    expect(r.setter_priority_via_ability?.condition).toBe("full_hp");
  });

  it("S5e. setter_priority_via_ability is optional (absent = legacy shape)", () => {
    expect(RoleTagAssignmentSchema.safeParse(base).success).toBe(true);
  });
});
