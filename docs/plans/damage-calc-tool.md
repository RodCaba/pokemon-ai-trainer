# Tech Plan — `damage_calc` tool

**Slug:** `damage-calc-tool`
**Stage:** 3 (Tech plan)
**Status:** Approved — Stage 4 in progress
**Approved-by:** Rodrigo Caballero (2026-04-29)
**Stage 4 update:** Per Q1, Tera Blast is banned at schema level via a move deny list in `MoveSpecSchema` (`MOVE_DENYLIST = ["Tera Blast"]`); rejection message: "Tera Blast is not legal in Reg M-A".
**Author:** Tech Lead subagent
**Date:** 2026-04-28
**Implements flow doc:** `/Users/rodrigo/src/pokemon-ai-trainer/docs/flows/damage-calc-tool.md` (Stage 2 approved by Rodrigo Caballero)

---

## 1. Architecture overview

This is a single pure function with strong I/O validation. Over-engineering would be a sin. The patterns chosen are the minimum to keep numerical correctness, Reg M-A rule enforcement, and future tool-layer reuse honest.

| Pattern | Why (1 line) | Without it |
|---|---|---|
| **Ports-and-Adapters (Hexagonal)** at the tool boundary | The pure `damage_calc(input)` is the port; `@smogon/calc` is one adapter behind a mapping module. | Calc engine internals leak into agent code; swapping or upgrading the engine forces ripple changes everywhere. |
| **Anti-Corruption Layer** (`mapping.ts`) between `CalcInput` and `@smogon/calc` primitives | Reg M-A rules (IVs always 31, no Tera) live in our domain, not the upstream library's. | Our Reg M-A invariants would be silently violated whenever upstream defaults shift. |
| **Schema-first contracts (zod)** as the single source of types | Both runtime validation and TS types derive from one zod definition (`z.infer`). Tests assert the schema, not duplicated types. | Type drift between schema and TS; runtime payloads differ from compile-time types. |
| **Error-type hierarchy** (`CalcInputError`, `CalcEngineError` extend a `CalcError` base) | Caller agent can distinguish "your input was bad" from "the engine blew up" without string sniffing. | Agents would catch generic `Error` and either swallow distinctions or guess via `.message`. |
| **Golden fixture tests as the contract** | Numerical correctness is verified against immutable JSON fixtures cross-checked against Showdown UI. | The only safety net for upstream `@smogon/calc` patches becomes hand-testing. |
| **JSON Schema export co-located with the tool** | Anthropic SDK tool definition is generated from the same zod schema (via `zod-to-json-schema`) — no drift between agent-visible contract and runtime validator. | Agent receives a stale or wrong tool description and calls the function with invalid shapes. |

**Considered and rejected:**

- **Repository pattern.** Rejected: no storage in this slice; calc is in-memory and pure.
- **Caching layer (e.g., LRU on `CalcInput`).** Rejected for v1: the function is sub-millisecond; caching adds invalidation complexity. Revisit at agent layer if profiling shows hotspots.
- **Builder pattern for `CalcInput`.** Rejected: agents call us with a JSON object; a fluent builder is unused weight.
- **Result type (`Result<CalcResult, CalcError>`) instead of throwing.** Rejected for v1: TypeScript ecosystem expects `throw`; CLAUDE.md §3 wants loud failures, and our error hierarchy gives callers everything `Result` would.
- **Branded types for `Species`/`MoveName`.** Rejected for v1: zod string + enum check from `@smogon/calc`'s data is sufficient and avoids re-exporting the Pokedex.

---

## 2. Module decomposition

Mirrors flow doc §2.5. All paths absolute under `/Users/rodrigo/src/pokemon-ai-trainer/`.

### `src/schemas/evs.ts`
- **Responsibility:** Reg M-A EV spread validator (≤66 total, ≤32 per stat, integer step 1, non-negative).
- **Exports:** `EvSpreadSchema: z.ZodSchema<EvSpread>`, `type EvSpread`.
- **Depends on:** `zod`.

