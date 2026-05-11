/**
 * Stage 5 polish — weather-pairing tests for the classifier + support_lift.
 * Domain motivation: Electro Shot is a 1-turn move under rain and a 2-turn
 * charging move otherwise; Tailwind doesn't activate it. The classifier
 * needs to surface (a) which weather a setter brings and (b) whether a
 * payoff has a weather-dependent charging move so the support_lift scorer
 * can reject the Dragonite (Tailwind) → Archaludon (Electro Shot) pair
 * while accepting Sableye / Pelipper (Rain) → Archaludon (Electro Shot).
 *
 * Plan §12 Q12(c) was deferred at Stage 2; this lands the minimum check
 * that fixes the live ArchaEye demo.
 */

import { describe, expect, it } from "vitest";
import {
  deriveRoleTags,
  type RoleTagInput,
  type DeriveRoleTagsDeps,
} from "../../../src/data/tactical/role-tags";
import {
  computeSupportLift,
} from "../../../src/data/tactical/score-pair";
import type { RoleTagAssignment, ScenarioOverview, RoleTag } from "../../../src/schemas/tactical";

const noopDeps: DeriveRoleTagsDeps = { logWarn: () => {} };

const baseStats = (overrides: Partial<RoleTagInput["base_stats"]> = {}) => ({
  hp: 90, atk: 90, def: 90, spa: 90, spd: 90, spe: 90, ...overrides,
});

const mkInput = (p: Partial<RoleTagInput>): RoleTagInput => ({
  species_id: p.species_id ?? "test",
  item: p.item ?? null,
  ability: p.ability ?? null,
  moves: p.moves ?? [],
  base_stats: p.base_stats ?? baseStats(),
});

describe("classifier — weather_provided (W1..W5)", () => {
  it("W1. Rain Dance move → weather_provided='rain'", () => {
    const r = deriveRoleTags(mkInput({ moves: ["Rain Dance"] }), noopDeps);
    expect(r.weather_provided).toBe("rain");
  });

  it("W2. Drizzle ability → weather_provided='rain'", () => {
    const r = deriveRoleTags(
      mkInput({ ability: "Drizzle", moves: ["Hurricane", "Surf", "Roost", "Protect"] }),
      noopDeps,
    );
    expect(r.weather_provided).toBe("rain");
  });

  it("W3. Drought ability → weather_provided='sun'", () => {
    const r = deriveRoleTags(mkInput({ ability: "Drought", moves: ["Heat Wave"] }), noopDeps);
    expect(r.weather_provided).toBe("sun");
  });

  it("W4. Sand Stream ability → weather_provided='sand'", () => {
    const r = deriveRoleTags(mkInput({ ability: "Sand Stream" }), noopDeps);
    expect(r.weather_provided).toBe("sand");
  });

  it("W5. No weather move/ability → weather_provided undefined", () => {
    const r = deriveRoleTags(mkInput({ moves: ["Tailwind", "U-turn"] }), noopDeps);
    expect(r.weather_provided).toBeUndefined();
  });
});

describe("classifier — weather_charged_move (W6..W8)", () => {
  it("W6. Electro Shot in moves → weather_charged_move='rain'", () => {
    const r = deriveRoleTags(
      mkInput({
        species_id: "archaludon",
        ability: "Stamina",
        moves: ["Electro Shot", "Dragon Pulse", "Flash Cannon", "Protect"],
      }),
      noopDeps,
    );
    expect(r.weather_charged_move).toBe("rain");
  });

  it("W7. Solar Beam → weather_charged_move='sun'", () => {
    const r = deriveRoleTags(
      mkInput({ moves: ["Solar Beam", "Sludge Bomb", "Earth Power", "Protect"] }),
      noopDeps,
    );
    expect(r.weather_charged_move).toBe("sun");
  });

  it("W8. Hurricane alone (incidental rain buff, not a charging move) → no dependency", () => {
    const r = deriveRoleTags(
      mkInput({ moves: ["Hurricane", "Surf", "Ice Beam", "Roost"] }),
      noopDeps,
    );
    expect(r.weather_charged_move).toBeUndefined();
  });
});

const tag = (
  primary: RoleTag,
  all: RoleTag[] = [primary],
  extras: { weather_provided?: "rain" | "sun" | "sand" | "snow"; weather_charged_move?: "rain" | "sun" | "sand" | "snow" } = {},
): RoleTagAssignment => ({ primary, all, ...extras });

const scenario = (): ScenarioOverview => ({
  name: "test",
  type: "archetype",
  field: {
    weather: "none", terrain: "none", trick_room: false,
    tailwind_ours: false, tailwind_theirs: false,
    light_screen: false, reflect: false, gravity: false,
  },
  opposing_preview: ["incineroar"],
  recommended_leads: ["a", "b"],
  recommended_backline: ["c", "d"],
  rejected_bench: ["e", "f"],
  reasoning: "x",
  key_calcs: [],
  citations: [],
  pair_score: 0,
});

describe("support_lift — weather mechanism gate (W9..W11)", () => {
  it("W9. rain setter + rain-dependent sweeper in lead → +60 (weather-matched canonical)", () => {
    const roles = new Map<string, RoleTagAssignment>([
      ["sableye", tag("weather_setter", ["weather_setter", "screen_setter"], { weather_provided: "rain" })],
      ["archaludon", tag("setup_sweeper", ["setup_sweeper"], { weather_charged_move: "rain" })],
      ["b1", tag("cleaner")],
      ["b2", tag("wallbreaker")],
    ]);
    const lift = computeSupportLift({
      leadIds: ["sableye", "archaludon"],
      backIds: ["b1", "b2"],
      roleAssignments: roles,
      scenario: scenario(),
    });
    // +12 (setter→cleaner back) + 60 (rain match — canonical weather payoff)
    expect(lift).toBe(12 + 60);
  });

  it("W10. tailwind (speed_control_setter) + rain-dependent sweeper in lead → no +25", () => {
    const roles = new Map<string, RoleTagAssignment>([
      ["dragonite", tag("speed_control_setter")],
      ["archaludon", tag("setup_sweeper", ["setup_sweeper"], { weather_charged_move: "rain" })],
      ["b1", tag("cleaner")],
      ["b2", tag("wallbreaker")],
    ]);
    const lift = computeSupportLift({
      leadIds: ["dragonite", "archaludon"],
      backIds: ["b1", "b2"],
      roleAssignments: roles,
      scenario: scenario(),
    });
    // +12 (setter+payoff back) only — structural bonus blocked by mismatch.
    expect(lift).toBe(12);
  });

  it("W11. setter + sweeper with no weather dependency → +25 (legacy rule fires)", () => {
    const roles = new Map<string, RoleTagAssignment>([
      ["dragonite", tag("speed_control_setter")],
      ["sweeper", tag("setup_sweeper")],
      ["b1", tag("cleaner")],
      ["b2", tag("wallbreaker")],
    ]);
    const lift = computeSupportLift({
      leadIds: ["dragonite", "sweeper"],
      backIds: ["b1", "b2"],
      roleAssignments: roles,
      scenario: scenario(),
    });
    expect(lift).toBe(12 + 25);
  });
});
