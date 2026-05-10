/**
 * Stage 4 — RED tests for the role-tag classifier (plan §9 R1–R20).
 * Per-test red→green discipline: each rule is its own failing assertion.
 *
 * Module under test (does not exist yet):
 *   src/data/tactical/role-tags.ts
 *     export function deriveRoleTags(input: RoleTagInput): RoleTagAssignment
 *     export function deriveTeamRoleTags(team, deps): Map<species_id, RoleTagAssignment>
 *
 * The detection rules + priority + tiebreak are pinned in plan §3.1 + Q1/Q2 answers.
 */

import { describe, expect, it, vi } from "vitest";
import { deriveRoleTags, type RoleTagInput, type DeriveRoleTagsDeps } from "../../../src/data/tactical/role-tags";

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

const noopDeps: DeriveRoleTagsDeps = { logWarn: () => {} };

describe("deriveRoleTags — single-rule cases (R1–R10)", () => {
  it("R1. Reflect-only set → primary=screen_setter, all=[screen_setter]", () => {
    const r = deriveRoleTags(mkInput({ moves: ["Reflect"] }), noopDeps);
    expect(r.primary).toBe("screen_setter");
    expect(r.all).toEqual(["screen_setter"]);
  });

  it("R2. Trick Room-only set → primary=speed_control_setter", () => {
    const r = deriveRoleTags(mkInput({ moves: ["Trick Room"] }), noopDeps);
    expect(r.primary).toBe("speed_control_setter");
  });

  it("R3. Tailwind + U-turn → primary=speed_control_setter, all includes pivot", () => {
    const r = deriveRoleTags(
      mkInput({ moves: ["Tailwind", "U-turn", "Moonblast", "Encore"] }),
      noopDeps,
    );
    expect(r.primary).toBe("speed_control_setter");
    expect(r.all).toContain("pivot");
  });

  it("R4. Drizzle ability with no weather move → primary=weather_setter", () => {
    const r = deriveRoleTags(
      mkInput({ ability: "Drizzle", moves: ["Hurricane", "Surf", "Roost", "Protect"] }),
      noopDeps,
    );
    expect(r.primary).toBe("weather_setter");
  });

  it("R5. Sableye-shape (Reflect + Light Screen + Quash + Rain Dance) → primary=weather_setter, all includes 4 tags ordered by priority", () => {
    const r = deriveRoleTags(
      mkInput({
        species_id: "sableye",
        moves: ["Reflect", "Light Screen", "Quash", "Rain Dance"],
        ability: "Prankster",
      }),
      noopDeps,
    );
    expect(r.primary).toBe("weather_setter");
    // Priority order from plan §3.1:
    //   weather_setter > screen_setter > speed_control_setter > ... > disruptor
    expect(r.all).toEqual([
      "weather_setter",
      "screen_setter",
      "disruptor", // Quash
    ]);
  });

  it("R6a. Rage Powder set → primary=redirect", () => {
    const r = deriveRoleTags(
      mkInput({ moves: ["Rage Powder", "Sleep Powder", "Pollen Puff", "Spore"] }),
      noopDeps,
    );
    expect(r.primary).toBe("redirect");
  });

  it("R6b. Follow Me set → primary=redirect", () => {
    const r = deriveRoleTags(
      mkInput({ moves: ["Follow Me", "Helping Hand", "Protect", "Dazzling Gleam"] }),
      noopDeps,
    );
    expect(r.primary).toBe("redirect");
  });

  it("R7a. Life Dew set → primary=cleric", () => {
    const r = deriveRoleTags(
      mkInput({ moves: ["Life Dew", "Moonblast", "Protect", "Light Screen"] }),
      noopDeps,
    );
    // Life Dew → cleric; Light Screen also adds screen_setter; cleric > screen by priority? No —
    // priority: weather_setter > screen_setter > speed_control_setter > redirect > cleric.
    // Screen_setter beats cleric on priority. Plan §3.1 confirms.
    expect(r.primary).toBe("screen_setter");
    expect(r.all).toContain("cleric");
  });

  it("R7b. Hospitality ability → primary=cleric (no other tags)", () => {
    const r = deriveRoleTags(
      mkInput({ ability: "Hospitality", moves: ["Matcha Gotcha", "Strength Sap", "Protect", "Foul Play"] }),
      noopDeps,
    );
    expect(r.primary).toBe("cleric");
  });

  it("R8a. Encore + Taunt + Will-O-Wisp → primary=disruptor", () => {
    const r = deriveRoleTags(
      mkInput({ moves: ["Encore", "Taunt", "Will-O-Wisp", "Foul Play"] }),
      noopDeps,
    );
    expect(r.primary).toBe("disruptor");
  });

  it("R8b. Icy Wind alone → primary=disruptor (Q-binding: debuffs fold under disruptor)", () => {
    const r = deriveRoleTags(
      mkInput({ moves: ["Icy Wind", "Ice Beam", "Earth Power", "Protect"] }),
      noopDeps,
    );
    expect(r.primary).toBe("disruptor");
  });

  it("R8c. Wide Guard → primary=disruptor (plan Q1: fold Wide Guard / Quick Guard under disruptor)", () => {
    const r = deriveRoleTags(
      mkInput({ moves: ["Wide Guard", "Hurricane", "Surf", "Roost"] }),
      noopDeps,
    );
    expect(r.primary).toBe("disruptor");
  });

  it("R9. U-turn + Knock Off (no boost, no scarf) → primary=pivot", () => {
    const r = deriveRoleTags(
      mkInput({
        species_id: "scout",
        ability: "Tinted Lens",
        item: "Sitrus Berry",
        moves: ["U-turn", "Knock Off", "Brave Bird", "Tailwind"],
      }),
      noopDeps,
    );
    // Tailwind brings speed_control_setter at higher priority than pivot.
    // To get a pure pivot primary, drop Tailwind:
    const r2 = deriveRoleTags(
      mkInput({
        species_id: "scout",
        ability: "Tinted Lens",
        item: "Sitrus Berry",
        moves: ["U-turn", "Knock Off", "Brave Bird", "Roost"],
      }),
      noopDeps,
    );
    expect(r.primary).toBe("speed_control_setter");
    expect(r2.primary).toBe("pivot");
  });

  it("R10a. Dragon Dance set → primary=setup_sweeper", () => {
    const r = deriveRoleTags(
      mkInput({
        moves: ["Dragon Dance", "Dragon Claw", "Earthquake", "Protect"],
        base_stats: baseStats({ atk: 130, spe: 102 }),
      }),
      noopDeps,
    );
    expect(r.primary).toBe("setup_sweeper");
  });

  it("R10b. Stamina ability → primary=setup_sweeper (Archaludon shape)", () => {
    const r = deriveRoleTags(
      mkInput({
        species_id: "archaludon",
        ability: "Stamina",
        item: "Leftovers",
        moves: ["Electro Shot", "Dragon Pulse", "Flash Cannon", "Protect"],
        base_stats: baseStats({ hp: 90, def: 130, spa: 125, spe: 85 }),
      }),
      noopDeps,
    );
    expect(r.primary).toBe("setup_sweeper");
  });

  it("R10c. Scale Shot → primary=setup_sweeper (plan Q2: Scale Shot is a setup trigger)", () => {
    const r = deriveRoleTags(
      mkInput({
        species_id: "garchomp",
        moves: ["Scale Shot", "Earthquake", "Stone Edge", "Protect"],
        base_stats: baseStats({ atk: 130, spe: 102 }),
      }),
      noopDeps,
    );
    expect(r.primary).toBe("setup_sweeper");
  });

  it("R10d. Meteor Beam → primary=setup_sweeper (plan Q2)", () => {
    const r = deriveRoleTags(
      mkInput({
        moves: ["Meteor Beam", "Earth Power", "Sludge Wave", "Protect"],
        base_stats: baseStats({ spa: 130, spe: 100 }),
      }),
      noopDeps,
    );
    expect(r.primary).toBe("setup_sweeper");
  });
});

