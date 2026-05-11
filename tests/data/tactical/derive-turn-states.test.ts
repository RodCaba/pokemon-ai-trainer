/**
 * Stage 4 — RED tests for Stage D deriveTurnStates (DS1..DS14).
 *
 * Module under test: `src/data/tactical/derive-turn-states.ts`.
 * Plan: docs/plans/per-mon-state-tracking.md §3.5 + §10 + flow §5.
 *
 * Inputs are POJOs; the resolver is pure. Stage 5 implements; Stage 4
 * stub throws "stage 5 not yet implemented" so each test fails at the
 * assertion line (rather than missing-symbol).
 */

import { describe, expect, it } from "vitest";
import { deriveTurnStates } from "../../../src/data/tactical/derive-turn-states";
import type { TurnFieldStates } from "../../../src/data/tactical/derive-turn-fields";
import type { OpposingSetters } from "../../../src/data/tactical/opposing-setter";
import type {
  RoleTag,
  RoleTagAssignment,
  ScenarioSkeleton,
} from "../../../src/schemas/tactical";
import type { UserTeam } from "../../../src/schemas/user-teams";

const neutralField: ScenarioSkeleton["field"] = {
  weather: "none", terrain: "none", trick_room: false,
  tailwind_ours: false, tailwind_theirs: false,
  light_screen: false, reflect: false, gravity: false,
};

const tag = (
  primary: RoleTag,
  all: RoleTag[] = [primary],
  extras: Partial<RoleTagAssignment> = {},
): RoleTagAssignment => ({ primary, all, ...extras });

const mkSet = (
  slot: number,
  species_id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  slot, species_id,
  nickname: null,
  item_id: null,
  ability_id: null,
  nature: null,
  hp_sps: 0, atk_sps: 0, def_sps: 0, spa_sps: 0, spd_sps: 0, spe_sps: 0,
  move_1_id: null, move_2_id: null, move_3_id: null, move_4_id: null,
  notes: null,
  ...overrides,
});

const baseTeam: UserTeam = {
  schema_version: 1, id: "test", name: "test", description: null,
  win_condition: null, status: "saved", origin: "builder",
  origin_payload: null, source_tournament_team_id: null,
  validation_errors: [], validation_warnings: [],
  sets: [
    mkSet(0, "sableye"),
    mkSet(1, "archaludon", { ability_id: "stamina" }),
    mkSet(2, "sinistcha"),
    mkSet(3, "basculegion", { item_id: "choice-scarf" }),
    mkSet(4, "amoonguss"),
    mkSet(5, "dragonite"),
  ] as UserTeam["sets"],
  created_at: "2026-05-11T00:00:00Z", updated_at: "2026-05-11T00:00:00Z",
};

const neutralFields: TurnFieldStates = {
  lead: { ...neutralField }, mid: { ...neutralField }, late: { ...neutralField },
};

const noSetters: OpposingSetters = {};

const defaultScenario = (opp: string[] = ["incineroar"]): ScenarioSkeleton => ({
  name: "test", type: "archetype", field: neutralField, opposing_preview: opp,
});

function callDerive(over: Partial<Parameters<typeof deriveTurnStates>[0]> = {}) {
  return deriveTurnStates({
    team: baseTeam,
    scenario: defaultScenario(),
    candidate: { leads: [0, 1], mid: 2, cleaner: 3 },
    roleAssignments: new Map(),
    opposingSetters: noSetters,
    fields: neutralFields,
    leadIncomingDamagePct: { ours: [0, 0], theirs: [0, 0] },
    midIncomingDamagePct: { ours: [0, 0] },
    ...over,
  });
}

