import { z } from "zod";
import { SpsSpreadSchema } from "./sps";

// Reg M-A bans encoded at the schema layer (see CLAUDE.md §4 + memories):
//   - no IVs (mapping layer always uses 31s)
//   - no Tera anything
//   - no Tera Blast (per Stage 3 plan §16 Q1)
const FORBIDDEN_KEYS = [
  "ivs",
  "iv",
  "teraType",
  "tera_type",
  "teraActive",
  "tera",
  "evs",
  "ev",
] as const;

const MOVE_DENYLIST = ["Tera Blast"] as const;

function illegalKeyMessage(key: string): string {
  if (key.startsWith("iv")) return "IVs are not configurable in Reg M-A";
  if (key.startsWith("ev")) return "EVs are renamed to SPS (Stat Points) in Champions Reg M-A — use 'sps' instead";
  return "Tera is not legal in Reg M-A";
}

function forbidIllegalKeys<T extends z.ZodRawShape>(s: z.ZodObject<T>) {
  // Use .passthrough() so superRefine sees ALL keys (including forbidden + unknown).
  // .strict() would short-circuit with a generic "Unrecognized key" message before
  // our Reg M-A-specific message could fire. We re-implement the strict check
  // manually below so unknown extras still fail, just after the friendly check.
  const allowedKeys = new Set(Object.keys(s.shape));
  return s.passthrough().superRefine((val, ctx) => {
    const obj = val as Record<string, unknown>;
    const forbiddenSet = new Set<string>(FORBIDDEN_KEYS);
    for (const k of FORBIDDEN_KEYS) {
      if (k in obj) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: illegalKeyMessage(k),
          path: [k],
        });
      }
    }
    for (const k of Object.keys(obj)) {
      if (!allowedKeys.has(k) && !forbiddenSet.has(k)) {
        ctx.addIssue({
          code: z.ZodIssueCode.unrecognized_keys,
          keys: [k],
          message: `Unrecognized key(s) in object: '${k}'`,
        });
      }
    }
  });
}

export const NatureSchema = z.enum([
  "Hardy", "Lonely", "Brave", "Adamant", "Naughty",
  "Bold", "Docile", "Relaxed", "Impish", "Lax",
  "Timid", "Hasty", "Serious", "Jolly", "Naive",
  "Modest", "Mild", "Quiet", "Bashful", "Rash",
  "Calm", "Gentle", "Sassy", "Careful", "Quirky",
]);

export const StatusSchema = z.enum([
  "Healthy", "Burned", "Paralyzed", "Poisoned", "Badly Poisoned", "Asleep", "Frozen",
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
  sps: SpsSpreadSchema,
  moves: z.array(z.string().min(1)).length(4),
  statBoosts: StatBoostsSchema,
  status: StatusSchema,
  hpPercent: z.number().min(0).max(100),
  /**
   * Mega-evolution control. Default behavior (`no_mega` undefined or `false`):
   * if `item` is a Mega Stone whose `megaStone` map contains `species`, the
   * mapping layer auto-swaps to the corresponding `<species>-Mega` form (and
   * uses the Mega's slot-0 ability). Set `no_mega: true` to keep the base
   * species — useful when the team carries two Mega-eligible Pokemon and only
   * one Mega-evolves per battle (the other still holds its Mega Stone but
   * fights in base form for that turn).
   */
  no_mega: z.boolean().default(false),
}));

export const MoveSpecSchema = forbidIllegalKeys(
  z.object({
    name: z.string().min(1).refine(
      (n) => !MOVE_DENYLIST.includes(n as (typeof MOVE_DENYLIST)[number]),
      { message: "Tera Blast is not legal in Reg M-A" },
    ),
    isCrit: z.boolean().default(false),
    hits: z.number().int().min(1).max(10).optional(),
  }),
);

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
  "None", "Sun", "Harsh Sunshine", "Rain", "Heavy Rain", "Sand", "Snow", "Hail",
]);

export const TerrainSchema = z.enum([
  "None", "Electric", "Grassy", "Misty", "Psychic",
]);

/**
 * Game type for spread-move damage calculation. Champions is VGC (doubles), so
 * defaults to `"Doubles"` — spread moves like Earthquake/Rock Slide get the
 * 0.75× multi-target reduction. Single-target moves (Crunch, etc.) are unaffected.
 */
export const GameTypeSchema = z.enum(["Singles", "Doubles"]).default("Doubles");

export const FieldSchema = forbidIllegalKeys(z.object({
  gameType: GameTypeSchema,
  weather: WeatherSchema,
  terrain: TerrainSchema,
  isGravity: z.boolean().default(false),
  isMagicRoom: z.boolean().default(false),
  isWonderRoom: z.boolean().default(false),
  isTrickRoom: z.boolean().default(false),
  attackerSide: SideConditionsSchema,
  defenderSide: SideConditionsSchema,
}));

/**
 * The runtime contract for a `damage_calc` input. Encodes every Reg M-A invariant.
 *
 * **When to use it:** validate any payload at a trust boundary (CLI loading JSON,
 * agent tool dispatcher, network handler) before passing to `damage_calc`. In-process
 * TypeScript callers that build `CalcInput` literals get type checking for free; the
 * schema still runs inside `damage_calc` for runtime safety.
 *
 * Rejects: `ivs`, `tera*`, `evs` keys at any level (Champions uses SPS, not EVs);
 * SPS total > 66; per-stat SPS > 32; non-integer or negative SPS; unknown
 * nature/status/weather/terrain enums; level !== 50; gen !== 9; format !== "RegM-A";
 * move name === "Tera Blast".
 */
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

/**
 * The runtime contract for a `damage_calc` output. Self-validated before return.
 *
 * **When to use it:** parse any persisted or transported `CalcResult` (e.g., loaded from a
 * golden fixture, received over the wire). `damage_calc` already runs this on its own
 * output, so direct callers of `damage_calc` rarely need it.
 *
 * Asserts: `rolls.length === 16`, `min_percent <= max_percent`, `description` does not
 * contain "Tera", `ko_chance.chance` in `[0, 1]`, `source` carries tool/version/computed_at.
 */
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
export type MoveSpec = z.infer<typeof MoveSpecSchema>;
export type PokemonSpec = z.infer<typeof PokemonSpecSchema>;
