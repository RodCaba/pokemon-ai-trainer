import { calculate, type Result, type Pokemon, type Move, type Field } from "@smogon/calc";
import type { GenerationNum } from "@smogon/calc/dist/data/interface";

/**
 * Thin seam around `@smogon/calc`'s `calculate()`.
 *
 * Exists so tests can `vi.spyOn(engineModule, "runEngine")` without mocking the entire
 * `@smogon/calc` namespace. Production callers should use `damage_calc` instead — this
 * is the lowest-level wrapper and does no validation, no mapping, no error wrapping.
 *
 * **When to use it:** only inside `damage_calc`'s engine-call try/catch, or in tests
 * that need to inject engine failures (cases 11–12 of `errors.test.ts`).
 *
 * @param gen — `GenerationNum` (0 for Champions in this project; SV would be 9).
 * @param attacker — Engine `Pokemon`, typically built by `toEnginePokemon`.
 * @param defender — Engine `Pokemon`, typically built by `toEnginePokemon`.
 * @param move — Engine `Move`, typically built by `toEngineMove`.
 * @param field — Engine `Field`, typically built by `toEngineField`.
 *
 * @returns The engine's `Result` object. Caller is responsible for handling
 *   engine quirks (e.g., scalar `damage: 0` on immunity, `desc()`/`kochance()` throwing
 *   in that case). `damage_calc` already does so.
 */
export function runEngine(
  gen: GenerationNum,
  attacker: Pokemon,
  defender: Pokemon,
  move: Move,
  field: Field,
): Result {
  return calculate(gen, attacker, defender, move, field);
}
