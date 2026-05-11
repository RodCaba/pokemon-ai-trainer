/**
 * Stage 4 — RED tests for the team-support-pillar slice schemas.
 * Plan §9, S1–S6. Pure-data exemption: these land batched.
 *
 * They fail today because:
 *   - `RoleTagSchema` / `RoleTagAssignmentSchema` / `SupportPillarEvidenceSchema`
 *     don't exist yet on `src/schemas/tactical.ts`.
 *   - `PillarBundleSchema` doesn't include `support`.
 *   - `TeamTacticalOverviewSchema.schema_version` is still `z.literal(1)`.
 *   - `ScenarioSkeletonSchema` doesn't carry `support_lift`.
 */

import { describe, expect, it } from "vitest";
import {
  RoleTagSchema,
  RoleTagAssignmentSchema,
  SupportPillarEvidenceSchema,
  PillarBundleSchema,
  PillarScoreSchema,
  TeamTacticalOverviewSchema,
  ScenarioSkeletonSchema,
  ScenarioFieldSchema,
} from "../../src/schemas/tactical";

const ALL_TAGS = [
  "screen_setter",
  "speed_control_setter",
  "weather_setter",
  "redirect",
  "cleric",
  "disruptor",
  "pivot",
  "setup_sweeper",
  "cleaner",
  "wallbreaker",
  "anti_priority",
  "untagged",
] as const;

describe("RoleTagSchema (S1)", () => {
  it("S1. round-trips all 12 enum values (11 tags + untagged)", () => {
    for (const t of ALL_TAGS) {
      expect(RoleTagSchema.parse(t)).toBe(t);
    }
    expect(RoleTagSchema.safeParse("setter").success).toBe(false);
    expect(RoleTagSchema.safeParse("invalid_tag").success).toBe(false);
  });
});

describe("RoleTagAssignmentSchema (S2)", () => {
  it("S2a. rejects empty `all`", () => {
    expect(
      RoleTagAssignmentSchema.safeParse({ primary: "cleric", all: [] }).success,
    ).toBe(false);
  });

  it("S2b. accepts a multi-tag assignment", () => {
    const ok = RoleTagAssignmentSchema.parse({
      primary: "cleric",
      all: ["cleric", "redirect"],
    });
    expect(ok.primary).toBe("cleric");
    expect(ok.all).toEqual(["cleric", "redirect"]);
  });

  it("S2c. rejects unknown tag in `all`", () => {
    expect(
      RoleTagAssignmentSchema.safeParse({
        primary: "cleric",
        all: ["cleric", "lead_dancer"],
      }).success,
    ).toBe(false);
  });
});

describe("SupportPillarEvidenceSchema (S3)", () => {
  it("S3. round-trips a hand-built ArchaEye evidence blob", () => {
    const blob = {
      role_tags: {
        sableye: { primary: "weather_setter", all: ["screen_setter", "speed_control_setter", "weather_setter", "disruptor"] },
        archaludon: { primary: "setup_sweeper", all: ["setup_sweeper"] },
        basculegion: { primary: "cleaner", all: ["cleaner"] },
        pelipper: { primary: "weather_setter", all: ["weather_setter", "pivot"] },
        sinistcha: { primary: "cleric", all: ["cleric", "redirect", "speed_control_setter"] },
        dragonite: { primary: "wallbreaker", all: ["wallbreaker"] },
      },
      mechanisms: {
        screens: ["sableye"],
        weather_setters: ["sableye", "pelipper"],
        speed_control: ["sableye", "sinistcha"],
        redirection: ["sinistcha"],
        healers: ["sinistcha"],
        disruption: ["sableye"],
        pivots: ["pelipper"],
        anti_priority: [],
      },
      role_coherence: true,
      coherence_chain: {
        setter: "sableye",
        payoff: "archaludon",
        payoff_role: "setup_sweeper",
      },
    };
    const parsed = SupportPillarEvidenceSchema.parse(blob);
    expect(parsed.role_coherence).toBe(true);
    expect(parsed.coherence_chain?.setter).toBe("sableye");
  });

  it("S3b. coherence_chain may be null", () => {
    const blob = {
      role_tags: { foo: { primary: "untagged", all: ["untagged"] } },
      mechanisms: {
        screens: [], weather_setters: [], speed_control: [],
        redirection: [], healers: [], disruption: [], pivots: [],
        anti_priority: [],
      },
      role_coherence: false,
      coherence_chain: null,
    };
    expect(SupportPillarEvidenceSchema.safeParse(blob).success).toBe(true);
  });
});