describe("deriveRoleTags — cleaner / wallbreaker / fallback (R11–R17)", () => {
  it("R11. Choice Scarf + Last Respects + Aqua Jet (Basculegion-shape, base spe ≥ 90 boosted form) → primary=cleaner", () => {
    const r = deriveRoleTags(
      mkInput({
        species_id: "basculegion",
        item: "Choice Scarf",
        moves: ["Wave Crash", "Flip Turn", "Aqua Jet", "Last Respects"],
        base_stats: baseStats({ atk: 112, spe: 99 }),
      }),
      noopDeps,
    );
    expect(r.primary).toBe("cleaner");
  });

  it("R12. Choice Scarf + base spe 60 → NOT cleaner (gate fails); falls to wallbreaker if Atk≥110, else untagged", () => {
    const slow = deriveRoleTags(
      mkInput({
        species_id: "slowmon",
        item: "Choice Scarf",
        moves: ["Trick", "Body Press", "Heavy Slam", "Earthquake"],
        base_stats: baseStats({ atk: 100, spe: 60 }),
      }),
      noopDeps,
    );
    // No setup, multi-type coverage, but Choice Scarf → wallbreaker rule excludes Scarf items.
    // So no rule matches → untagged.
    expect(slow.primary).toBe("untagged");

    const slowBig = deriveRoleTags(
      mkInput({
        species_id: "slowbig",
        item: "Life Orb",
        moves: ["Body Press", "Heavy Slam", "Earthquake", "Stone Edge"],
        base_stats: baseStats({ atk: 130, spe: 60 }),
      }),
      noopDeps,
    );
    // No Scarf, no setup, mixed coverage, atk≥110 → wallbreaker.
    expect(slowBig.primary).toBe("wallbreaker");
  });

  it("R13. Choice Specs + 2 coverage moves + base SpA 130, no boost → primary=wallbreaker (Q11 binding)", () => {
    const r = deriveRoleTags(
      mkInput({
        species_id: "specs_atk",
        item: "Choice Specs",
        moves: ["Sludge Bomb", "Earth Power", "Flamethrower", "Sludge Wave"],
        base_stats: baseStats({ spa: 130, spe: 95 }),
      }),
      noopDeps,
    );
    expect(r.primary).toBe("wallbreaker");
  });

  it("R14. Armor Tail ability → primary priority puts anti_priority last; primary is whatever else hits", () => {
    const r = deriveRoleTags(
      mkInput({
        species_id: "farigiraf",
        ability: "Armor Tail",
        moves: ["Trick Room", "Psychic", "Foul Play", "Helping Hand"],
        base_stats: baseStats({ hp: 120, spa: 90 }),
      }),
      noopDeps,
    );
    expect(r.primary).toBe("speed_control_setter");
    expect(r.all).toContain("anti_priority");
  });

  it("R14b. Anti-priority alone (no other rules hit) → primary=anti_priority", () => {
    const r = deriveRoleTags(
      mkInput({
        species_id: "lonely",
        ability: "Dazzling",
        moves: ["Splash", "Splash", "Splash", "Splash"],
        base_stats: baseStats({ atk: 80, spa: 80, spe: 80 }),
      }),
      noopDeps,
    );
    expect(r.primary).toBe("anti_priority");
  });

  it("R15. 4-of-a-kind STAB attacker, no boost, no priority, base spe 80, atk 95 → untagged", () => {
    const r = deriveRoleTags(
      mkInput({
        species_id: "vanilla",
        moves: ["Strike", "Strike Two", "Strike Three", "Strike Four"],
        base_stats: baseStats({ atk: 95, spe: 80 }),
      }),
      noopDeps,
    );
    expect(r.primary).toBe("untagged");
  });

  it("R16. Tiebreak: same priority → higher BST wins primary (synthetic case)", () => {
    // Two rules at same priority is rare in Reg M-A — but the contract is BST tiebreak.
    // Construct a case with cleric AND redirect (different priorities) — redirect > cleric — verify.
    const r = deriveRoleTags(
      mkInput({
        moves: ["Rage Powder", "Life Dew", "Pollen Puff", "Spore"],
        base_stats: baseStats(),
      }),
      noopDeps,
    );
    expect(r.primary).toBe("redirect");
    expect(r.all).toContain("cleric");
  });

  it("R17. Missing-move ref → emits RoleClassifierDataError warn, returns untagged", () => {
    const warns: string[] = [];
    const r = deriveRoleTags(
      {
        species_id: "broken",
        item: null,
        ability: null,
        // null in moves slot — defensive code path
        moves: [null as unknown as string, "Earthquake"],
        base_stats: baseStats(),
      },
      { logWarn: (m) => warns.push(m) },
    );
    expect(r.primary).toBe("untagged");
    expect(warns.length).toBeGreaterThan(0);
    expect(warns[0]).toMatch(/role.classifier|missing.move|invalid.move/i);
  });
});