describe("deriveTurnStates lead-phase defaults (DS1..DS2)", () => {
  it("DS1. Lead phase: 100% HP, zero boosts, status 'none', choice_locked null for all 4 actors", () => {
    const r = callDerive();
    expect(r.lead.ours.length).toBeGreaterThanOrEqual(1);
    expect(r.lead.theirs.length).toBeGreaterThanOrEqual(1);
    for (const m of [...r.lead.ours, ...r.lead.theirs]) {
      expect(m.hp_pct).toBe(100);
      expect(m.boosts.atk).toBe(0);
      expect(m.boosts.def).toBe(0);
      expect(m.boosts.spa).toBe(0);
      expect(m.boosts.spd).toBe(0);
      expect(m.boosts.spe).toBe(0);
      expect(m.status).toBe("none");
      expect(m.choice_locked_move).toBeNull();
    }
  });

  it("DS2. Lead-phase fallen_allies_{ours,theirs} both 0", () => {
    const r = callDerive();
    expect(r.lead.fallen_allies_ours).toBe(0);
    expect(r.lead.fallen_allies_theirs).toBe(0);
  });
});

describe("deriveTurnStates fallen-ally rules (DS3..DS4)", () => {
  it("DS3. Mid fallen_allies_ours: 1 when opp preview has wallbreaker/cleaner/setup_sweeper species", () => {
    // Opposing preview contains a wallbreaker — gates fallen_allies_ours: 1.
    const r = callDerive({
      scenario: defaultScenario(["urshifu-rapid-strike"]),
      roleAssignments: new Map([
        ["urshifu-rapid-strike", tag("wallbreaker")],
      ]),
    });
    expect(r.mid.fallen_allies_ours).toBe(1);
    // Symmetric for theirs: our team has a cleaner (basculegion) and a
    // setup_sweeper (archaludon).
    const r2 = callDerive({
      roleAssignments: new Map([
        ["basculegion", tag("cleaner")],
        ["archaludon", tag("setup_sweeper")],
      ]),
    });
    expect(r2.mid.fallen_allies_theirs).toBe(1);
  });

  it("DS4. Late fallen_allies_ours: 2 when mid was 1 (chain rule, cap 2)", () => {
    const r = callDerive({
      scenario: defaultScenario(["urshifu-rapid-strike"]),
      roleAssignments: new Map([
        ["urshifu-rapid-strike", tag("wallbreaker")],
      ]),
    });
    expect(r.mid.fallen_allies_ours).toBe(1);
    expect(r.late.fallen_allies_ours).toBe(2);
  });
});

describe("deriveTurnStates HP propagation (DS5..DS7)", () => {
  it("DS5. Mid HP propagation via Q2 echo: lead incoming 55%, 22% → mid HP 45%, 78%", () => {
    const r = callDerive({
      leadIncomingDamagePct: { ours: [55, 22], theirs: [0, 0] },
    });
    expect(r.mid.ours[0]!.hp_pct).toBe(45);
    expect(r.mid.ours[1]!.hp_pct).toBe(78);
  });

  it("DS6. Late HP: mid pivot from mid-echo (60); cleaner = 100 (just switched in)", () => {
    const r = callDerive({
      midIncomingDamagePct: { ours: [40, 0] },
    });
    expect(r.late.ours[0]!.hp_pct).toBe(60);
    expect(r.late.ours[1]!.hp_pct).toBe(100);
  });

  it("DS7. HP clamp to 1 when echo damage exceeds 100", () => {
    const r = callDerive({
      leadIncomingDamagePct: { ours: [200, 200], theirs: [0, 0] },
    });
    expect(r.mid.ours[0]!.hp_pct).toBe(1);
    expect(r.mid.ours[1]!.hp_pct).toBe(1);
  });
});

describe("deriveTurnStates sand chip (DS8)", () => {
  it("DS8. Sand active in mid: vulnerable actor -6%; sand-immune actor unchanged", () => {
    const sandFields: TurnFieldStates = {
      lead: { ...neutralField },
      mid: { ...neutralField, weather: "sand" },
      late: { ...neutralField },
    };
    // Slot 0 (sableye, Dark) vulnerable; slot 1 (archaludon, Steel) immune.
    const r = callDerive({
      fields: sandFields,
      leadIncomingDamagePct: { ours: [20, 20], theirs: [0, 0] },
    });
    // Echo: 100 - 20 = 80, then -6 sand chip = 74 (vulnerable).
    expect(r.mid.ours[0]!.hp_pct).toBe(74);
    // Steel-type immune: no chip on top of echo.
    expect(r.mid.ours[1]!.hp_pct).toBe(80);
  });
});