### `src/schemas/calc.ts`
- **Responsibility:** zod schemas for `CalcInput`, `CalcResult`, `Field`, `SideConditions`, `MoveSpec`, `PokemonSpec`. Encodes Reg M-A bans (no `ivs`, no `tera*`).
- **Exports:** `CalcInputSchema`, `CalcResultSchema`, `FieldSchema`, `SideConditionsSchema`, `MoveSpecSchema`, `PokemonSpecSchema`, plus `z.infer` types (`CalcInput`, `CalcResult`, `Field`, `SideConditions`, `MoveSpec`, `PokemonSpec`).
- **Depends on:** `zod`, `./evs`.

### `src/schemas/errors.ts`
- **Responsibility:** Error class hierarchy.
- **Exports:** `class CalcError extends Error`, `class CalcInputError extends CalcError`, `class CalcEngineError extends CalcError`.
- **Depends on:** none.

### `src/tools/damage-calc/SPEC.md`
- **Responsibility:** Human-readable contract per CLAUDE.md §8 ("Adding a new tool" requires a SPEC.md first). Mirrors this plan's §4 + §6 + §7.
- **Exports:** none (markdown).

### `src/tools/damage-calc/mapping.ts`
- **Responsibility:** Anti-corruption layer. `toEnginePokemon(spec) → Pokemon`, `toEngineMove(spec) → Move`, `toEngineField(field) → Field`. **Always** sets IVs to `{hp:31, atk:31, def:31, spa:31, spd:31, spe:31}`. Never reads any IV-like input (would be rejected by schema before reaching here, but mapping double-asserts).
- **Exports:** `toEnginePokemon`, `toEngineMove`, `toEngineField`, `ENGINE_GEN = 9 as const`, `ENGINE_VERSION: string` (read from `@smogon/calc/package.json` at module load).
- **Depends on:** `@smogon/calc`, `../../schemas/calc`.

### `src/tools/damage-calc/describe.ts`
- **Responsibility:** Wrap `@smogon/calc`'s `Result.desc()` and assert post-condition that the description never contains the substring `"Tera"` (case-sensitive — upstream uses capitalized "Tera"). If it does, throw `CalcEngineError("description leaked Tera text")`.
- **Exports:** `describeResult(engineResult, input): string`.
- **Depends on:** `@smogon/calc`, `../../schemas/errors`.

### `src/tools/damage-calc/index.ts`
- **Responsibility:** The pure function `damage_calc(input: CalcInput): CalcResult`. Sequence: input zod parse → map → `calculate(...)` → extract rolls/koChance/desc → assemble → output zod parse → return.
- **Exports:** `damage_calc(input)`, `CalcInput`, `CalcResult` (re-export from schemas), `damageCalcToolDefinition` (Anthropic SDK tool definition with JSON Schema).
- **Depends on:** `@smogon/calc`, `./mapping`, `./describe`, `../../schemas/calc`, `../../schemas/errors`, `zod-to-json-schema`.

### `src/tools/damage-calc/tool-definition.ts`
- **Responsibility:** Generate Anthropic SDK tool definition `{ name, description, input_schema }` from `CalcInputSchema` via `zod-to-json-schema`.
- **Exports:** `damageCalcToolDefinition: Anthropic.Tool`.
- **Depends on:** `../../schemas/calc`, `zod-to-json-schema`.

### `src/cli/tool-calc.ts`
- **Responsibility:** CLI entry point for `pnpm tool:calc <fixture-name> [--json]`.
- **Exports:** `main()` (called from script).
- **Depends on:** `../tools/damage-calc`, `node:fs/promises`, `node:path`.

### `fixtures/calcs/README.md`
- **Responsibility:** Cross-check log (see §9).

### `fixtures/calcs/<id>.json`
- **Responsibility:** One golden fixture per file (≥20 files; target 28).

### `tests/tools/damage-calc/{schema,mapping,golden,determinism,errors,description,tool-definition}.test.ts` and `tests/cli/tool-calc.test.ts`
- **Responsibility:** Per §7 below.

---

## 3. Data schemas

These are the **binding contracts** for Stage 4. Reg M-A rules are enforced at schema time.

