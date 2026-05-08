/**
 * Auto-generated team-name algorithm. See
 * `docs/plans/user-teams.md` §5 + Stage-2 Q6 / Q7.
 *
 * - empty team             → `"Untitled team"`
 * - 1..4 species           → `"<Display1>-<Display2>...".`
 * - 5..6 species           → `"<D1>-<D2>-<D3>-<D4> + <count>"`
 * - existing collision     → `"<YYYY-MM-DD> <name>"` regardless of archived status (Q6)
 */

import type { Db } from "../../db/open";
import { RosterDbError } from "../../schemas/errors";
import type { UserTeam } from "../../schemas/user-teams";

/**
 * Today as ISO `YYYY-MM-DD` (UTC). Used as the default `today` arg.
 */
function defaultToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Generate a deterministic display name from a team's species list.
 *
 * **When to use it:** the repo `create` path when no `name` is supplied.
 * Algorithm: join first 4 species display names with `-`; suffix
 * ` + ${remaining}` if 5–6; date-prefix on collision regardless of
 * archived status (Stage-2 Q6); empty teams → `"Untitled team"` (Q7).
 *
 * @param team — `Pick<UserTeam, "sets">` — only the sets matter.
 * @param db — Open DB handle (used to read display names + detect collisions).
 * @param today — Optional injectable `() => "YYYY-MM-DD"` for tests.
 * @returns The generated display name.
 * @throws {RosterDbError} On SQLite I/O failure.
 *
 * @example
 *   autoGenerateName({ sets: [...] }, db); // "Sneasler-Garchomp-Clefable-Aerodactyl + 2"
 */
export function autoGenerateName(
  team: Pick<UserTeam, "sets">,
  db: Db,
  today: () => string = defaultToday,
): string {
  const speciesIds = team.sets
    .filter((s) => s.species_id !== null && s.species_id !== undefined)
    .map((s) => s.species_id as string);

  let baseName: string;
  if (speciesIds.length === 0) {
    baseName = "Untitled team";
  } else {
    const displayNames: string[] = [];
    let stmt: ReturnType<typeof db.$client.prepare>;
    try {
      stmt = db.$client.prepare("SELECT display_name FROM species WHERE id = ?");
    } catch (e) {
      throw new RosterDbError("failed to prepare species lookup", { cause: e });
    }
    for (const id of speciesIds) {
      try {
        const row = stmt.get(id) as { display_name?: string } | undefined;
        displayNames.push(row?.display_name ?? id);
      } catch (e) {
        throw new RosterDbError(`failed to read species ${id}`, {
          cause: e,
          query: id,
        });
      }
    }
    const head = displayNames.slice(0, 4).join("-");
    const remaining = displayNames.length - 4;
    baseName = remaining > 0 ? `${head} + ${remaining}` : head;
  }

  // Collision check — Q6: scan all rows regardless of status. Single user;
  // any name match is a collision.
  let exists = false;
  try {
    const row = db.$client
      .prepare("SELECT 1 AS x FROM user_teams WHERE name = ? LIMIT 1")
      .get(baseName) as { x?: number } | undefined;
    exists = !!row;
  } catch (e) {
    throw new RosterDbError("failed to check name collision", { cause: e });
  }
  if (exists) {
    return `${today()} ${baseName}`;
  }
  return baseName;
}
