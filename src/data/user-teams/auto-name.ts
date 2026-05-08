/**
 * Auto-generated team-name algorithm. See
 * `docs/plans/user-teams.md` §5.
 *
 * Stage-4 stub.
 */

import type { Db } from "../../db/open";
import type { UserTeam } from "../../schemas/user-teams";

/**
 * Generate a deterministic display name from a team's species list.
 *
 * **When to use it:** the repo `create` path when no `name` is supplied.
 * Algorithm: join first 4 species display names with `-`; suffix
 * ` + ${remaining}` if 5–6; date-prefix on collision regardless of
 * archived status (Stage-2 Q6); empty teams → `"Untitled team"` (Q7).
 *
 * @param team — Pick<UserTeam, "sets"> — only the sets matter.
 * @param db — Open DB handle (used to detect name collisions).
 * @param today — Optional injectable `() => "YYYY-MM-DD"` for tests.
 * @returns The generated display name.
 * @throws {RosterDbError} On SQLite I/O failure.
 *
 * @example
 *   autoGenerateName({ sets: [...] }, db); // "Sneasler-Garchomp-Clefable-Charizard-Mega-Y + 2"
 */
export function autoGenerateName(
  _team: Pick<UserTeam, "sets">,
  _db: Db,
  _today?: () => string,
): string {
  throw new Error(
    "not implemented (Stage 5): src/data/user-teams/auto-name.ts::autoGenerateName",
  );
}
