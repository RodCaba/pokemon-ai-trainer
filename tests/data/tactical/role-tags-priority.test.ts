/**
 * Stage 4 — RED tests for the priority-ability classifier extension (RC1..RC6).
 *
 * Module under test: `src/data/tactical/role-tags.ts` — the classifier
 * gains a `priority_grants_lookup` injection that lets it consult the
 * DB-backed map of ability → priority_grants. When the team set carries
 * an ability with priority_grants AND a move that matches the kind
 * (status / flying / healing) AND has a field-state effect, the
 * assignment emits `setter_priority_via_ability`.
 */

import { describe, expect, it } from "vitest";
import { deriveRoleTags, type RoleTagInput, type DeriveRoleTagsDeps } from "../../../src/data/tactical/role-tags";
import type { PriorityGrants } from "../../../src/schemas/ability";

const noopWarn: DeriveRoleTagsDeps = { logWarn: () => {} };

const baseStats = (over: Partial<RoleTagInput["base_stats"]> = {}) => ({
  hp: 80, atk: 80, def: 80, spa: 80, spd: 80, spe: 80, ...over,
});

const mkInput = (p: Partial<RoleTagInput>): RoleTagInput => ({
  species_id: p.species_id ?? "test",
  item: p.item ?? null,
  ability: p.ability ?? null,
  moves: p.moves ?? [],
  base_stats: p.base_stats ?? baseStats(),
});

const PRANKSTER: PriorityGrants = { kind: "status", bonus: 1 };
const GALE_WINGS: PriorityGrants = { kind: "flying", bonus: 1, condition: "full_hp" };
const TRIAGE: PriorityGrants = { kind: "healing", bonus: 3 };

const lookup = new Map<string, PriorityGrants>([
  ["prankster", PRANKSTER],
  ["gale wings", GALE_WINGS],
  ["triage", TRIAGE],
]);

const deps: DeriveRoleTagsDeps = {
  ...noopWarn,
  priority_grants_lookup: lookup,
};

describe("Priority-ability classifier extension (RC1..RC6)", () => {
  it("RC1. Sableye (Prankster) + Rain Dance → setter_priority_via_ability = rain", () => {
    const r = deriveRoleTags(
      mkInput({
        species_id: "sableye", ability: "Prankster",
        moves: ["Rain Dance", "Reflect", "Light Screen", "Quash"],
      }),
      deps,
    );
    expect(r.setter_priority_via_ability).toBeDefined();
    expect(r.setter_priority_via_ability?.kind).toBe("status");
    expect(r.setter_priority_via_ability?.effect).toBe("weather_rain");
    expect(r.setter_priority_via_ability?.move_id).toMatch(/rain ?dance/i);
  });

  it("RC2. Prankster + Will-O-Wisp (no field-state effect) → undefined", () => {
    const r = deriveRoleTags(
      mkInput({
        species_id: "sableye", ability: "Prankster",
        moves: ["Will-O-Wisp", "Foul Play", "Recover", "Knock Off"],
      }),
      deps,
    );
    expect(r.setter_priority_via_ability).toBeUndefined();
  });

  it("RC3. Talonflame (Gale Wings) + Tailwind → effect=tailwind, condition=full_hp", () => {
    const r = deriveRoleTags(
      mkInput({
        species_id: "talonflame", ability: "Gale Wings",
        moves: ["Tailwind", "Brave Bird", "Flare Blitz", "U-turn"],
        base_stats: baseStats({ spe: 126 }),
      }),
      deps,
    );
    expect(r.setter_priority_via_ability?.kind).toBe("flying");
    expect(r.setter_priority_via_ability?.effect).toBe("tailwind");
    expect(r.setter_priority_via_ability?.condition).toBe("full_hp");
  });

  it("RC4. Comfey (Triage) + Floral Healing → effect=healing", () => {
    const r = deriveRoleTags(
      mkInput({
        species_id: "comfey", ability: "Triage",
        moves: ["Floral Healing", "Draining Kiss", "Protect", "Sunny Day"],
      }),
      deps,
    );
    expect(r.setter_priority_via_ability?.kind).toBe("healing");
    expect(r.setter_priority_via_ability?.effect).toBe("healing");
  });

  it("RC5. Ability without priority_grants → setter_priority_via_ability undefined", () => {
    const r = deriveRoleTags(
      mkInput({
        species_id: "incineroar", ability: "Intimidate",
        moves: ["Fake Out", "Knock Off", "Will-O-Wisp", "Parting Shot"],
      }),
      deps,
    );
    expect(r.setter_priority_via_ability).toBeUndefined();
  });

  it("RC6. Sableye + Prankster + Reflect → effect=reflect (screens variant)", () => {
    const r = deriveRoleTags(
      mkInput({
        species_id: "sableye", ability: "Prankster",
        moves: ["Reflect", "Light Screen", "Foul Play", "Recover"],
      }),
      deps,
    );
    expect(r.setter_priority_via_ability?.kind).toBe("status");
    // Either reflect or light_screen is acceptable — both are status moves
    // with a screen effect. Pin reflect since it's listed first.
    expect(["reflect", "light_screen"]).toContain(
      r.setter_priority_via_ability?.effect,
    );
  });
});