describe("deriveTurnStates Stamina (DS9)", () => {
  it("DS9. Archaludon (Stamina) at lead, took a hit → mid boosts.def = +1; late = +2", () => {
    const r = callDerive({
      candidate: { leads: [0, 1], mid: 2, cleaner: 3 },
      roleAssignments: new Map([
        ["archaludon", tag("setup_sweeper")],
      ]),
      leadIncomingDamagePct: { ours: [10, 30], theirs: [0, 0] },
      midIncomingDamagePct: { ours: [0, 20] },
    });
    expect(r.mid.ours[1]!.boosts.def).toBe(1);
    expect(r.late.ours[1]!.boosts.def).toBe(2);
  });
});

describe("deriveTurnStates Defiant (DS10)", () => {
  it("DS10. Defiant set + opp Intimidate species → +2 atk; no Intimidate → 0", () => {
    // Replace slot 0 with a Defiant set: pretend Bisharp at slot 0.
    const teamDefiant: UserTeam = {
      ...baseTeam,
      sets: [
        mkSet(0, "bisharp", { ability_id: "defiant" }),
        mkSet(1, "archaludon"),
        mkSet(2, "sinistcha"),
        mkSet(3, "basculegion"),
        mkSet(4, "amoonguss"),
        mkSet(5, "dragonite"),
      ] as UserTeam["sets"],
    };
    const withIntimidate = callDerive({
      team: teamDefiant,
      scenario: defaultScenario(["incineroar"]),
      roleAssignments: new Map([
        ["incineroar", tag("disruptor")],
        ["bisharp", tag("setup_sweeper")],
      ]),
    });
    expect(withIntimidate.mid.ours[0]!.boosts.atk).toBe(2);

    const withoutIntimidate = callDerive({
      team: teamDefiant,
      scenario: defaultScenario(["amoonguss"]),
      roleAssignments: new Map([
        ["amoonguss", tag("redirect")],
        ["bisharp", tag("setup_sweeper")],
      ]),
    });
    expect(withoutIntimidate.mid.ours[0]!.boosts.atk).toBe(0);
  });
});

describe("deriveTurnStates choice-lock (DS11)", () => {
  it("DS11. Scarf cleaner with moves [wave crash, last respects, aqua jet, liquidation] vs bulky panel → late choice_locked = 'lastrespects'; non-Scarf → null", () => {
    const teamScarf: UserTeam = {
      ...baseTeam,
      sets: [
        mkSet(0, "sableye"),
        mkSet(1, "archaludon"),
        mkSet(2, "sinistcha"),
        mkSet(3, "basculegion", {
          item_id: "choice-scarf",
          move_1_id: "wavecrash",
          move_2_id: "lastrespects",
          move_3_id: "aquajet",
          move_4_id: "liquidation",
        }),
        mkSet(4, "amoonguss"),
        mkSet(5, "dragonite"),
      ] as UserTeam["sets"],
    };
    const r = callDerive({
      team: teamScarf,
      // ours[1] = cleaner in late
    });
    expect(r.late.ours[1]!.choice_locked_move).toBe("lastrespects");

    // Non-Scarf variant — no item.
    const teamNoScarf: UserTeam = {
      ...teamScarf,
      sets: [
        ...teamScarf.sets.slice(0, 3),
        mkSet(3, "basculegion", {
          item_id: null,
          move_1_id: "wavecrash", move_2_id: "lastrespects",
          move_3_id: "aquajet", move_4_id: "liquidation",
        }),
        ...teamScarf.sets.slice(4),
      ] as UserTeam["sets"],
    };
    const r2 = callDerive({ team: teamNoScarf });
    expect(r2.late.ours[1]!.choice_locked_move).toBeNull();
  });
});