```ts
// src/schemas/evs.ts
import { z } from "zod";

const EV_TOTAL_CAP = 66;
const EV_PER_STAT_CAP = 32;

const SingleEv = z
  .number()
  .int("EVs must be integers (Reg M-A step size = 1)")
  .nonnegative("EVs must be non-negative")
  .max(EV_PER_STAT_CAP, `Per-stat EV cap is ${EV_PER_STAT_CAP} in Reg M-A`);

export const EvSpreadSchema = z
  .object({
    hp: SingleEv,
    atk: SingleEv,
    def: SingleEv,
    spa: SingleEv,
    spd: SingleEv,
    spe: SingleEv,
  })
  .strict()
  .refine(
    (e) => e.hp + e.atk + e.def + e.spa + e.spd + e.spe <= EV_TOTAL_CAP,
    { message: `EV total exceeds Reg M-A ${EV_TOTAL_CAP}-point cap` },
  );

export type EvSpread = z.infer<typeof EvSpreadSchema>;
```

```ts
// src/schemas/calc.ts
import { z } from "zod";
import { EvSpreadSchema } from "./evs";

const FORBIDDEN_KEYS = ["ivs", "iv", "teraType", "tera_type", "teraActive", "tera"] as const;
const forbidIllegalKeys = <T extends z.ZodRawShape>(s: z.ZodObject<T>) =>
  s.strict().superRefine((val, ctx) => {
    for (const k of FORBIDDEN_KEYS) {
      if (k in (val as Record<string, unknown>)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: k.startsWith("iv")
            ? "IVs are not configurable in Reg M-A"
            : "Tera is not legal in Reg M-A",
          path: [k],
        });
      }
    }
  });

export const NatureSchema = z.enum([
  "Hardy","Lonely","Brave","Adamant","Naughty",
  "Bold","Docile","Relaxed","Impish","Lax",
  "Timid","Hasty","Serious","Jolly","Naive",
  "Modest","Mild","Quiet","Bashful","Rash",
  "Calm","Gentle","Sassy","Careful","Quirky",
]);

export const StatusSchema = z.enum([
  "Healthy","Burned","Paralyzed","Poisoned","Badly Poisoned","Asleep","Frozen",
]);

export const StatBoostsSchema = z.object({
  atk: z.number().int().min(-6).max(6).default(0),
  def: z.number().int().min(-6).max(6).default(0),
  spa: z.number().int().min(-6).max(6).default(0),
  spd: z.number().int().min(-6).max(6).default(0),
  spe: z.number().int().min(-6).max(6).default(0),
  acc: z.number().int().min(-6).max(6).default(0),
  eva: z.number().int().min(-6).max(6).default(0),
}).strict();

export const PokemonSpecSchema = forbidIllegalKeys(z.object({
  species: z.string().min(1),
  level: z.literal(50),
  item: z.string().nullable(),
  ability: z.string().min(1),
  nature: NatureSchema,
  evs: EvSpreadSchema,
  moves: z.array(z.string().min(1)).length(4),
  statBoosts: StatBoostsSchema.default({
    atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0,
  }),
  status: StatusSchema.default("Healthy"),
  hpPercent: z.number().min(0).max(100).default(100),
}));

export const MoveSpecSchema = forbidIllegalKeys(z.object({
  name: z.string().min(1),
  isCrit: z.boolean().default(false),
  hits: z.number().int().min(1).max(10).optional(),
}));

export const SideConditionsSchema = z.object({
  reflect: z.boolean().default(false),
  lightScreen: z.boolean().default(false),
  auroraVeil: z.boolean().default(false),
  tailwind: z.boolean().default(false),
  friendGuards: z.number().int().min(0).max(2).default(0),
  isHelpingHand: z.boolean().default(false),
  isBattery: z.boolean().default(false),
  isPowerSpot: z.boolean().default(false),
}).strict();

export const WeatherSchema = z.enum([
  "None","Sun","Harsh Sunshine","Rain","Heavy Rain","Sand","Snow","Hail",
]).default("None");

export const TerrainSchema = z.enum([
  "None","Electric","Grassy","Misty","Psychic",
]).default("None");

export const FieldSchema = forbidIllegalKeys(z.object({
  weather: WeatherSchema,
  terrain: TerrainSchema,
  isGravity: z.boolean().default(false),
  isMagicRoom: z.boolean().default(false),
  isWonderRoom: z.boolean().default(false),
  isTrickRoom: z.boolean().default(false),
  attackerSide: SideConditionsSchema.default({} as never),
  defenderSide: SideConditionsSchema.default({} as never),
}));

export const CalcInputSchema = forbidIllegalKeys(z.object({
  schema_version: z.literal(1),
  gen: z.literal(9),
  format: z.literal("RegM-A"),
  attacker: PokemonSpecSchema,
  defender: PokemonSpecSchema,
  move: MoveSpecSchema,
  field: FieldSchema,
}));

export const KoChanceSchema = z.object({
  description: z.string(),
  chance: z.number().min(0).max(1),
  n: z.number().int().min(1).default(1),
}).strict();

export const SourceSchema = z.object({
  tool: z.literal("@smogon/calc"),
  version: z.string().regex(/^\d+\.\d+\.\d+/),
  computed_at: z.string().datetime({ offset: false }),
}).strict();

export const CalcResultSchema = z.object({
  schema_version: z.literal(1),
  rolls: z.array(z.number().int().nonnegative()).length(16),
  min_percent: z.number().min(0),
  max_percent: z.number().min(0),
  ko_chance: KoChanceSchema,
  description: z.string().refine(
    (s) => !/\bTera\b/.test(s),
    { message: "description leaked Tera text — Reg M-A has no Tera" },
  ),
  field_echo: FieldSchema,
  source: SourceSchema,
}).strict().refine((r) => r.min_percent <= r.max_percent, {
  message: "min_percent must be <= max_percent",
});

export type CalcInput = z.infer<typeof CalcInputSchema>;
export type CalcResult = z.infer<typeof CalcResultSchema>;
export type Field = z.infer<typeof FieldSchema>;
export type SideConditions = z.infer<typeof SideConditionsSchema>;
```

