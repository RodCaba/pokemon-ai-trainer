import { z } from "zod";
import { toID } from "@smogon/calc";
import { SampleSetSchema, type SampleSet } from "../schemas/sampleSet";

// Smogon's `champions.js` uses abbreviated SPS keys. Map them to our domain's
// full names so downstream code never has to think about the upstream encoding.
const SPS_KEY_MAP = {
  hp: "hp",
  at: "atk",
  df: "def",
  sa: "spa",
  sd: "spd",
  sp: "spe",
} as const;

type ShortSpsKey = keyof typeof SPS_KEY_MAP;

function expandSps(raw: Record<string, number>): {
  hp: number; atk: number; def: number; spa: number; spd: number; spe: number;
} {
  const out = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  for (const [shortKey, value] of Object.entries(raw)) {
    if (!(shortKey in SPS_KEY_MAP)) {
      throw new z.ZodError([{
        code: z.ZodIssueCode.custom,
        path: ["sps", shortKey],
        message: `unknown sps key '${shortKey}' — expected one of ${Object.keys(SPS_KEY_MAP).join(", ")}`,
      }]);
    }
    out[SPS_KEY_MAP[shortKey as ShortSpsKey]] = value;
  }
  return out;
}

/**
 * Raw shape of one entry in `SETDEX_CHAMPIONS[species][setName]` as published at
 * <https://calc.pokemonshowdown.com/js/data/sets/champions.js>.
 *
 * Smogon's set file uses `sps` (Stat Points) — the same Champions terminology our
 * domain uses. The fields below match the upstream JS object exactly.
 */
const RAW_SET_ALLOWED_KEYS = new Set([
  "ability",
  "item",
  "nature",
  "moves",
  "sps",
]);

// `.passthrough()` so the superRefine sees ALL keys (including the legacy `evs`).
// `.strict()` would short-circuit with a generic "Unrecognized key" message before
// our Champions-terminology message could fire — same gotcha pattern as
// `forbidIllegalKeys` in src/schemas/calc.ts.
const RawChampionsSetSchema = z
  .object({
    ability: z.string().min(1),
    item: z.string().min(1).nullable(),
    nature: z.string().min(1),
    moves: z.array(z.string().min(1)).length(4),
    sps: z.record(z.number().int()),
  })
  .passthrough()
  .superRefine((v, ctx) => {
    const obj = v as Record<string, unknown>;
    if ("evs" in obj || "ev" in obj) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "EVs are renamed to SPS (Stat Points) in Champions Reg M-A — use 'sps' instead",
        path: ["evs"],
      });
    }
    for (const k of Object.keys(obj)) {
      if (!RAW_SET_ALLOWED_KEYS.has(k) && k !== "evs" && k !== "ev") {
        ctx.addIssue({
          code: z.ZodIssueCode.unrecognized_keys,
          keys: [k],
          message: `Unrecognized key '${k}' in raw Champions set`,
        });
      }
    }
  });

export type RawChampionsSet = z.infer<typeof RawChampionsSetSchema>;

/**
 * The full `SETDEX_CHAMPIONS` shape: outer keys are species ids, inner keys are
 * set names, values are the raw set object.
 */
export const RawSetdexChampionsSchema = z.record(
  z.record(RawChampionsSetSchema),
);

export type RawSetdexChampions = z.infer<typeof RawSetdexChampionsSchema>;

/**
 * One parsed row ready to insert into `sample_sets`. `species_id` is split out for
 * the FK; the rest matches the validated `SampleSet` shape.
 */
export interface ParsedSampleSet {
  species_id: string;
  sample_set: SampleSet;
}

/**
 * One upstream entry the parser deliberately skipped (e.g., upstream cruft like
 * Ditto's "Transform-only" sets that have fewer than 4 moves). Returned alongside
 * the valid rows so the build pipeline can log a count.
 */
export interface SkippedSet {
  species_display_name: string;
  set_name: string;
  reason: string;
}

/**
 * Result of {@link parseChampionsSets}. Valid rows are in `rows`; upstream entries
 * we couldn't validate are summarized in `skipped` with a reason each.
 */
export interface ParseResult {
  rows: ParsedSampleSet[];
  skipped: SkippedSet[];
}

/**
 * Provenance attached to every parsed `SampleSet.source`. Caller supplies these
 * (typically the snapshot URL + the `fetched_at` from the snapshot frontmatter).
 */
export interface ParseSource {
  set_source: string;
  fetched_at: string;
}

