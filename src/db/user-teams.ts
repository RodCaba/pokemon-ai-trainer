/**
 * Bespoke repo for the user-teams slice. Cannot use `createSimpleRepo`
 * per `docs/plans/user-teams.md` §6 (multi-table joins, composite-key
 * upsert, validator gating, revision retention).
 *
 * Stage-4 stub: every export throws "not implemented (Stage 5)" so tests
 * import cleanly and fail on behavior, not module resolution.
 */

import type { Db } from "./open";
import type {
  UserTeam,
  UserTeamCreateArgs,
  UserTeamFilter,
  UserTeamRevisionMeta,
  UserTeamSetUpsertPatch,
  UserTeamStatus,
  UserTeamUpdatePatch,
} from "../schemas/user-teams";
import type { ValidateDeps } from "../data/team-validate";

/**
 * Mint a new `UserTeam` (id is a fresh ulid; status starts `'draft'`;
 * auto-name unless `args.name` provided).
 *
 * **When to use it:** every entry point that creates a team — paste,
 * builder, duplicate-from-tournament, AI-prompt (future Slice 4).
 *
 * @param db — Open Drizzle DB handle.
 * @param args — Origin metadata; optional initial sets.
 * @returns The freshly-persisted `UserTeam`.
 * @throws {RosterDbError} On SQLite I/O failure.
 */
export function create(_db: Db, _args: UserTeamCreateArgs): UserTeam {
  throw new Error("not implemented (Stage 5): src/db/user-teams.ts::create");
}

/**
 * Read a full team + sets by id.
 *
 * @returns The `UserTeam`, or `null` if no row matches.
 * @throws {RosterDbError} On SQLite I/O failure.
 * @throws {RosterDataError} On corrupt persisted JSON.
 */
export function get(_db: Db, _id: string): UserTeam | null {
  throw new Error("not implemented (Stage 5): src/db/user-teams.ts::get");
}

/**
 * List teams matching the filter, ordered by `updated_at DESC`.
 *
 * @returns Array of `UserTeam`, possibly empty.
 * @throws {RosterDbError} On SQLite I/O failure.
 */
export function list(_db: Db, _filter: UserTeamFilter): UserTeam[] {
  throw new Error("not implemented (Stage 5): src/db/user-teams.ts::list");
}

/**
 * Patch top-level fields. Triggers a revision iff status was already
 * `'saved'` (drafts don't burn revision slots).
 *
 * @throws {UserTeamNotFoundError} If the id doesn't exist.
 * @throws {RosterDbError} On SQLite I/O failure.
 */
export function update(_db: Db, _id: string, _patch: UserTeamUpdatePatch): UserTeam {
  throw new Error("not implemented (Stage 5): src/db/user-teams.ts::update");
}

/**
 * Auto-persist surface: composite-key write to one slot. Never triggers
 * a revision (Stage-2 Q4: `checkpoint` is the explicit revision call).
 *
 * @throws {UserTeamNotFoundError} If the team doesn't exist.
 * @throws {RosterDbError} On SQLite I/O failure.
 */
export function upsertSet(
  _db: Db,
  _id: string,
  _slot: number,
  _patch: UserTeamSetUpsertPatch,
): void {
  throw new Error("not implemented (Stage 5): src/db/user-teams.ts::upsertSet");
}

/**
 * Status transition. Gates `'saved'` on `validateTeam(...).errors === []`
 * (warnings allowed). Creates a revision on entry to `'saved'`.
 *
 * @throws {UserTeamValidationError} On `'saved'` with errors.
 * @throws {UserTeamNotFoundError} On unknown id.
 * @throws {RosterDbError} On SQLite I/O failure.
 */
export function setStatus(
  _db: Db,
  _id: string,
  _status: UserTeamStatus,
  _deps: ValidateDeps,
): UserTeam {
  throw new Error("not implemented (Stage 5): src/db/user-teams.ts::setStatus");
}

/**
 * Hard delete. CASCADE removes `user_team_sets` and `user_team_revisions`.
 *
 * @throws {RosterDbError} On SQLite I/O failure.
 */
export function deleteTeam(_db: Db, _id: string): void {
  throw new Error("not implemented (Stage 5): src/db/user-teams.ts::deleteTeam");
}

/**
 * Metadata for the team's revisions, newest first. Up to 5 entries.
 *
 * @throws {RosterDbError} On SQLite I/O failure.
 */
export function listRevisions(_db: Db, _id: string): UserTeamRevisionMeta[] {
  throw new Error(
    "not implemented (Stage 5): src/db/user-teams.ts::listRevisions",
  );
}

/**
 * Restore a snapshot over the current state. Status drops to `'draft'`.
 * Does NOT create a revision (prevents recursive eviction).
 *
 * @throws {UserTeamRevisionNotFoundError} On bad `(id, n)`.
 * @throws {RosterDbError} On SQLite I/O failure.
 */
export function restoreRevision(
  _db: Db,
  _id: string,
  _revisionNumber: number,
): UserTeam {
  throw new Error(
    "not implemented (Stage 5): src/db/user-teams.ts::restoreRevision",
  );
}

/**
 * Manual checkpoint — create a revision on demand from any status (Stage-2 Q4).
 *
 * **When to use it:** the user wants to "save a checkpoint" mid-edit
 * without changing status. Subject to the same 5-slot retention as
 * automatic revisions (oldest evicted on the 6th).
 *
 * @param label — Optional human-facing label for the checkpoint.
 * @returns The freshly-recorded revision metadata.
 * @throws {UserTeamNotFoundError} On unknown id.
 * @throws {RosterDbError} On SQLite I/O failure.
 *
 * @example
 *   const meta = checkpoint(db, teamId, "before splitting Garchomp's spread");
 */
export function checkpoint(
  _db: Db,
  _id: string,
  _label?: string,
): UserTeamRevisionMeta {
  throw new Error(
    "not implemented (Stage 5): src/db/user-teams.ts::checkpoint",
  );
}