```ts
// src/schemas/errors.ts
export class CalcError extends Error {
  readonly cause?: unknown;
  readonly input?: unknown;
  constructor(message: string, opts?: { cause?: unknown; input?: unknown }) {
    super(message);
    this.name = this.constructor.name;
    this.cause = opts?.cause;
    this.input = opts?.input;
  }
}
export class CalcInputError extends CalcError {}
export class CalcEngineError extends CalcError {}
```

---

## 4. Mapping layer contract

`mapping.ts` is the only place that touches `@smogon/calc`'s `Pokemon`/`Move`/`Field` constructors. Rules:

1. **IVs are hard-coded.** Always pass `ivs: { hp:31, atk:31, def:31, spa:31, spd:31, spe:31 }`. Never read any IV-shaped key from input. Asserted by a unit test that intercepts the constructor.
2. **EVs pass through verbatim.** Schema already proved they're integers within caps.
3. **Tera fields never set.** Constructor called without `teraType`.
4. **Item:** if input `item === null`, pass `undefined` (or `""` per `@smogon/calc` convention; verify on first run — Stage 4 test pins this).
5. **Status / boosts / hpPercent:** mapped 1-to-1 (`status`, `boosts`, `curHP` derived from `originalCurHP * hpPercent / 100`).
6. **Field side conditions:** explicit booleans → `@smogon/calc` `Side` flags. `friendGuards` count → loop applying the modifier (verify and pin).
7. **`isCrit`** flows to `Move` constructor. **`hits`** override flows to `Move.hits` for multi-hit moves.
8. **Engine version capture.** At module load, `mapping.ts` reads `@smogon/calc/package.json` (via `createRequire(import.meta.url)`) and exports `ENGINE_VERSION` as a string. Populates `CalcResult.source.version`.
9. **Generation:** always `9`. Constant `ENGINE_GEN = 9`.

---

## 5. Error model

```ts
new CalcInputError("EV total exceeds Reg M-A 66-point cap", { input, cause: zodError });
new CalcInputError("IVs are not configurable in Reg M-A", { input });
new CalcInputError("Tera is not legal in Reg M-A", { input });
new CalcInputError("non-damaging move", { input });
new CalcInputError("unknown species: <name>", { input });

new CalcEngineError("calculate() threw", { input, cause: originalError });
new CalcEngineError("description leaked Tera text", { input, cause: { description } });
```

Rules:
- **Errors are never swallowed.** `damage_calc` either returns a valid `CalcResult` or throws.
- **Both error classes carry `input`** so caller agents can log and reproduce.
- **Immunity is not an error.** Zero-damage rolls are valid output.
- **Status moves are an error** — calc tool is for damage; status moves go through different agent paths.

---

