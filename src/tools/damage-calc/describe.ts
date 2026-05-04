import type { Result } from "@smogon/calc";
import { CalcEngineError } from "../../schemas/errors";

// Reg M-A has no Tera. If the engine ever emits "Tera" in a description (e.g., for
// Tera Blast — which we ban at the schema layer, but defense-in-depth applies),
// we refuse to leak it downstream.
const TERA_IN_DESC = /\bTera\b/;

/**
 * Extract the engine's human-readable damage description, with a Reg M-A defense check.
 *
 * Wraps `Result.desc()` and asserts the output never contains the substring `"Tera"`.
 * Reg M-A has no Terastallization, so any "Tera" in a description means the schema gate
 * was bypassed somehow — refuse to leak it downstream.
 *
 * **When to use it:** internal — called by `damage_calc` when assembling the `CalcResult`.
 * Direct callers (e.g., a future "explain this calc" feature) can call it too.
 *
 * @param result — A `@smogon/calc` `Result` from `calculate()` / `runEngine()`. Must
 *   represent a damaging calc — calling on an immunity result throws upstream because
 *   `Result.desc()` itself throws when `damage === 0`.
 *
 * @returns The engine's verbatim description string, e.g.
 *   `"32+ Atk Garchomp Earthquake vs. 0 HP / 0 Def Tyranitar: 174-206 (99.4 - 117.7%) -- 93.8% chance to OHKO"`.
 *
 * @throws {CalcEngineError} If the description contains `"Tera"` (case-sensitive,
 *   word-boundary). Carries `cause: { description }`.
 */
export function describeResult(result: Result): string {
  const desc = result.desc();
  if (TERA_IN_DESC.test(desc)) {
    throw new CalcEngineError("description leaked Tera text — Reg M-A has no Tera", {
      cause: { description: desc },
    });
  }
  return desc;
}
