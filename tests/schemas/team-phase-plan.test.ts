/**
 * Stage 4 — RED tests for the team-phase-plan schemas (S1..S6).
 * Pure-data exemption: these land in the batched Stage 4 commit.
 */

import { describe, expect, it } from "vitest";
import {
  LeadPhaseSchema,
  MidPhaseSchema,
  LatePhaseSchema,
  PhaseSchema,
  TeamPlanScenarioSchema,
  TeamTacticalOverviewSchema,
  RecommendTeamPlanInputSchema,
  RecommendTeamPlanOutputSchema,
  TacticalCitationSchema,
  ScenarioFieldSchema,
} from "../../src/schemas/tactical";

const validLead = {
  phase: "lead" as const,
  turn_window: [1, 2] as [number, number],
  active: ["sableye", "archaludon"] as [string, string],
  rationale: "Lead Sableye + Archaludon to set screens.",
  key_calcs: [],
  abandon_if: "Sableye falls before turn 2.",
};
const validMid = {
  phase: "mid" as const,
  turn_window: [2, 4] as [number, number],
  pivot_in: "sinistcha",
  pivot_out: "sableye",
  rationale: "Sinistcha pivots in to redirect + heal.",
  key_calcs: [],
  trigger: "Sableye falls or screens expire.",
};
const validLate = {
  phase: "late" as const,
  turn_window: [4, 8] as [number, number],
  cleaner: "basculegion",
  rationale: "Basculegion revenge-KOs survivors.",
  key_calcs: [],
  win_condition: "Archaludon clears a slot; Basculegion cleans.",
};

describe("LeadPhaseSchema / MidPhaseSchema / LatePhaseSchema (S1)", () => {
  it("S1a. LeadPhaseSchema round-trips a valid lead phase", () => {
    expect(LeadPhaseSchema.parse(validLead).phase).toBe("lead");
  });
  it("S1b. MidPhaseSchema round-trips with pivot_out null", () => {
    const p = MidPhaseSchema.parse({ ...validMid, pivot_out: null });
    expect(p.pivot_out).toBeNull();
  });
  it("S1c. LatePhaseSchema rejects empty win_condition", () => {
    expect(LatePhaseSchema.safeParse({ ...validLate, win_condition: "" }).success).toBe(true);
    expect(LatePhaseSchema.safeParse({ ...validLate, win_condition: "x".repeat(201) }).success).toBe(false);
  });
});

describe("TurnWindow refinement (S2)", () => {
  it("S2a. rejects descending turn_window [3, 1]", () => {
    expect(
      LeadPhaseSchema.safeParse({ ...validLead, turn_window: [3, 1] }).success,
    ).toBe(false);
  });
  it("S2b. accepts equal-bounds turn_window [4, 4]", () => {
    expect(
      LatePhaseSchema.safeParse({ ...validLate, turn_window: [4, 4] }).success,
    ).toBe(true);
  });
  it("S2c. rejects non-integer turn", () => {
    expect(
      LeadPhaseSchema.safeParse({ ...validLead, turn_window: [1.5, 2] }).success,
    ).toBe(false);
  });
});

describe("PhaseSchema discriminated union (S3)", () => {
  it("S3a. PhaseSchema accepts each phase shape via discriminator", () => {
    expect(PhaseSchema.parse(validLead).phase).toBe("lead");
    expect(PhaseSchema.parse(validMid).phase).toBe("mid");
    expect(PhaseSchema.parse(validLate).phase).toBe("late");
  });
  it("S3b. PhaseSchema rejects an unknown phase discriminator", () => {
    expect(
      PhaseSchema.safeParse({ ...validLead, phase: "midgame" }).success,
    ).toBe(false);
  });
});

