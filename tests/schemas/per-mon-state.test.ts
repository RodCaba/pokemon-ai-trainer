/**
 * Stage 4 — RED tests for Stage D per-mon-state schema additions (S1..S8).
 *
 * Pure-data exemption: batched per CLAUDE.md §3.
 *
 * Plan: docs/plans/per-mon-state-tracking.md §3 + §10.
 *   S1..S6 — MonStateSchema / PhaseStateSchema / per-phase optional
 *            `state` field / TeamTacticalOverview bump 4 → 5.
 *   S7..S8 — MoveSpec.bp override (calc.ts).
 */

import { describe, expect, it } from "vitest";
import {
  LeadPhaseSchema,
  MidPhaseSchema,
  LatePhaseSchema,
  MonStateSchema,
  PhaseStateSchema,
  ScenarioFieldSchema,
  TeamTacticalOverviewSchema,
} from "../../src/schemas/tactical";
import { MoveSpecSchema } from "../../src/schemas/calc";

const healthyMon = {
  species_id: "archaludon",
  hp_pct: 100,
  boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 },
  status: "none" as const,
  choice_locked_move: null,
};

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

describe("MonStateSchema (S1..S3)", () => {
  it("S1. round-trips a healthy actor; rejects unknown key (.strict())", () => {
    const r = MonStateSchema.parse(healthyMon);
    // typed loosely because of the stub
    expect((r as { hp_pct: number }).hp_pct).toBe(100);
    expect(
      MonStateSchema.safeParse({ ...healthyMon, frobnicate: true }).success,
    ).toBe(false);
  });

  it("S2. rejects hp_pct: 0 and hp_pct: 101; accepts 1 and 100", () => {
    expect(MonStateSchema.safeParse({ ...healthyMon, hp_pct: 0 }).success).toBe(false);
    expect(MonStateSchema.safeParse({ ...healthyMon, hp_pct: 101 }).success).toBe(false);
    expect(MonStateSchema.safeParse({ ...healthyMon, hp_pct: 1 }).success).toBe(true);
    expect(MonStateSchema.safeParse({ ...healthyMon, hp_pct: 100 }).success).toBe(true);
  });

  it("S3. boosts.def accepts -6..+6; rejects 7 and -7", () => {
    const mk = (def: number) => ({ ...healthyMon, boosts: { ...healthyMon.boosts, def } });
    expect(MonStateSchema.safeParse(mk(-6)).success).toBe(true);
    expect(MonStateSchema.safeParse(mk(6)).success).toBe(true);
    expect(MonStateSchema.safeParse(mk(7)).success).toBe(false);
    expect(MonStateSchema.safeParse(mk(-7)).success).toBe(false);
  });
});

describe("PhaseStateSchema (S4)", () => {
  it("S4. round-trips a full object; .strict() rejects unknown key", () => {
    const ps = {
      ours: [healthyMon],
      theirs: [{ ...healthyMon, species_id: "incineroar" }],
      fallen_allies_ours: 0,
      fallen_allies_theirs: 0,
    };
    const r = PhaseStateSchema.parse(ps);
    expect((r as { fallen_allies_ours: number }).fallen_allies_ours).toBe(0);
    expect(
      PhaseStateSchema.safeParse({ ...ps, frobnicate: true }).success,
    ).toBe(false);
  });
});

describe("Phase schemas — per-phase `state` (S5)", () => {
  it("S5a. LeadPhaseSchema.state is optional (absence parses)", () => {
    expect(LeadPhaseSchema.safeParse(validLead).success).toBe(true);
  });

  it("S5b. LeadPhaseSchema accepts a populated `state`", () => {
    const ps = {
      ours: [healthyMon, { ...healthyMon, species_id: "sableye" }],
      theirs: [healthyMon, healthyMon],
      fallen_allies_ours: 0,
      fallen_allies_theirs: 0,
    };
    const r = LeadPhaseSchema.parse({ ...validLead, state: ps });
    expect((r as { state?: unknown }).state).toBeDefined();
  });

  it("S5c. MidPhaseSchema.state optional; LatePhaseSchema.state optional", () => {
    expect(MidPhaseSchema.safeParse(validMid).success).toBe(true);
    expect(LatePhaseSchema.safeParse(validLate).success).toBe(true);
    const ps = {
      ours: [healthyMon],
      theirs: [healthyMon],
      fallen_allies_ours: 0,
      fallen_allies_theirs: 0,
    };
    expect(MidPhaseSchema.safeParse({ ...validMid, state: ps }).success).toBe(true);
    expect(LatePhaseSchema.safeParse({ ...validLate, state: ps }).success).toBe(true);
  });
});

describe("TeamTacticalOverviewSchema bump 4 → 5 (S6)", () => {
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

  it("S6a. accepts schema_version: 5", () => {
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

  it("S6b. rejects schema_version: 4 (Stage C → D bump)", () => {
    expect(
      TeamTacticalOverviewSchema.safeParse({
        schema_version: 4,
        team_id: "t1",
        generated_at: "2026-05-11T00:00:00Z",
        threat_panel_as_of: "2026-05-11",
        pillars: fiveBundle,
        scenarios: Array.from({ length: 5 }, () => planScenario),
      }).success,
    ).toBe(false);
  });
});

describe("MoveSpecSchema.bp override (S7..S8)", () => {
  it("S7. accepts bp: 100; rejects bp: 0 and bp: 251", () => {
    expect(MoveSpecSchema.safeParse({ name: "Last Respects", bp: 100 }).success).toBe(true);
    expect(MoveSpecSchema.safeParse({ name: "Last Respects", bp: 0 }).success).toBe(false);
    expect(MoveSpecSchema.safeParse({ name: "Last Respects", bp: 251 }).success).toBe(false);
    expect(MoveSpecSchema.safeParse({ name: "Last Respects", bp: 1 }).success).toBe(true);
    expect(MoveSpecSchema.safeParse({ name: "Last Respects", bp: 250 }).success).toBe(true);
  });

  it("S8. parses without `bp` (undefined) — backwards compat", () => {
    const r = MoveSpecSchema.safeParse({ name: "Earthquake" });
    expect(r.success).toBe(true);
  });
});
