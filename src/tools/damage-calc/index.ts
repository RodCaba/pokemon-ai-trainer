import type { Result } from "@smogon/calc";
import { Generations, toID } from "@smogon/calc";
import {
  CalcInputSchema,
  CalcResultSchema,
  type CalcInput,
  type CalcResult,
} from "../../schemas/calc";
import { CalcInputError, CalcEngineError } from "../../schemas/errors";
import {
  toEnginePokemon,
  toEngineMove,
  toEngineField,
  ENGINE_GEN,
  ENGINE_VERSION,
} from "./mapping";
import { runEngine } from "./engine";
import { describeResult } from "./describe";

const GEN = Generations.get(ENGINE_GEN);

/**
 * Compute exact Pokemon damage rolls and KO chance for a Reg M-A scenario.
 *
 * Wraps `@smogon/calc`'s Champions gen (`gen.num=0`) calculate path. Validates the input
 * against `CalcInputSchema` before touching the engine, then assembles a fully-cited
 * `CalcResult` with the 16 integer damage rolls, percent range, KO chance, the
 * engine's verbatim description, an echo of the field state, and engine version.
 * Output is self-validated against `CalcResultSchema` before returning.
 *
 * **When to use it:**
 * - Need a single attacker/move/defender damage computation in Pokemon Champions Reg M-A
 *   (one move, one target — multi-target spread reduction is handled by the engine
 *   when the move's metadata says so).
 * - Need exact rolls (16 integers), not just min/max — for OHKO/2HKO statistics, lead
 *   planning, or replay "what if" analysis.
 * - Use this BEFORE constructing any team-builder recommendation, lead plan, or
 *   weakness-audit row that cites a damage number — every cited number must be
 *   reproducible by a `damage_calc` call.
 *
 * **When NOT to use it:**
 * - For team legality checks (use the team-validator tool — separate milestone).
 * - For speed comparisons (use the speed benchmark tool — separate milestone).
 * - For status moves (this throws `CalcInputError("non-damaging move")`).
 *
 * @param input — A Reg M-A `CalcInput`. The schema enforces:
 *   - no `ivs` field (Reg M-A has no IVs; mapping layer always passes 31s to the engine);
 *   - no `teraType` / `teraActive` field (Reg M-A has no Terastallization);
 *   - move name is not "Tera Blast";
 *   - EVs total ≤ 66 across all six stats, ≤ 32 per stat, integer step 1;
 *   - `gen === 9` and `format === "RegM-A"` literals.
 *   The TypeScript type is `CalcInput`; trust-boundary callers (CLI, agent dispatcher)
 *   may receive raw JSON and should cast as `unknown as CalcInput` so the schema gate
 *   does the real validation.
 *
 * @returns A `CalcResult` carrying:
 *   - `rolls`: array of exactly 16 non-negative integers (engine output, never averaged);
 *   - `min_percent` / `max_percent`: rounded to 1 decimal;
 *   - `ko_chance`: `{ description, chance, n }` (e.g., `{description: "guaranteed OHKO", chance: 1, n: 1}`);
 *   - `description`: the engine's `Result.desc()` string verbatim, post-checked to never contain "Tera";
 *   - `field_echo`: the field state used (so the UI can render it without re-deriving);
 *   - `source`: `{ tool, version, computed_at }` for citation.
 *
 *   Immunity (defender immune by type or ability): returns a valid result with
 *   `rolls = [0×16]`, `min_percent = max_percent = 0`, `ko_chance.chance = 0`, and a
 *   synthesized description ending in `"-- immune"`. Immunity is **not** an error.
 *
 * @throws {CalcInputError} If the input fails schema validation (Reg M-A bans, SPS caps,
 *   missing fields), references an unknown species/ability/item/move, or names a status
 *   (non-damaging) move. Carries `.input` (the offending payload) and `.cause` (the
 *   underlying zod or lookup error).
 *
 * @throws {CalcEngineError} If `@smogon/calc`'s `calculate()` throws, or if the engine's
 *   description string ever contains "Tera" (defense-in-depth — Reg M-A has no Tera).
 *   Carries `.input` and `.cause`.
 *
 * @example
 * ```ts
 * const result = damage_calc({
 *   schema_version: 1,
 *   gen: 9,
 *   format: "RegM-A",
 *   attacker: { species: "Garchomp", level: 50, item: "Choice Scarf",
 *               ability: "Rough Skin", nature: "Adamant",
 *               sps: { hp: 0, atk: 32, def: 0, spa: 0, spd: 2, spe: 32 },
 *               moves: ["Earthquake", "Dragon Claw", "Outrage", "Stone Edge"],
 *               status: "Healthy", hpPercent: 100,
 *               statBoosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 } },
 *   defender: { species: "Tyranitar", level: 50, item: "Leftovers",
 *               ability: "Sand Stream", nature: "Careful",
 *               evs: { hp: 32, atk: 0, def: 0, spa: 0, spd: 32, spe: 0 },
 *               moves: ["Crunch", "Stone Edge", "Earthquake", "Protect"],
 *               status: "Healthy", hpPercent: 100,
 *               statBoosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 } },
 *   move: { name: "Earthquake", isCrit: false },
 *   field: { weather: "None", terrain: "None",
 *            isGravity: false, isMagicRoom: false, isWonderRoom: false, isTrickRoom: false,
 *            attackerSide: { reflect: false, lightScreen: false, auroraVeil: false,
 *                            tailwind: false, friendGuards: 0, isHelpingHand: false,
 *                            isBattery: false, isPowerSpot: false },
 *            defenderSide: { reflect: false, lightScreen: false, auroraVeil: false,
 *                            tailwind: false, friendGuards: 0, isHelpingHand: false,
 *                            isBattery: false, isPowerSpot: false } }
 * });
 * // result.rolls       → [174, 176, 180, 180, 182, 186, ..., 206]
 * // result.ko_chance   → { description: "93.8% chance to OHKO", chance: 0.9375, n: 1 }
 * ```
 */