describe("PillarBundleSchema (S4)", () => {
  it("S4. requires `support` key (5 pillars)", () => {
    const mk = (pillar: string) => ({
      pillar,
      score: 50,
      tier: "OK" as const,
      evidence: {},
    });
    const fourPillars = {
      offense: mk("offense"),
      defense: mk("defense"),
      speed: mk("speed"),
      synergy: mk("synergy"),
    };
    expect(PillarBundleSchema.safeParse(fourPillars).success).toBe(false);

    const fivePillars = { ...fourPillars, support: mk("support") };
    expect(PillarBundleSchema.safeParse(fivePillars).success).toBe(true);
  });

  it("S4b. PillarScoreSchema accepts `support` as a pillar value", () => {
    expect(
      PillarScoreSchema.safeParse({
        pillar: "support",
        score: 70,
        tier: "Good",
        evidence: {},
      }).success,
    ).toBe(true);
  });
});

describe("TeamTacticalOverviewSchema (S5)", () => {
  // Stage B (Q5 + Q8 §17): TeamTacticalOverview embeds TeamPlanScenario,
  // not the removed ScenarioOverview. The fixture below matches the new
  // shape; `schema_version` is now z.literal(3).
  const validScenario = {
    name: "Sun",
    type: "archetype" as const,
    field: ScenarioFieldSchema.parse({}),
    opposing_preview: ["charizard"],
    phases: [
      {
        phase: "lead" as const,
        turn_window: [1, 2] as [number, number],
        active: ["sableye", "archaludon"] as [string, string],
        rationale: "x",
        key_calcs: [],
        abandon_if: "y",
      },
      {
        phase: "mid" as const,
        turn_window: [2, 4] as [number, number],
        pivot_in: "sinistcha",
        pivot_out: null,
        rationale: "x",
        key_calcs: [],
        trigger: "y",
      },
      {
        phase: "late" as const,
        turn_window: [4, 8] as [number, number],
        cleaner: "basculegion",
        rationale: "x",
        key_calcs: [],
        win_condition: "y",
      },
    ] as const,
    plan_score: 60,
    citations: [],
  };

  const mkPillar = (pillar: string) => ({ pillar, score: 50, tier: "OK", evidence: {} });
  const fiveBundle = {
    offense: mkPillar("offense"),
    defense: mkPillar("defense"),
    speed: mkPillar("speed"),
    synergy: mkPillar("synergy"),
    support: mkPillar("support"),
  };

  it("S5a. rejects schema_version: 1", () => {
    const overview = {
      schema_version: 1,
      team_id: "t1",
      generated_at: "2026-05-09T00:00:00Z",
      threat_panel_as_of: "2026-05-08",
      pillars: fiveBundle,
      scenarios: Array.from({ length: 5 }, () => validScenario),
    };
    expect(TeamTacticalOverviewSchema.safeParse(overview).success).toBe(false);
  });

  it("S5b. accepts schema_version: 3 (Stage B reshape)", () => {
    const overview = {
      schema_version: 5,
      team_id: "t1",
      generated_at: "2026-05-09T00:00:00Z",
      threat_panel_as_of: "2026-05-08",
      pillars: fiveBundle,
      scenarios: Array.from({ length: 5 }, () => validScenario),
    };
    expect(TeamTacticalOverviewSchema.safeParse(overview).success).toBe(true);
  });
});

/** Stage B (Q9 §17) moved `support_lift` off the scenario shape and
 *  onto `LeadPhaseSchema`. The S6 cases below are covered by
 *  `tests/schemas/team-phase-plan.test.ts` (S4 lead-phase tests) — the
 *  Stage-A ScenarioOverview block is intentionally removed here. */