describe("TeamPlanScenarioSchema (S4)", () => {
  const validScenario = {
    name: "Rain",
    type: "archetype" as const,
    field: ScenarioFieldSchema.parse({}),
    opposing_preview: ["pelipper"],
    phases: [validLead, validMid, validLate] as [typeof validLead, typeof validMid, typeof validLate],
    plan_score: 88.4,
    citations: [],
  };

  it("S4a. round-trips a valid TeamPlanScenario", () => {
    const r = TeamPlanScenarioSchema.parse(validScenario);
    expect(r.phases).toHaveLength(3);
    expect(r.phases[0].phase).toBe("lead");
    expect(r.phases[1].phase).toBe("mid");
    expect(r.phases[2].phase).toBe("late");
  });

  it("S4b. rejects out-of-order phases", () => {
    const bad = { ...validScenario, phases: [validMid, validLead, validLate] };
    expect(TeamPlanScenarioSchema.safeParse(bad).success).toBe(false);
  });

  it("S4c. rejects a 2-phase plan", () => {
    const bad = { ...validScenario, phases: [validLead, validMid] };
    expect(TeamPlanScenarioSchema.safeParse(bad).success).toBe(false);
  });
});

describe("TeamTacticalOverviewSchema bump to v3 (S5)", () => {
  const mkPillar = (pillar: string) => ({ pillar, score: 50, tier: "OK" as const, evidence: {} });
  const fiveBundle = {
    offense: mkPillar("offense"),
    defense: mkPillar("defense"),
    speed: mkPillar("speed"),
    synergy: mkPillar("synergy"),
    support: mkPillar("support"),
  };
  const planScenario = {
    name: "Rain",
    type: "archetype" as const,
    field: ScenarioFieldSchema.parse({}),
    opposing_preview: ["pelipper"],
    phases: [validLead, validMid, validLate] as [typeof validLead, typeof validMid, typeof validLate],
    plan_score: 80,
    citations: [],
  };

  it("S5a. accepts schema_version: 3 with TeamPlanScenarios", () => {
    const ok = TeamTacticalOverviewSchema.parse({
      schema_version: 3,
      team_id: "t1",
      generated_at: "2026-05-11T00:00:00Z",
      threat_panel_as_of: "2026-05-10",
      pillars: fiveBundle,
      scenarios: Array.from({ length: 5 }, () => planScenario),
    });
    expect(ok.schema_version).toBe(3);
  });

  it("S5b. rejects schema_version: 1 (Stage A → B → invalid)", () => {
    expect(
      TeamTacticalOverviewSchema.safeParse({
        schema_version: 1,
        team_id: "t1",
        generated_at: "2026-05-11T00:00:00Z",
        threat_panel_as_of: "2026-05-10",
        pillars: fiveBundle,
        scenarios: Array.from({ length: 5 }, () => planScenario),
      }).success,
    ).toBe(false);
  });
});

describe("TacticalCitationSchema phase_tag_source (S6 / Q6)", () => {
  it("S6a. accepts phase_tag_source: 'phase_specific'", () => {
    const ok = TacticalCitationSchema.parse({
      knowledge_chunk_id: "x",
      excerpt: "y",
      source_url: "https://example.com",
      species_ids: ["sableye"],
      phase_tag_source: "phase_specific",
    });
    expect(ok.phase_tag_source).toBe("phase_specific");
  });
  it("S6b. accepts phase_tag_source: 'fallback'", () => {
    const ok = TacticalCitationSchema.parse({
      knowledge_chunk_id: "x",
      excerpt: "y",
      source_url: "https://example.com",
      species_ids: ["sableye"],
      phase_tag_source: "fallback",
    });
    expect(ok.phase_tag_source).toBe("fallback");
  });
  it("S6c. rejects unknown phase_tag_source", () => {
    expect(
      TacticalCitationSchema.safeParse({
        knowledge_chunk_id: "x",
        excerpt: "y",
        source_url: "https://example.com",
        species_ids: ["sableye"],
        phase_tag_source: "guessed",
      }).success,
    ).toBe(false);
  });
});

describe("Recommend team-plan tool I/O (S6 supplement)", () => {
  it("RP I/O. RecommendTeamPlanInputSchema accepts an optional scenario_name", () => {
    expect(RecommendTeamPlanInputSchema.parse({ team_id: "t1" }).scenario_name).toBeUndefined();
    expect(
      RecommendTeamPlanInputSchema.parse({ team_id: "t1", scenario_name: "Rain" }).scenario_name,
    ).toBe("Rain");
  });
  it("RP O/O. RecommendTeamPlanOutputSchema requires at least one scenario", () => {
    expect(
      RecommendTeamPlanOutputSchema.safeParse({ team_id: "t1", scenarios: [] }).success,
    ).toBe(false);
  });
});
