/**
 * Adapter: raw Pokepaste body string → `UserTeam` partial.
 *
 * Stage-4 stub. Stage 5 wires `transformPaste` from
 * `src/tools/pokepaste/transform.ts` per
 * `docs/plans/user-teams.md` §2.1.
 */

import type { Db } from "../../db/open";
import type { TransformDeps } from "../../tools/pokepaste/transform";
import type { UserTeam, ValidationError } from "../../schemas/user-teams";

/** Output of `parsePokepasteToTeam`. */
export interface ParsePokepasteResult {
  /** A non-persisted UserTeam draft — id minted later by the repo. */
  team: Omit<UserTeam, "id" | "created_at" | "updated_at" | "schema_version">;
  /** Free-form warnings the parser surfaced (e.g. dropped tera lines). */
  raw_warnings: string[];
  /** Structured `parse_failed` errors when text is malformed. Empty on clean parse. */
  parse_errors: ValidationError[];
}

/** Repository deps. */
export interface ParseDeps {
  db: Db;
  transform: TransformDeps;
}

/**
 * Parse a Pokepaste-format body into a draft `UserTeam`.
 *
 * **When to use it:** the `from-paste` CLI subcommand and the future
 * "create from paste" UI. Auto-persist contract: malformed text returns
 * a partial team plus structured `parse_errors`, never throws.
 *
 * @param text — The raw Showdown-format export.
 * @param deps — DB + transform deps.
 * @returns `{ team, raw_warnings, parse_errors }`.
 * @throws Never on user-input issues; `RosterDbError` only on DB failure.
 *
 * @example
 *   const r = parsePokepasteToTeam(rawText, { db, transform: deps });
 *   if (r.parse_errors.length === 0) saveDraft(r.team);
 */
export function parsePokepasteToTeam(
  _text: string,
  _deps: ParseDeps,
): ParsePokepasteResult {
  throw new Error(
    "not implemented (Stage 5): src/data/user-teams/parse-pokepaste.ts::parsePokepasteToTeam",
  );
}