describe("deriveTurnStates status whitelist (DS12..DS14)", () => {
  it("DS12. Will-O-Wisp: DB-confirmed on opp set → 'burn'; absent → 'none'", () => {
    // With DB-confirmed WoW in panel.entries[i].set.moves:
    const panelWithWoW = {
      schema_version: 1, as_of: "2026-05-11", generated_at: "2026-05-11T00:00:00Z",
      entries: [
        {
          species_roster_id: "sableye",
          weight: 0.1,
          spec: { moves: ["willowisp", "knockoff", "fakeout", "protect"] },
        },
      ],
    } as unknown as Parameters<typeof deriveTurnStates>[0]["scoring_panel"];
    const r = callDerive({
      scenario: defaultScenario(["sableye"]),
      scoring_panel: panelWithWoW,
    });
    expect(r.mid.ours[0]!.status).toBe("burn");

    // Without WoW in moves:
    const panelNoWoW = {
      ...(panelWithWoW as object),
      entries: [
        {
          species_roster_id: "sableye",
          weight: 0.1,
          spec: { moves: ["knockoff", "fakeout", "protect", "encore"] },
        },
      ],
    } as unknown as Parameters<typeof deriveTurnStates>[0]["scoring_panel"];
    const r2 = callDerive({
      scenario: defaultScenario(["sableye"]),
      scoring_panel: panelNoWoW,
    });
    expect(r2.mid.ours[0]!.status).toBe("none");
  });

  it("DS13. Spore: DB-confirmed Amoonguss → 'sleep' on opposing lead OUR actor; never on team's own actor", () => {
    const panelWithSpore = {
      schema_version: 1, as_of: "2026-05-11", generated_at: "2026-05-11T00:00:00Z",
      entries: [
        {
          species_roster_id: "amoonguss",
          weight: 0.1,
          spec: { moves: ["spore", "ragepowder", "pollenpuff", "protect"] },
        },
      ],
    } as unknown as Parameters<typeof deriveTurnStates>[0]["scoring_panel"];
    const r = callDerive({
      scenario: defaultScenario(["amoonguss"]),
      scoring_panel: panelWithSpore,
    });
    expect(r.mid.ours[0]!.status).toBe("sleep");
    // Friendly Spore never applies to us against ourselves; theirs[*] is
    // unaffected by the OUR-side application.
    for (const m of r.mid.theirs) {
      expect(m.status).toBe("none");
    }
  });

  it("DS14. Thunder Wave: DB-confirmed → 'paralysis'; excluded moves (Body Slam, Toxic) never apply in v1", () => {
    const panelWithTwave = {
      schema_version: 1, as_of: "2026-05-11", generated_at: "2026-05-11T00:00:00Z",
      entries: [
        {
          species_roster_id: "togekiss",
          weight: 0.1,
          spec: { moves: ["thunderwave", "airslash", "followme", "protect"] },
        },
      ],
    } as unknown as Parameters<typeof deriveTurnStates>[0]["scoring_panel"];
    const r = callDerive({
      scenario: defaultScenario(["togekiss"]),
      scoring_panel: panelWithTwave,
    });
    expect(r.mid.ours[0]!.status).toBe("paralysis");

    // Body Slam (potential burn) + Toxic NEVER apply — they're excluded.
    const panelExcluded = {
      schema_version: 1, as_of: "2026-05-11", generated_at: "2026-05-11T00:00:00Z",
      entries: [
        {
          species_roster_id: "blissey",
          weight: 0.1,
          spec: { moves: ["bodyslam", "toxic", "softboiled", "protect"] },
        },
      ],
    } as unknown as Parameters<typeof deriveTurnStates>[0]["scoring_panel"];
    const r2 = callDerive({
      scenario: defaultScenario(["blissey"]),
      scoring_panel: panelExcluded,
    });
    expect(r2.mid.ours[0]!.status).toBe("none");
  });
});
