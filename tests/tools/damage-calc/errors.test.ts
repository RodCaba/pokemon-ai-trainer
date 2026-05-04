import { describe, expect, it, vi } from "vitest";
import { damage_calc } from "../../../src/tools/damage-calc";
import type { CalcInput } from "../../../src/schemas/calc";
import { CalcInputError, CalcEngineError } from "../../../src/schemas/errors";
import * as engineModule from "../../../src/tools/damage-calc/engine";
import {
  validInput,
  validAttacker,
  validDefender,
  validMove,
} from "../../fixtures/valid-input";

// These tests deliberately construct runtime-invalid inputs to exercise the
// schema gate. Cast through `unknown` to bypass TS — the runtime contract is
// the schema, not the type.
const asInput = (v: unknown): CalcInput => v as CalcInput;

describe("damage_calc — CalcInputError surface", () => {
  it("1. throws CalcInputError for unknown move name", () => {
    const bad = { ...validInput, move: { ...validMove, name: "Nonsense Beam" } };
    expect(() => damage_calc(asInput(bad))).toThrow(CalcInputError);
  });

  it("2. throws CalcInputError for unknown species", () => {
    const bad = { ...validInput, attacker: { ...validAttacker, species: "Fakemon" } };
    expect(() => damage_calc(asInput(bad))).toThrow(CalcInputError);
  });

  it("3. throws CalcInputError for unknown ability", () => {
    const bad = { ...validInput, attacker: { ...validAttacker, ability: "Made-Up Ability" } };
    expect(() => damage_calc(asInput(bad))).toThrow(CalcInputError);
  });

  it("4. throws CalcInputError for unknown item", () => {
    const bad = { ...validInput, attacker: { ...validAttacker, item: "Made-Up Item" } };
    expect(() => damage_calc(asInput(bad))).toThrow(CalcInputError);
  });

  it("5. throws CalcInputError for status move (e.g. Spore)", () => {
    const bad = { ...validInput, move: { name: "Spore", isCrit: false } };
    expect(() => damage_calc(asInput(bad))).toThrow(CalcInputError);
    try {
      damage_calc(asInput(bad));
    } catch (e) {
      expect(e).toBeInstanceOf(CalcInputError);
      expect((e as CalcInputError).message).toMatch(/non-damaging move/);
    }
  });

  it("6. throws CalcInputError for hpPercent = 101", () => {
    const bad = { ...validInput, attacker: { ...validAttacker, hpPercent: 101 } };
    expect(() => damage_calc(asInput(bad))).toThrow(CalcInputError);
  });

  it("7. throws CalcInputError when ivs key present", () => {
    const bad = {
      ...validInput,
      attacker: {
        ...validAttacker,
        ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      },
    };
    expect(() => damage_calc(asInput(bad))).toThrow(CalcInputError);
    try {
      damage_calc(asInput(bad));
    } catch (e) {
      expect((e as CalcInputError).message).toMatch(/IVs are not configurable in Reg M-A/);
    }
  });

  it("8. throws CalcInputError when teraType key present", () => {
    const bad = { ...validInput, attacker: { ...validAttacker, teraType: "Dark" } };
    expect(() => damage_calc(asInput(bad))).toThrow(CalcInputError);
    try {
      damage_calc(asInput(bad));
    } catch (e) {
      expect((e as CalcInputError).message).toMatch(/Tera is not legal in Reg M-A/);
    }
  });

  it("9. throws CalcInputError when SPS total = 67", () => {
    const bad = {
      ...validInput,
      defender: {
        ...validDefender,
        sps: { hp: 32, atk: 32, def: 3, spa: 0, spd: 0, spe: 0 }, // 67
      },
    };
    expect(() => damage_calc(asInput(bad))).toThrow(CalcInputError);
    try {
      damage_calc(asInput(bad));
    } catch (e) {
      expect((e as CalcInputError).message).toMatch(/SPS total exceeds Reg M-A 66-point cap/);
    }
  });

  it("10. CalcInputError carries the offending input on .input", () => {
    const bad = { ...validInput, attacker: { ...validAttacker, hpPercent: 200 } };
    try {
      damage_calc(asInput(bad));
      expect.fail("expected damage_calc to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(CalcInputError);
      expect((e as CalcInputError).input).toEqual(bad);
    }
  });
});

describe("damage_calc — CalcEngineError surface", () => {
  it("11. wraps and re-throws CalcEngineError when @smogon/calc throws", () => {
    const spy = vi.spyOn(engineModule, "runEngine").mockImplementation(() => {
      throw new Error("boom from inside engine");
    });
    try {
      expect(() => damage_calc(validInput)).toThrow(CalcEngineError);
    } finally {
      spy.mockRestore();
    }
  });

  it("12. CalcEngineError carries cause and input", () => {
    const original = new Error("boom from inside engine");
    const spy = vi.spyOn(engineModule, "runEngine").mockImplementation(() => {
      throw original;
    });
    try {
      damage_calc(validInput);
      expect.fail("expected damage_calc to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(CalcEngineError);
      expect((e as CalcEngineError).cause).toBe(original);
      expect((e as CalcEngineError).input).toEqual(validInput);
    } finally {
      spy.mockRestore();
    }
  });

  it("13. immunity case (Earthquake vs Levitate Rotom-Wash) returns valid CalcResult, NOT an error", () => {
    // Rotom-Wash is in Champions (Wash Rotom form); Levitate makes it immune to Ground.
    const input: CalcInput = {
      ...validInput,
      defender: {
        ...validInput.defender,
        species: "Rotom-Wash",
        ability: "Levitate",
        item: "Leftovers",
        moves: ["Hydro Pump", "Thunderbolt", "Volt Switch", "Will-O-Wisp"],
      },
      move: { name: "Earthquake", isCrit: false },
    };
    const result = damage_calc(input);
    expect(result.rolls).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(result.min_percent).toBe(0);
    expect(result.max_percent).toBe(0);
    expect(result.ko_chance.chance).toBe(0);
  });
});