## 6. Tool layer contract for the agent (Anthropic SDK tool definition)

Generated from `CalcInputSchema` via `zod-to-json-schema`:

```ts
{
  name: "damage_calc",
  description:
    "Compute exact Pokemon damage rolls and KO chance for a Reg M-A scenario. " +
    "Wraps @smogon/calc. Inputs MUST omit IVs (Reg M-A treats all IVs as 31) " +
    "and MUST omit any Tera field (Reg M-A has no Terastallization). " +
    "EVs total ≤ 66 across all six stats, ≤ 32 per stat, integer steps of 1. " +
    "Returns the 16-roll integer array, min/max percent, KO chance, the human-readable " +
    "description, an echo of the field state, and engine version for citation.",
  input_schema: zodToJsonSchema(CalcInputSchema, {
    name: "CalcInput",
    $refStrategy: "none",
    target: "openApi3",
  }),
}
```

Stage 4 will assert: (a) JSON Schema rejects `ivs`, (b) rejects `teraType`, (c) requires `evs.hp..spe` on attacker, (d) the `description` mentions "Reg M-A" and "no Terastallization".

---

## 7. Test strategy (drives Stage 4)

Files and individual `it(...)` cases, in **the order Stage 4 will write them** so each fails for the right reason. Tests precede production code; signatures get scaffolded just enough for failure to be an assertion (not an import error).

### `tests/tools/damage-calc/schema.test.ts`

1. accepts a minimal valid `CalcInput`.
2. rejects payload with `ivs` on attacker (CalcInputError, message mentions IVs).
3. rejects payload with `ivs` on defender.
4. rejects payload with `teraType` on attacker.
5. rejects payload with `teraActive` on attacker.
6. rejects payload with top-level `tera` key.
7. rejects EV total of 67 (cap is 66).
8. accepts EV total of exactly 66.
9. rejects per-stat EV of 33 (per-stat cap is 32).
10. accepts per-stat EV of exactly 32.
11. rejects negative EV (-1).
12. rejects non-integer EV (4.5).
13. accepts integer EV step of 1 (e.g. `{hp:5,atk:7,...}`) — confirms step-of-1.
14. rejects unknown extra key on `PokemonSpec` (.strict).
15. rejects level !== 50.
16. rejects move array of length != 4.
17. rejects hpPercent > 100.
18. rejects hpPercent < 0.
19. rejects unknown nature.
20. rejects unknown status.
21. rejects gen !== 9.
22. rejects format !== "RegM-A".
23. `CalcResultSchema` rejects rolls.length != 16.
24. `CalcResultSchema` rejects min_percent > max_percent.
25. `CalcResultSchema` rejects description containing "Tera".
26. `CalcResultSchema` rejects `ko_chance.chance` > 1.

### `tests/tools/damage-calc/mapping.test.ts`

(Spy/mock on the `@smogon/calc` `Pokemon` constructor.)

1. constructs Pokemon with `ivs = {31,31,31,31,31,31}` regardless of input.
2. passes EVs verbatim from `CalcInput` to engine Pokemon.
3. passes nature verbatim.
4. passes ability verbatim.
5. passes `item: null` as undefined-equivalent to engine.
6. passes `statBoosts` 1-to-1 to engine boosts.
7. derives engine `curHP` from `hpPercent` (e.g., 50% of 200 max = 100).
8. never sets `teraType` on engine Pokemon.
9. never sets `teraActive` on engine Pokemon.
10. maps `SideConditions` screens to engine `Side` flags.
11. maps `friendGuards` count of 2 to engine appropriately (pin upstream API).
12. maps weather and terrain enum values to engine constants.
13. sets generation to 9.
14. captures `@smogon/calc` package version into `ENGINE_VERSION`.

### `tests/tools/damage-calc/golden.test.ts`

Loads every JSON file in `fixtures/calcs/`, runs `damage_calc(fixture.input)`, asserts `expected.rolls` deep-equal, plus `expected.min_percent`, `max_percent`, `ko_chance.chance`, `description` exact-equal.

**Fixture file shape (binding):**

