/**
 * TAC-T1..T6 — schemas. Stage-4 red.
 *
 * Per CLAUDE.md §3 pure-data exemption: the schema module landed in the
 * same Stage-4 batch (disclosed in commit message). These tests pin
 * externally visible contract behavior.
 */

import { describe, expect, it } from "vitest";
import {
  PillarScoreSchema,
  ScenarioFieldSchema,
  ScenarioSkeletonSchema,
  ScenarioTypeSchema,
  TeamTacticalOverviewSchema,
  ThreatEntrySchema,
  ThreatPanelSchema,
  type ScenarioSkeleton,
} from "../../src/schemas/tactical";

const VALID_SET = {
  schema_version: 1 as const,
  id: "labmaus:1:1:0",
  tournament_team_id: "labmaus:1:1",
  slot: 0 as const,
  species_roster_id: "incineroar",
  item: "Sitrus Berry",
  ability: "Intimidate",
  level: 50,
  moves: ["Fake Out"],
  sps: { hp: 32, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  ivs: null,
  nature: "Adamant",
  completeness: "minimal" as const,
  source: {
    site: "pokepaste" as const,
    paste_id: "abcdef012345",
    source_url: "https://pokepast.es/abcdef012345",
    fetched_at: "2026-05-08T00:00:00Z",
  },
};

const VALID_SCENARIO: ScenarioSkeleton = {
  name: "Sun",
  type: "archetype",
  field: ScenarioFieldSchema.parse({ weather: "sun" }),
  opposing_preview: ["torkoal", "lilligant"],
};

describe("tactical schemas (TAC-T1..T6)", () => {
  it("TAC-T1. ThreatEntry / ThreatPanel / PillarScore / ScenarioSkeleton / TeamTacticalOverview round-trip via zod", () => {
    const entry = ThreatEntrySchema.parse({
      species_id: "incineroar",
      weight: 0.1,
      set: VALID_SET,
      source: { type: "pikalytics", as_of: "2026-05-08" },
    });
    expect(entry.species_id).toBe("incineroar");

    const panel = ThreatPanelSchema.parse({
      schema_version: 1,
      as_of: "2026-05-08",
      generated_at: "2026-05-08T00:00:00Z",
      entries: [entry],
    });
    expect(panel.entries).toHaveLength(1);

    const pillar = PillarScoreSchema.parse({
      pillar: "offense",
      score: 80,
      tier: "Good",
      evidence: { top: [], worst: [] },
    });
    expect(pillar.tier).toBe("Good");

    const sc = ScenarioSkeletonSchema.parse(VALID_SCENARIO);
    expect(sc.name).toBe("Sun");

    // Stage B: TeamTacticalOverview.scenarios is TeamPlanScenario[].
    const planScenario = {
      ...sc,
      phases: [
        {
          phase: "lead" as const,
          turn_window: [1, 2] as [number, number],
          active: ["incineroar", "amoonguss"] as [string, string],
          rationale: "x",
          key_calcs: [],
          abandon_if: "y",
        },
        {
          phase: "mid" as const,
          turn_window: [2, 4] as [number, number],
          pivot_in: "rillaboom",
          pivot_out: null,
          rationale: "x",
          key_calcs: [],
          trigger: "y",
        },
        {
          phase: "late" as const,
          turn_window: [4, 8] as [number, number],
          cleaner: "garchomp",
          rationale: "x",
          key_calcs: [],
          win_condition: "y",
        },
      ] as const,
      plan_score: 60,
      citations: [],
    };
    const overview = TeamTacticalOverviewSchema.parse({
      schema_version: 3,
      team_id: "01H000000000000000000000T0",
      generated_at: "2026-05-08T00:00:00Z",
      threat_panel_as_of: "2026-05-08",
      pillars: {
        offense: pillar,
        defense: { ...pillar, pillar: "defense" },
        speed: { ...pillar, pillar: "speed" },
        synergy: { ...pillar, pillar: "synergy" },
        support: { ...pillar, pillar: "support" },
      },
      scenarios: [planScenario, planScenario, planScenario, planScenario, planScenario],
    });
    expect(overview.scenarios).toHaveLength(5);
  });

  it("TAC-T2. zod rejects negative weights, score > 100, empty scenario list", () => {
    expect(() =>
      ThreatEntrySchema.parse({
        species_id: "incineroar",
        weight: -0.1,
        set: VALID_SET,
        source: { type: "pikalytics", as_of: "2026-05-08" },
      }),
    ).toThrow();

    expect(() =>
      PillarScoreSchema.parse({
        pillar: "offense",
        score: 101,
        tier: "Strong",
        evidence: {},
      }),
    ).toThrow();

    expect(() =>
      TeamTacticalOverviewSchema.parse({
        schema_version: 3,
        team_id: "x",
        generated_at: "2026-05-08T00:00:00Z",
        threat_panel_as_of: "2026-05-08",
        pillars: {
          offense: { pillar: "offense", score: 0, tier: "Weak", evidence: {} },
          defense: { pillar: "defense", score: 0, tier: "Weak", evidence: {} },
          speed: { pillar: "speed", score: 0, tier: "Weak", evidence: {} },
          synergy: { pillar: "synergy", score: 0, tier: "Weak", evidence: {} },
          support: { pillar: "support", score: 0, tier: "Weak", evidence: {} },
        },
        scenarios: [],
      }),
    ).toThrow();
  });

  it("TAC-T3. ScenarioSkeleton carries archetype | individual | weakness_counter | meta_team | mirror_match discriminator", () => {
    expect(ScenarioTypeSchema.options).toEqual([
      "archetype",
      "individual",
      "weakness_counter",
      "meta_team",
      "mirror_match",
    ]);
    const sc = ScenarioSkeletonSchema.parse({
      ...VALID_SCENARIO,
      type: "weakness_counter",
      name: "vs Mega Glimmora (counter)",
    });
    expect(sc.type).toBe("weakness_counter");
  });

  it("TAC-T4. TeamTacticalOverview.threat_panel_as_of must be ISO date YYYY-MM-DD", () => {
    expect(() =>
      TeamTacticalOverviewSchema.parse({
        schema_version: 3,
        team_id: "x",
        generated_at: "2026-05-08T00:00:00Z",
        threat_panel_as_of: "May 8 2026",
        pillars: {
          offense: { pillar: "offense", score: 0, tier: "Weak", evidence: {} },
          defense: { pillar: "defense", score: 0, tier: "Weak", evidence: {} },
          speed: { pillar: "speed", score: 0, tier: "Weak", evidence: {} },
          synergy: { pillar: "synergy", score: 0, tier: "Weak", evidence: {} },
          support: { pillar: "support", score: 0, tier: "Weak", evidence: {} },
        },
        scenarios: [VALID_SCENARIO, VALID_SCENARIO, VALID_SCENARIO, VALID_SCENARIO, VALID_SCENARIO],
      }),
    ).toThrow();
  });

  it("TAC-T5. defense-in-depth — schemas reject tera_* keys (memory regulation_m_a_no_tera)", () => {
    expect(() =>
      ScenarioFieldSchema.parse({ weather: "sun", tera_active: true }),
    ).toThrow();
    expect(() =>
      ScenarioSkeletonSchema.parse({
        ...VALID_SCENARIO,
        tera_type: "Fire",
      } as unknown),
    ).toThrow();
  });

  it("TAC-T6. ScenarioSkeleton carries the input-side fields and nothing else (Stage B Q5)", () => {
    const keys = Object.keys(ScenarioSkeletonSchema.shape);
    expect(keys).toContain("name");
    expect(keys).toContain("type");
    expect(keys).toContain("field");
    expect(keys).toContain("opposing_preview");
    // Stage-A-only fields are gone with the schema's removal.
    expect(keys).not.toContain("recommended_leads");
    expect(keys).not.toContain("recommended_backline");
    expect(keys).not.toContain("reasoning");
    expect(keys).not.toContain("pair_score");
  });
});
