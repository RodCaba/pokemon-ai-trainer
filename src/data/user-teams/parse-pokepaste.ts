/**
 * Adapter: raw Pokepaste body string → `UserTeam` partial.
 *
 * **Why not call `transformPaste` from `src/tools/pokepaste/transform.ts`?**
 * `transformPaste` is the labmaus ingest path — its contract is
 * **reject-and-fail**: any unknown species/item/ability/move throws.
 * That's correct for labmaus (we expect tournament data to be valid) but
 * incompatible with the user-teams flow §2.1 step 6 *auto-persist*
 * contract: malformed paste must NOT throw — it must persist as a draft
 * with structured `parse_errors` so the user can edit and re-validate.
 * The two consumers therefore share what's truly common
 * ({@link normalizeSpeciesName} for the Mega-prefix rewrite) and each
 * keeps its own ~10-LOC structural plumbing around `Teams.importTeam`.
 *
 * Validation against the ref tables is `validateTeam`'s job, not this
 * adapter's. The adapter only structures the input.
 */

import { Teams } from "@pkmn/sets";
import type { PokemonSet } from "@pkmn/sets";
import type { Db } from "../../db/open";
import type { TransformDeps } from "../../tools/pokepaste/transform";
import { normalizeSpeciesName } from "../../tools/pokepaste/transform";
import type {
  UserSet,
  UserTeam,
  ValidationError,
} from "../../schemas/user-teams";

/** Output of `parsePokepasteToTeam`. */
export interface ParsePokepasteResult {
  /** A non-persisted UserTeam draft — id minted later by the repo. */
  team: Omit<UserTeam, "id" | "created_at" | "updated_at" | "schema_version">;
  /** Free-form warnings the parser surfaced. */
  raw_warnings: string[];
  /** Structured `parse_failed` errors when text is malformed. Empty on clean parse. */
  parse_errors: ValidationError[];
}

/** Repository deps. `transform` is optional and unused today — retained as
 * an opt-in seam for callers that may want to hand the same deps shape to
 * both this adapter and `transformPaste`. The adapter itself does not read
 * it (validation is the validator's job). */
export interface ParseDeps {
  db: Db;
  transform?: TransformDeps;
}

/** Build an empty `UserSet` for one slot. */
function emptySet(slot: number): UserSet {
  return {
    slot,
    species_id: null,
    nickname: null,
    item_id: null,
    ability_id: null,
    nature: null,
    hp_sps: 0,
    atk_sps: 0,
    def_sps: 0,
    spa_sps: 0,
    spd_sps: 0,
    spe_sps: 0,
    move_1_id: null,
    move_2_id: null,
    move_3_id: null,
    move_4_id: null,
    notes: null,
  };
}

/** Trimmed-non-empty narrowing helper. */
function nonEmpty(s: string | undefined | null): s is string {
  return typeof s === "string" && s.trim().length > 0;
}

/**
 * Map a `@pkmn/sets` `PokemonSet` into a `UserSet`. Drops `level` (Reg M-A
 * is L50; Stage-2 Q9). Strips `teraType` defensively.
 */