```jsonc
{
  "id": "001-urshifu-s-wicked-blow-vs-flutter-mane",
  "schema_version": 1,
  "scenario": "32 Atk CB Urshifu-S Wicked Blow vs. 0 HP / 0 Def Flutter Mane (always crits)",
  "showdown_calc_url": "https://calc.pokemonshowdown.com/?...",
  "verified_at": "2026-04-28",
  "verified_by": "RC",
  "input":  { /* full CalcInput conforming to CalcInputSchema */ },
  "expected": {
    "rolls":        [ /* exactly 16 integers */ ],
    "min_percent":  118.6,
    "max_percent":  139.9,
    "ko_chance":    { "description": "guaranteed OHKO", "chance": 1, "n": 1 },
    "description":  "..."
  }
}
```

**Mandatory categories (target 28 fixtures, floor 20):**
1. Plain STAB physical (no item, no field).
2. Plain STAB special (no item, no field).
3. Non-STAB neutral.
4. Super-effective by type.
5. Resisted by type.
6. Immune by type → rolls all zero.
7. Immune by ability (Levitate, Lightning Rod, Storm Drain, Flash Fire, Sap Sipper).
8. Critical hit (`isCrit: true`).
9. Multi-hit move (Reg M-A-legal — pin in fixture).
10. Choice Band boost.
11. Choice Specs boost.
12. Life Orb boost.
13. Sun-boosted Fire move.
14. Rain-boosted Water move.
15. Electric Terrain boost (grounded attacker).
16. Grassy Terrain boost.
17. Reflect halves physical.
18. Light Screen halves special.
19. Aurora Veil under Snow.
20. Helping Hand 1.5x.
21. Friend Guard (one ally) — 0.75x.
22. Burn halves physical attack.
23. Reflect+Friend Guard stack.
24. Restricted scenario: Calyrex-S Astral Barrage vs. Urshifu-R.
25. Restricted scenario: Miraidon Electro Drift vs. Amoonguss in Electric Terrain.
26. Common defender: Incineroar Flare Blitz from common attacker.
27. Common support: Rillaboom Wood Hammer in Grassy Terrain vs. bulky water.
28. (Reserve / spare for any rule revisions.)

**Every fixture MUST satisfy:** EV total ≤ 66, no Tera anywhere, no `ivs` key.

Per-fixture parameterized cases:
- `it.each(fixtures)("<id>: rolls deep-equal expected")`.
- `it.each(fixtures)("<id>: min_percent exact match")`.
- `it.each(fixtures)("<id>: max_percent exact match")`.
- `it.each(fixtures)("<id>: ko_chance.chance exact match")`.
- `it.each(fixtures)("<id>: description exact match")`.
- `it.each(fixtures)("<id>: description does not contain 'Tera'")`.
- `it.each(fixtures)("<id>: input.attacker.evs total ≤ 66")` (fixture self-check).
- `it.each(fixtures)("<id>: input.defender.evs total ≤ 66")`.
- `it("every fixture in fixtures/calcs has a row in README.md")`.

### `tests/tools/damage-calc/determinism.test.ts`

1. returns identical `CalcResult` (excluding `source.computed_at`) on two consecutive calls with the same input.
2. returns identical `CalcResult` across 100 invocations.
3. `source.computed_at` differs between calls but rolls/koChance/description do not.

### `tests/tools/damage-calc/errors.test.ts`

1. throws `CalcInputError` for unknown move name.
2. throws `CalcInputError` for unknown species.
3. throws `CalcInputError` for unknown ability.
4. throws `CalcInputError` for unknown item.
5. throws `CalcInputError` for status move (e.g. Spore).
6. throws `CalcInputError` for hpPercent = 101.
7. throws `CalcInputError` when `ivs` key present.
8. throws `CalcInputError` when `teraType` key present.
9. throws `CalcInputError` when EV total = 67.
10. `CalcInputError` carries the offending input on `.input`.
11. `CalcEngineError` wraps and re-throws when `@smogon/calc` throws (mock engine).
12. `CalcEngineError` carries cause and input.
13. immunity case (Earthquake vs Levitate Flutter Mane) returns valid `CalcResult`, NOT an error.

### `tests/tools/damage-calc/description.test.ts`

1. description is the `@smogon/calc` `Result.desc()` string verbatim.
2. description never contains "Tera" across all golden fixtures.
3. throws `CalcEngineError` if engine description ever contains "Tera" (mock engine to inject).