/**
 * Parse a `SETDEX_CHAMPIONS` object into an array of validated `SampleSet` rows.
 *
 * **When to use it:** the build pipeline (`scripts/data/build-reg-m-a.ts`) calls this
 * to project Smogon's `champions.js` snapshot into `sample_sets` rows. Tests use it
 * to verify the SPS-vs-EVs terminology gate at the data boundary.
 *
 * **Translation contract:**
 * - `sps` field in the raw upstream → `sps` in our domain (1:1, byte-for-byte).
 *   Champions and our domain share the SPS terminology, so there's NO numeric
 *   transformation here. This is the `sps → sps` identity.
 * - The legacy `evs` key, if it ever appears upstream, is rejected with the same
 *   Champions terminology message used by `SampleSetSchema` and `CalcInputSchema`.
 * - The downstream `sps → evs` translation (domain → engine API name) happens in
 *   `src/tools/damage-calc/mapping.ts` when constructing a `@smogon/calc` Pokemon.
 *
 * @param setdex — The raw `SETDEX_CHAMPIONS` object (parsed from `champions.js`).
 * @param source — Provenance for the resulting `SampleSet.source` fields.
 * @returns Array of `ParsedSampleSet` rows in stable iteration order:
 *   sorted by `species_id`, then by `set_name`.
 * @throws {z.ZodError} If any raw set fails schema validation (including the legacy
 *   `evs` key check).
 *
 * @example
 *   const rows = parseChampionsSets(SETDEX_CHAMPIONS, {
 *     set_source: "https://calc.pokemonshowdown.com/js/data/sets/champions.js",
 *     fetched_at: "2026-05-04T00:00:00Z",
 *   });
 *   rows[0]; // { species_id: "abomasnow", sample_set: { set_name, ability, ... sps, source } }
 */
export function parseChampionsSets(
  setdex: unknown,
  source: ParseSource,
): ParseResult {
  // Outer parse: structure-only (raw shape). We DO NOT use RawSetdexChampionsSchema
  // here because it would fail-fast on the first malformed inner set (e.g.,
  // Ditto's Transform-only sets) and abort the entire build. Instead we walk
  // the structure and validate each inner set individually, collecting skips.
  if (typeof setdex !== "object" || setdex === null) {
    throw new z.ZodError([{
      code: z.ZodIssueCode.custom,
      path: [],
      message: "setdex must be an object",
    }]);
  }
  const root = setdex as Record<string, Record<string, unknown>>;

  const rows: ParsedSampleSet[] = [];
  const skipped: SkippedSet[] = [];
  const displayNames = Object.keys(root).sort();
  const seen = new Set<string>();

  for (const displayName of displayNames) {
    const sets = root[displayName];
    if (!sets || typeof sets !== "object") continue;
    const speciesId = toID(displayName);
    if (seen.has(speciesId)) {
      throw new z.ZodError([{
        code: z.ZodIssueCode.custom,
        path: [displayName],
        message: `species key '${displayName}' collides with another after id normalization (id='${speciesId}')`,
      }]);
    }
    seen.add(speciesId);

    const setNames = Object.keys(sets).sort();
    for (const setName of setNames) {
      const raw = sets[setName];
      if (!raw) continue;
      // Legacy-key check FIRST — must fire before zod's required-field check on
      // `sps`, otherwise a payload with `evs` (and no `sps`) gets the unhelpful
      // "Required" message instead of our Champions-terminology one.
      if (typeof raw === "object" && raw !== null) {
        const rawObj = raw as Record<string, unknown>;
        if ("evs" in rawObj || "ev" in rawObj) {
          skipped.push({
            species_display_name: displayName,
            set_name: setName,
            reason:
              "EVs are renamed to SPS (Stat Points) in Champions Reg M-A — use 'sps' instead",
          });
          continue;
        }
      }
      const rawCheck = RawChampionsSetSchema.safeParse(raw);
      if (!rawCheck.success) {
        skipped.push({
          species_display_name: displayName,
          set_name: setName,
          reason: rawCheck.error.issues[0]?.message ?? "raw shape validation failed",
        });
        continue;
      }
      const validRaw = rawCheck.data;
      const candidate = {
        schema_version: 1 as const,
        set_name: setName,
        ability: validRaw.ability,
        item: validRaw.item,
        nature: validRaw.nature,
        moves: [...validRaw.moves],
        sps: expandSps(validRaw.sps),
        source: { ...source },
      };
      const setCheck = SampleSetSchema.safeParse(candidate);
      if (!setCheck.success) {
        skipped.push({
          species_display_name: displayName,
          set_name: setName,
          reason: setCheck.error.issues[0]?.message ?? "domain validation failed",
        });
        continue;
      }
      rows.push({ species_id: speciesId, sample_set: setCheck.data });
    }
  }

  return { rows, skipped };
}