function pokemonSetToUserSet(
  slot: number,
  raw: Partial<PokemonSet>,
): UserSet {
  // Defensive Tera strip — schema rejects tera_* but we don't even let it
  // touch the set we hand back.
  if ("teraType" in raw) {
    delete (raw as unknown as Record<string, unknown>).teraType;
  }

  const speciesDisplay = normalizeSpeciesName(
    (raw.species ?? "").replace(/[♂♀]/g, "").trim(),
  );
  // Canonicalize to lowercase Showdown-style id so it matches the
  // `species_id` schema (`/^[a-z0-9-]+$/`). Validation against the
  // roster table happens later via `validateTeam`.
  const species = speciesDisplay.toLowerCase().replace(/[^a-z0-9-]/g, "");
  const item = nonEmpty(raw.item) ? raw.item : null;
  const ability = nonEmpty(raw.ability) ? raw.ability : null;
  const nature = nonEmpty(raw.nature) ? raw.nature : null;
  const moves = Array.isArray(raw.moves)
    ? raw.moves.filter((m): m is string => nonEmpty(m))
    : [];
  // `evs` from `@pkmn/sets` -> `sps` in Champions domain.
  const evs = raw.evs;

  // TODO(stage6-deferred): resurface `level` on UserSet if non-50
  // hypothetical play matters in a future slice (plan §18 row 6).

  return {
    slot,
    species_id: species.length > 0 ? species : null,
    nickname: null,
    item_id: item,
    ability_id: ability,
    nature,
    hp_sps: evs?.hp ?? 0,
    atk_sps: evs?.atk ?? 0,
    def_sps: evs?.def ?? 0,
    spa_sps: evs?.spa ?? 0,
    spd_sps: evs?.spd ?? 0,
    spe_sps: evs?.spe ?? 0,
    move_1_id: moves[0] ?? null,
    move_2_id: moves[1] ?? null,
    move_3_id: moves[2] ?? null,
    move_4_id: moves[3] ?? null,
    notes: null,
  };
}

/**
 * Parse a Pokepaste-format body into a draft `UserTeam`.
 *
 * **When to use it:** the `from-paste` CLI subcommand and the future
 * "create from paste" UI. Auto-persist contract: malformed text returns
 * a partial team plus structured `parse_errors`, never throws. Unknown
 * species / items / abilities are NOT rejected here — the user-teams
 * validator surfaces them as structured errors at save time.
 *
 * @param text — The raw Showdown-format export.
 * @param deps — DB + transform deps. The transform deps are retained for
 *   API parity with the labmaus ingest path; this adapter doesn't use
 *   them for ref-table validation.
 * @returns `{ team, raw_warnings, parse_errors }`. `team` always has six
 *   slots (empty placeholders fill missing ones). `origin` is `"paste"`
 *   and `origin_payload` carries `text` verbatim.
 * @throws Never on user-input issues; `RosterDbError` only on DB failure.
 *
 * @example
 *   const r = parsePokepasteToTeam(rawText, { db, transform: deps });
 *   if (r.parse_errors.length === 0) saveDraft(r.team);
 */
export function parsePokepasteToTeam(
  text: string,
  deps: ParseDeps,
): ParsePokepasteResult {
  void deps;
  const raw_warnings: string[] = [];
  const parse_errors: ValidationError[] = [];
  const sets: UserSet[] = [];

  let parsed: ReturnType<typeof Teams.importTeam> = undefined;
  try {
    parsed = Teams.importTeam(text);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    parse_errors.push({
      code: "parse_failed",
      message: `pokepaste parse failed: ${message}`,
      slot: null,
    });
    raw_warnings.push(message);
  }

  if (parsed && Array.isArray(parsed.team) && parsed.team.length > 0) {
    for (let i = 0; i < parsed.team.length && i < 6; i++) {
      const set = parsed.team[i] as Partial<PokemonSet> | undefined;
      if (!set) continue;
      try {
        sets.push(pokemonSetToUserSet(i, set));
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        raw_warnings.push(`slot ${i}: ${message}`);
      }
    }
  } else if (parse_errors.length === 0) {
    // No exception, but `@pkmn/sets` returned no team — treat as malformed.
    parse_errors.push({
      code: "parse_failed",
      message: "pokepaste parse failed: empty team",
      slot: null,
    });
  }

  // Pad to six slots, re-keying so `slot` is 0..5 in order.
  for (let s = sets.length; s < 6; s++) {
    sets.push(emptySet(s));
  }
  const padded = sets.slice(0, 6).map((set, i) => ({ ...set, slot: i }));

  const team: ParsePokepasteResult["team"] = {
    name: "Untitled team",
    description: null,
    win_condition: null,
    status: "draft",
    origin: "paste",
    origin_payload: text,
    source_tournament_team_id: null,
    validation_errors: parse_errors,
    validation_warnings: [],
    sets: padded as UserTeam["sets"],
  };

  return { team, raw_warnings, parse_errors };
}