export function damage_calc(input: CalcInput): CalcResult {
  // 1. Schema gate — Reg M-A bans (IVs, Tera, Tera Blast, `evs` key) + SPS caps.
  const parsed = CalcInputSchema.safeParse(input);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "invalid CalcInput";
    throw new CalcInputError(message, { cause: parsed.error, input });
  }
  const data: CalcInput = parsed.data;

  // 2. Domain lookups — fail loudly on unknown species/move/ability/item.
  const move = GEN.moves.get(toID(data.move.name));
  if (!move) throw new CalcInputError(`unknown move: ${data.move.name}`, { input });
  if (move.category === "Status") {
    throw new CalcInputError(`non-damaging move: ${data.move.name}`, { input });
  }

  for (const side of [data.attacker, data.defender] as const) {
    if (!GEN.species.get(toID(side.species))) {
      throw new CalcInputError(`unknown species: ${side.species}`, { input });
    }
    if (!GEN.abilities.get(toID(side.ability))) {
      throw new CalcInputError(`unknown ability: ${side.ability}`, { input });
    }
    if (side.item !== null && !GEN.items.get(toID(side.item))) {
      throw new CalcInputError(`unknown item: ${side.item}`, { input });
    }
  }

  // 3. Engine call — wrap any throw into CalcEngineError.
  let engineResult: Result;
  try {
    const attacker = toEnginePokemon(data.attacker);
    const defender = toEnginePokemon(data.defender);
    const engineMove = toEngineMove(data.move);
    const field = toEngineField(data.field);
    engineResult = runEngine(ENGINE_GEN, attacker, defender, engineMove, field);
  } catch (e) {
    throw new CalcEngineError("calculate() threw", { cause: e, input });
  }

  // 4. Extract rolls — engine returns scalar 0 for type/ability immunity, so
  // we synthesize the immunity-shaped result before any roll-dependent call
  // (desc/kochance both throw on damage === 0 in @smogon/calc 0.10.0).
  const result = extractResult(engineResult, data);

  // 5. Self-validate output before returning. Catches description leaks,
  // shape drift, or any inconsistency our schema knows about.
  return CalcResultSchema.parse(result);
}