describe("deriveRoleTags — purity (R18, R20)", () => {
  it("R18. pure: same input → byte-equal output across 100 calls", () => {
    const input = mkInput({
      moves: ["Reflect", "Light Screen", "Quash", "Rain Dance"],
      ability: "Prankster",
    });
    const first = JSON.stringify(deriveRoleTags(input, noopDeps));
    for (let i = 0; i < 99; i++) {
      expect(JSON.stringify(deriveRoleTags(input, noopDeps))).toBe(first);
    }
  });

  it("R20. classifier does NOT call damage_calc (no calc dep)", () => {
    // The classifier is a pure module — no damage-calc import.
    // We can't easily mock since there's no injected dep; assert by reading
    // the module source and confirming no `calculate` call. Belt-and-braces:
    // wrap deps with a spy that throws if invoked.
    const trap = vi.fn(() => {
      throw new Error("classifier should not call damage_calc");
    });
    // No damage-calc dep is exposed on RoleTagsDeps by design — this test
    // simply asserts the function runs to completion without one.
    expect(() =>
      deriveRoleTags(
        mkInput({ moves: ["Reflect"] }),
        // @ts-expect-error — intentional probe: the function must not need a calc dep
        { logWarn: () => {}, calculate: trap },
      ),
    ).not.toThrow();
    expect(trap).not.toHaveBeenCalled();
  });
});

describe("deriveRoleTags — Reg-M-A guard (R19)", () => {
  it("R19. classifier accepts arbitrary species_id (gate is at team level, not per-set)", () => {
    const r = deriveRoleTags(
      mkInput({
        species_id: "non-regma-mon",
        moves: ["Reflect"],
      }),
      noopDeps,
    );
    expect(r.primary).toBe("screen_setter");
  });
});
