import { describe, expect, it } from "vitest";
import {
  toEnginePokemon,
  toEngineField,
  ENGINE_GEN,
  ENGINE_VERSION,
} from "../../../src/tools/damage-calc/mapping";
import {
  validAttacker,
  validField,
} from "../../fixtures/valid-input";

describe("toEnginePokemon — Reg M-A IV invariant", () => {
  it("1. constructs Pokemon with ivs = {31,31,31,31,31,31} regardless of input", () => {
    const p = toEnginePokemon(validAttacker);
    expect(p.ivs).toEqual({ hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 });
  });
});

describe("toEnginePokemon — passes through stats", () => {
  it("2. translates SPS (domain) → EVs (engine) verbatim, 1:1 numeric", () => {
    const p = toEnginePokemon(validAttacker);
    // Engine API uses `evs`; our domain uses `sps` (Champions terminology).
    // The mapping layer translates: spec.sps → engine evs.
    expect(p.evs).toEqual(validAttacker.sps);
  });

  it("3. passes nature verbatim", () => {
    const p = toEnginePokemon(validAttacker);
    expect(p.nature).toBe(validAttacker.nature);
  });

  it("4. passes ability verbatim", () => {
    const p = toEnginePokemon(validAttacker);
    expect(p.ability).toBe(validAttacker.ability);
  });
});

describe("toEnginePokemon — item handling", () => {
  it("5. passes item: null as undefined-equivalent to engine", () => {
    const p = toEnginePokemon({ ...validAttacker, item: null });
    expect(p.item == null || p.item === "").toBe(true);
  });
});

describe("toEnginePokemon — boosts and curHP", () => {
  it("6. passes statBoosts 1-to-1 to engine boosts (atk/def/spa/spd/spe)", () => {
    const spec = {
      ...validAttacker,
      statBoosts: { atk: 2, def: -1, spa: 0, spd: 1, spe: 0, acc: 0, eva: 0 },
    };
    const p = toEnginePokemon(spec);
    expect(p.boosts.atk).toBe(2);
    expect(p.boosts.def).toBe(-1);
    expect(p.boosts.spa).toBe(0);
    expect(p.boosts.spd).toBe(1);
    expect(p.boosts.spe).toBe(0);
  });

  it("7. derives engine curHP from hpPercent (50% of maxHP)", () => {
    const p = toEnginePokemon({ ...validAttacker, hpPercent: 50 });
    expect(p.curHP()).toBe(Math.round(p.maxHP() * 0.5));
  });
});

describe("toEnginePokemon — Reg M-A Tera invariant", () => {
  it("8. never sets teraType on engine Pokemon", () => {
    const p = toEnginePokemon(validAttacker);
    expect(p.teraType).toBeUndefined();
  });

  it("9. never sets teraActive on engine Pokemon (no isTera flag enabled)", () => {
    const p = toEnginePokemon(validAttacker);
    // engine exposes either isTera (boolean) or no flag at all when not Tera-active
    const anyP = p as unknown as Record<string, unknown>;
    expect(anyP.isTera ?? false).toBe(false);
  });
});

describe("toEngineField — side conditions", () => {
  it("10. maps SideConditions screens to engine Side flags", () => {
    const f = toEngineField({
      ...validField,
      attackerSide: {
        ...validField.attackerSide,
        reflect: true,
        lightScreen: true,
        auroraVeil: false,
        tailwind: true,
      },
    });
    expect(f.attackerSide.isReflect).toBe(true);
    expect(f.attackerSide.isLightScreen).toBe(true);
    expect(f.attackerSide.isAuroraVeil).toBe(false);
    expect(f.attackerSide.isTailwind).toBe(true);
  });

  it("11. maps friendGuards count >= 1 to isFriendGuard true", () => {
    const f = toEngineField({
      ...validField,
      defenderSide: { ...validField.defenderSide, friendGuards: 1 },
    });
    expect(f.defenderSide.isFriendGuard).toBe(true);

    const f0 = toEngineField({
      ...validField,
      defenderSide: { ...validField.defenderSide, friendGuards: 0 },
    });
    expect(f0.defenderSide.isFriendGuard).toBe(false);
  });
});

describe("toEngineField — weather and terrain", () => {
  it("12. maps weather and terrain enum values to engine constants", () => {
    const f = toEngineField({ ...validField, weather: "Sun", terrain: "Electric" });
    expect(f.weather).toBe("Sun");
    expect(f.terrain).toBe("Electric Terrain");
  });
});

describe("module constants", () => {
  it("13. ENGINE_GEN === 0 (Champions slot in @smogon/calc master)", () => {
    expect(ENGINE_GEN).toBe(0);
  });

  it("14. ENGINE_VERSION matches the @smogon/calc package.json semver", () => {
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+/);
    // Pinned via fork branch (RodCaba/damage-calc#champions-pinned-build at SHA c1f6bc0fa…)
    // tracking upstream master 37b0afa… which contains Champions support.
    // Upstream calc/package.json still reports 0.11.0 — that's the latest published tag.
    expect(ENGINE_VERSION).toBe("0.11.0");
  });
});

describe("toEnginePokemon — auto-Mega-evolution", () => {
  it("15. auto-Megas when item is a Mega Stone matching the species", () => {
    // Garchomp + Garchompite → Garchomp-Mega + Sand Force (the Mega's slot-0 ability)
    const p = toEnginePokemon({
      ...validAttacker,
      species: "Garchomp",
      item: "Garchompite",
      ability: "Rough Skin",
    });
    expect(p.species.name).toBe("Garchomp-Mega");
    expect(p.ability).toBe("Sand Force");
  });

  it("16. respects no_mega: true (keeps base species + spec ability)", () => {
    const p = toEnginePokemon({
      ...validAttacker,
      species: "Garchomp",
      item: "Garchompite",
      ability: "Rough Skin",
      no_mega: true,
    });
    expect(p.species.name).toBe("Garchomp");
    expect(p.ability).toBe("Rough Skin");
  });

  it("17. doesn't auto-Mega when item isn't a Mega Stone for this species", () => {
    // Choice Scarf isn't a Mega Stone → no swap, even if species could otherwise Mega.
    const p = toEnginePokemon({
      ...validAttacker,
      species: "Garchomp",
      item: "Choice Scarf",
      ability: "Rough Skin",
    });
    expect(p.species.name).toBe("Garchomp");
    expect(p.ability).toBe("Rough Skin");
  });
});