const ZERO_ROLLS: number[] = Array.from({ length: 16 }, () => 0);

function extractResult(engineResult: Result, data: CalcInput): CalcResult {
  const damage = engineResult.damage;
  // Normalize the engine's `damage` field, which has three shapes:
  //   - scalar number (immunity case): 0
  //   - number[16] (single-hit damaging move): standard rolls
  //   - number[][] (multi-hit move, one 16-roll array per hit): sum element-wise
  const rolls = normalizeRolls(damage);
  const isImmune = rolls.every((d) => d === 0);

  if (isImmune) {
    return assemble({
      rolls: ZERO_ROLLS,
      min_percent: 0,
      max_percent: 0,
      ko_chance: { description: "no chance to KO (immune)", chance: 0, n: 1 },
      description: synthesizeImmunityDescription(data),
      data,
    });
  }

  const [min, max] = engineResult.range();
  const defenderHp = engineResult.defender.maxHP();
  const min_percent = floor1(((min ?? 0) / defenderHp) * 100);
  const max_percent = floor1(((max ?? 0) / defenderHp) * 100);
  const ko = engineResult.kochance();

  return assemble({
    rolls,
    min_percent,
    max_percent,
    ko_chance: { description: ko.text ?? "", chance: ko.chance ?? 0, n: ko.n ?? 1 },
    description: describeResult(engineResult),
    data,
  });
}

/**
 * Collapse the engine's polymorphic `damage` field to a length-16 number array.
 *
 * - Scalar `0` (immunity) → `[0×16]`.
 * - `number[16]` (single-hit damaging move) → returned as-is.
 * - `number[][]` (multi-hit move, one 16-roll array per hit) → summed
 *   element-wise across hits, producing 16 totals (e.g., 5-hit Pin Missile
 *   with per-hit min 50, max 62 → totals 250..310).
 */
function normalizeRolls(damage: number | number[] | number[][]): number[] {
  if (typeof damage === "number") return ZERO_ROLLS;
  if (damage.length === 0) return ZERO_ROLLS;
  if (typeof damage[0] === "number") return damage as number[];
  // Multi-hit: each entry is a 16-roll array. Sum element-wise.
  const perHit = damage as number[][];
  const out = new Array<number>(16).fill(0);
  for (const hit of perHit) {
    for (let i = 0; i < 16; i++) out[i] = (out[i] ?? 0) + (hit[i] ?? 0);
  }
  return out;
}

function assemble(parts: {
  rolls: number[];
  min_percent: number;
  max_percent: number;
  ko_chance: { description: string; chance: number; n: number };
  description: string;
  data: CalcInput;
}): CalcResult {
  const result: CalcResult = {
    schema_version: 1,
    rolls: parts.rolls,
    min_percent: parts.min_percent,
    max_percent: parts.max_percent,
    ko_chance: parts.ko_chance,
    description: parts.description,
    field_echo: parts.data.field,
    source: {
      tool: "@smogon/calc",
      version: ENGINE_VERSION,
      computed_at: nowIsoNoOffset(),
    },
  };
  return result;
}

function synthesizeImmunityDescription(data: CalcInput): string {
  return `${data.attacker.species} ${data.move.name} vs. ${data.defender.species}: 0-0 (0 - 0%) -- immune`;
}

/**
 * Truncate to 1 decimal place (NOT round). Matches `@smogon/calc`'s `Result.desc()`
 * percent formatting — both Showdown and our engine print `120.7%` for an actual
 * 120.7729...%, not the rounded `120.8%`. Keeping the two in sync prevents
 * description-vs-percent mismatches.
 */
function floor1(n: number): number {
  return Math.floor(n * 10) / 10;
}

function nowIsoNoOffset(): string {
  // ISO-8601 UTC with trailing Z. zod's datetime({ offset: false }) accepts
  // the Z but rejects any +HH:MM offset suffix — Date.toISOString() always
  // produces the Z form so this is safe.
  return new Date().toISOString();
}

export type { CalcInput, CalcResult };
