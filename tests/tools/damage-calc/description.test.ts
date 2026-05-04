import { describe, expect, it } from "vitest";
import { calculate, type Result } from "@smogon/calc";
import { describeResult } from "../../../src/tools/damage-calc/describe";
import {
  toEnginePokemon,
  toEngineMove,
  toEngineField,
  ENGINE_GEN,
} from "../../../src/tools/damage-calc/mapping";
import { CalcEngineError } from "../../../src/schemas/errors";
import { validAttacker, validDefender, validMove, validField } from "../../fixtures/valid-input";

function realResult(): Result {
  return calculate(
    ENGINE_GEN,
    toEnginePokemon(validAttacker),
    toEnginePokemon(validDefender),
    toEngineMove(validMove),
    toEngineField(validField),
  );
}

describe("describeResult", () => {
  it("1. returns the @smogon/calc Result.desc() string verbatim for a real calc", () => {
    const r = realResult();
    expect(describeResult(r)).toBe(r.desc());
  });

  it("2. does not contain 'Tera' for the canonical valid Reg M-A scenario", () => {
    const r = realResult();
    const desc = describeResult(r);
    expect(desc).not.toMatch(/\bTera\b/);
  });

  it("3. throws CalcEngineError if the engine description contains 'Tera'", () => {
    // Construct a fake Result whose desc() leaks Tera text.
    const fake = { desc: () => "252 SpA Tera Fire Volcarona Flamethrower vs. ..." } as unknown as Result;
    expect(() => describeResult(fake)).toThrow(CalcEngineError);
    try {
      describeResult(fake);
    } catch (e) {
      expect(e).toBeInstanceOf(CalcEngineError);
      expect((e as CalcEngineError).message).toMatch(/description leaked Tera text/);
    }
  });
});