### `tests/tools/damage-calc/tool-definition.test.ts`

1. exports a tool definition with `name === "damage_calc"`.
2. description mentions "Reg M-A", "no Terastallization", "66".
3. `input_schema` rejects payload with `ivs` (validate via JSON Schema validator, not zod).
4. `input_schema` rejects payload with `teraType`.
5. `input_schema` requires `evs.hp..spe` on attacker.
6. `input_schema` is JSON-serializable.

### `tests/cli/tool-calc.test.ts`

1. `pnpm tool:calc <fixture-id>` exits 0 and prints a human-readable summary.
2. `--json` flag emits a JSON-parseable `CalcResult` on stdout.
3. exits 1 with a `CalcInputError` message when fixture is malformed.
4. exits 2 when fixture id not found.
5. does not print "Tera" for any fixture.

---

## 8. Cross-check protocol — `fixtures/calcs/README.md`

| ID | Scenario | Showdown calc URL (IVs=31) | EV totals (atk/def) | Verified at | Verified by |
|----|----------|----------------------------|---------------------|-------------|-------------|
| 001-urshifu-s-wicked-blow-vs-flutter-mane | … | https://calc.pokemonshowdown.com/?... | 56 / 32 | 2026-04-28 | RC |

Rules:
- Showdown URL must have all IVs explicitly set to 31 across all six stats for both Pokemon (URL parameter inspection, not just default).
- "Verified by" is the human (initials) who eyeballed the Showdown UI.
- A fixture without a row in this table is a CI failure (test in `golden.test.ts` enforces).

---

## 9. CLI smoke tool — `pnpm tool:calc`

### Invocation
```
pnpm tool:calc <fixture-id> [--json]
```

### Argument parsing
- `node:util.parseArgs` (no extra dep).
- Positional: fixture id (must match `fixtures/calcs/<id>.json`).
- Flag: `--json` → emit JSON only.

### Output (pretty default)
```
Scenario: 32 Atk CB Urshifu-S Wicked Blow vs. 0 HP / 0 Def Flutter Mane (crit)
Engine:   @smogon/calc 0.X.Y
Result:   312-368 (118.6 - 139.9%)
KO:       guaranteed OHKO (chance 1.00)
Rolls:    [312, 314, 316, 320, 324, 326, 330, 332, 336, 338, 342, 344, 348, 350, 354, 368]
Source:   @smogon/calc 0.X.Y @ 2026-04-28T12:34:56Z
```

### Output (`--json`)
The full `CalcResult` object, `JSON.stringify(result, null, 2)`.

### Exit codes
- `0` — success.
- `1` — `CalcInputError`.
- `2` — fixture id not found.
- `3` — `CalcEngineError`.
- `64` — argv usage error.

### Wiring
`package.json` → `"scripts": { "tool:calc": "tsx src/cli/tool-calc.ts" }`.

---

## 10. Dependencies & versioning

| Package | Version strategy | Why |
|---------|------------------|-----|
| `@smogon/calc` | **exact pin** (no `^`, no `~`) | Per flow Q1 + CLAUDE.md §4: golden fixtures depend on byte-stable engine output. |
| `zod` | `^3.23.0` | Schema-first validation. |
| `zod-to-json-schema` | `^3.22.0` | Generates Anthropic SDK tool definition from the same zod schema. |
| `vitest` | `^1.6.0` | Test runner per CLAUDE.md §10. |
| `@vitest/ui` | `^1.6.0` (devDep) | DX. |
| `tsx` | `^4.7.0` | Run TS CLI without a build step. |
| `@anthropic-ai/sdk` | `^0.30.0` (devDep here) | Type alignment for `Anthropic.Tool`. |
| `typescript` | `^5.4.0` | Strict mode per §10. |

No other runtime deps.

---

## 11. Reuse audit

Repo currently contains only `CLAUDE.md`, `PRD.md`, and `docs/`. There is no existing TypeScript source, no `package.json`, no schemas, no test infrastructure. Everything in this plan is greenfield. No reuse opportunities to flag.

---

## 12. Risks & mitigations

