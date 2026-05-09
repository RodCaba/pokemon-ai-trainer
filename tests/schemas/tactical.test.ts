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
  ScenarioOverviewSchema,
  ScenarioTypeSchema,
  TeamTacticalOverviewSchema,
  ThreatEntrySchema,
  ThreatPanelSchema,
  type ScenarioOverview,
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

const VALID_SCENARIO: ScenarioOverview = {
  name: "Sun",
  type: "archetype",
  field: ScenarioFieldSchema.parse({ weather: "sun" }),
  opposing_preview: ["torkoal", "lilligant"],
  recommended_leads: ["incineroar", "amoonguss"],
  recommended_backline: ["urshifu-rapid-strike", "rillaboom"],
  rejected_bench: ["garchomp", "tornadus"],
  reasoning: "x",
  key_calcs: [],
  citations: [],
  pair_score: 1,
};

describe("tactical schemas (TAC-T1..T6)", () => {
  it("TAC-T1. ThreatEntry / ThreatPanel / PillarScore / ScenarioOverview / TeamTacticalOverview round-trip via zod", () => {
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

    const sc = ScenarioOverviewSchema.parse(VALID_SCENARIO);
    expect(sc.name).toBe("Sun");

    const overview = TeamTacticalOverviewSchema.parse({
      schema_version: 1,
      team_id: "01H000000000000000000000T0",
      generated_at: "2026-05-08T00:00:00Z",
      threat_panel_as_of: "2026-05-08",
      pillars: {
        offense: pillar,
        defense: { ...pillar, pillar: "defense" },
        speed: { ...pillar, pillar: "speed" },
        synergy: { ...pillar, pillar: "synergy" },
      },
      scenarios: [sc, sc, sc, sc, sc],
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
        schema_version: 1,
        team_id: "x",
        generated_at: "2026-05-08T00:00:00Z",
        threat_panel_as_of: "2026-05-08",
        pillars: {
          offense: { pillar: "offense", score: 0, tier: "Weak", evidence: {} },
          defense: { pillar: "defense", score: 0, tier: "Weak", evidence: {} },
          speed: { pillar: "speed", score: 0, tier: "Weak", evidence: {} },
          synergy: { pillar: "synergy", score: 0, tier: "Weak", evidence: {} },
        },
        scenarios: [],
      }),
    ).toThrow();
  });

  it("TAC-T3. ScenarioOverview carries archetype | individual | weakness_counter | meta_team discriminator", () => {
    expect(ScenarioTypeSchema.options).toEqual([
      "archetype",
      "individual",
      "weakness_counter",
      "meta_team",
    ]);
    const sc = ScenarioOverviewSchema.parse({
      ...VALID_SCENARIO,
      type: "weakness_counter",
      name: "vs Mega Glimmora (counter)",
    });
    expect(sc.type).toBe("weakness_counter");
  });

  it("TAC-T4. TeamTacticalOverview.threat_panel_as_of must be ISO date YYYY-MM-DD", () => {
    expect(() =>
      TeamTacticalOverviewSchema.parse({
        schema_version: 1,
        team_id: "x",
        generated_at: "2026-05-08T00:00:00Z",
        threat_panel_as_of: "May 8 2026",
        pillars: {
          offense: { pillar: "offense", score: 0, tier: "Weak", evidence: {} },
          defense: { pillar: "defense", score: 0, tier: "Weak", evidence: {} },
          speed: { pillar: "speed", score: 0, tier: "Weak", evidence: {} },
          synergy: { pillar: "synergy", score: 0, tier: "Weak", evidence: {} },
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
      ScenarioOverviewSchema.parse({
        ...VALID_SCENARIO,
        tera_type: "Fire",
      } as unknown),
    ).toThrow();
  });

  it("TAC-T6. ScenarioOverview is parallel to LeadPlan, not an extension — divergent fields are documented", () => {
    // Type-only assertion: ScenarioOverview has `pair_score` + `type` discriminator,
    // which CLAUDE.md §7 LeadPlan does not. Both share leads/back/rejected.
    const keys = Object.keys(ScenarioOverviewSchema.shape);
    expect(keys).toContain("pair_score");
    expect(keys).toContain("type");
    expect(keys).toContain("recommended_leads");
    expect(keys).toContain("recommended_backline");
    // LeadPlan would have `key_timing` / `abandon_if`; ScenarioOverview doesn't.
    expect(keys).not.toContain("key_timing");
    expect(keys).not.toContain("abandon_if");
  });
});