| # | Risk | Mitigation |
|---|------|-----------|
| 1 | `@smogon/calc` `Result.desc()` may include "Tera" for some inputs (e.g., labels Tera Blast). | Description post-condition in `describe.ts` throws `CalcEngineError` if it does. `CalcResultSchema.description` rejects via refine. **Decision needed before Stage 5** — see hand-off. |
| 2 | `@smogon/calc` may reject `{31,31,31,31,31,31}` for some species. | Mapping test asserts the constructor accepts 31s for every species in fixture set. |
| 3 | Fixture drift on `@smogon/calc` upgrade. | Exact version pin (§10). Upgrade is a separate PR with full re-verification. |
| 4 | Reg M-A meta shifts; restricted Pokemon list changes. | Calc tool is format-agnostic at math layer (per flow Q8). Fixtures are data, easy to swap. |
| 5 | `@smogon/calc` field/side API differs from our `SideConditionsSchema` shape. | Mapping tests pin actual upstream API by mocking the constructor and asserting exact call shape. |

---

## 13. Stage 4 hand-off checklist (test order)

1. `schema.test.ts` cases 1–10.
2. `schema.test.ts` cases 11–22.
3. `schema.test.ts` cases 23–26.
4. `errors.test.ts` cases 1–10.
5. `mapping.test.ts` cases 1–14.
6. `description.test.ts` cases 1–3.
7. `errors.test.ts` cases 11–13.
8. `golden.test.ts` parameterized cases (fixtures must exist by this point).
9. `determinism.test.ts` cases 1–3.
10. `tool-definition.test.ts` cases 1–6.
11. `cli/tool-calc.test.ts` cases 1–5.

Each commit on `feat/damage-calc-tool` in Stage 4 is `test: red — damage-calc <slice>`.

---

## 14. Out of scope (re-stated from flow §2.7)

- Speed benchmarks (separate tool, separate flow doc).
- Caching.
- Multi-target / spread move damage reduction beyond what `@smogon/calc` handles natively.
- UI rendering.
- Anthropic SDK agent loop integration (definition exported, but live wiring is later).
- `team_validate` / restricted slot legality (per flow Q8).

---

## 15. Decisions made where flow / CLAUDE.md were silent

1. Engine version capture: read from `@smogon/calc/package.json` at module load via `createRequire`.
2. `source.computed_at` excluded from determinism equality (timestamp varies by construction).
3. CLI exit codes: `0/1/2/3/64`.
4. Pretty CLI output: 6-line layout above.
5. Tool definition `description` text drafted explicitly with Reg M-A wording.
6. JSON Schema generator target: `openApi3` mode (safest subset for Anthropic).
7. Status-move handling: runtime check after zod parse (requires move category lookup).
8. `hpPercent` derivation: `round(maxHP * hpPercent / 100)` (rounding rule pinned by Stage 4 first cross-check).
9. Fixture target 28 (floor 20 per CLAUDE.md §4) — headroom for re-verification slippage.
10. Strict-mode zod everywhere with explicit `forbidIllegalKeys` helper for user-meaningful messages.

---

## 16. Items for user confirmation before Stage 4

1. **Tera Blast handling.** Reg M-A presumably bans Tera Blast since there is no Tera. Confirm: ban at calc-tool schema level (move name allow/deny list) or allow as Normal-type with description sanitized? Plan currently allows it but no fixture uses it.
  Answer: Ban at schema level (deny list) — simpler and more future-proof against any Tera Blast changes. If we later want to allow it, we can add an explicit `isTeraBlast` boolean to the `MoveSpec` and handle it in mapping/description.
2. **`@smogon/calc` exact version.** OK to pin whatever Stage 5 picks (latest stable at scaffold time), or specify now?
  Answer: Pin to exact version — golden fixtures depend on deterministic behavior.
3. **Fixture count target: 28.** OK?
  Answer: OK — provides good coverage across mechanics while being manageable for manual verification.
4. **CLI fixture lookup directory.** Resolves `<fixture-id>` against `fixtures/calcs/<id>.json` from `process.cwd()`. OK, or want an env var override (`CALCS_DIR`)?
  Answer: OK as-is — straightforward and consistent with repo structure.
5. **`hpPercent` rounding rule** (`round` vs `floor`). Pin in Stage 4 by whichever matches Showdown UI on the first cross-checked fixture — OK?
  Answer: OK — we'll confirm the rounding rule by matching Showdown's output on the first fixture, and pin it in tests to prevent regressions.
