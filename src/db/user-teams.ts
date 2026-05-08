/**
 * Bespoke repo for the user-teams slice. Cannot use `createSimpleRepo`
 * per `docs/plans/user-teams.md` §6 (multi-table joins, composite-key
 * upsert, validator gating, revision retention).
 *
 * Behaviour summary:
 *   - `create` mints a ulid, auto-names if needed, inserts user_teams +
 *     6 user_team_sets rows in a single transaction.
 *   - `upsertSet` is the auto-persist surface; never creates a revision.
 *   - `setStatus('saved')` runs `validateTeam` and creates a revision
 *     on entry to 'saved' (warnings allowed; errors throw).
 *   - `update` creates a revision iff the team is currently 'saved'.
 *   - `checkpoint` is the explicit "manual save point" affordance —
 *     creates a revision in any status (Stage-2 Q4).
 *   - `restoreRevision` overwrites state from a snapshot, drops to
 *     'draft', does not create a revision.
 *   - 5-revision retention: oldest evicted on the 6th save.
 */

import type { Db } from "./open";
import {
  RosterDataError,
  RosterDbError,
  UserTeamNotFoundError,
  UserTeamRevisionNotFoundError,
  UserTeamValidationError,
} from "../schemas/errors";
import {
  UserTeamCreateArgsSchema,
  UserTeamRowSchema,
  UserTeamSchema,
  type UserTeam,
  type UserTeamCreateArgs,
  type UserTeamFilter,
  type UserTeamRevisionMeta,
  type UserTeamSetUpsertPatch,
  type UserTeamStatus,
  type UserTeamUpdatePatch,
  type UserSet,
  type ValidationError,
  type ValidationResult,
  type ValidationWarning,
} from "../schemas/user-teams";
import { ulid } from "./ulid";
import { autoGenerateName } from "../data/user-teams/auto-name";
import { validateTeam, type ValidateDeps } from "../data/team-validate";

interface UserTeamRowDb {
  id: string;
  name: string;
  description: string | null;
  win_condition: string | null;
  status: UserTeamStatus;
  origin: UserTeam["origin"];
  origin_payload: string | null;
  source_tournament_team_id: string | null;
  validation_errors: string;
  validation_warnings: string;
  schema_version: number;
  created_at: string;
  updated_at: string;
}

interface UserTeamSetRowDb {
  user_team_id: string;
  slot: number;
  species_id: string | null;
  nickname: string | null;
  item_id: string | null;
  ability_id: string | null;
  nature: string | null;
  hp_sps: number;
  atk_sps: number;
  def_sps: number;
  spa_sps: number;
  spd_sps: number;
  spe_sps: number;
  move_1_id: string | null;
  move_2_id: string | null;
  move_3_id: string | null;
  move_4_id: string | null;
  notes: string | null;
}

const ISO_NOW = (): string =>
  new Date().toISOString().replace(/\.\d+Z$/, "Z");

function emptyUserSet(slot: number): UserSet {
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

function rowToTeam(
  row: UserTeamRowDb,
  setRows: UserTeamSetRowDb[],
): UserTeam {
  // Trust-boundary validation per CLAUDE.md §10: SELECT * results pass
  // through `UserTeamRowSchema.parse` so corrupt rows surface as a
  // RosterDataError instead of propagating mistyped values to callers.
  const parsed = UserTeamRowSchema.safeParse(row);
  if (!parsed.success) {
    throw new RosterDataError(
      `corrupt user_team row ${typeof row === "object" && row !== null && "id" in row ? String((row as { id: unknown }).id) : "<unknown>"}`,
      { cause: parsed.error, query: typeof row === "object" && row !== null && "id" in row ? String((row as { id: unknown }).id) : undefined },
    );
  }
  const valid = parsed.data;
  let validationErrors: ValidationError[];
  let validationWarnings: ValidationWarning[];
  try {
    validationErrors = JSON.parse(valid.validation_errors) as ValidationError[];
    validationWarnings = JSON.parse(
      valid.validation_warnings,
    ) as ValidationWarning[];
  } catch (e) {
    throw new RosterDataError(
      `corrupt validation JSON for user_team ${valid.id}`,
      { cause: e, query: valid.id },
    );
  }
  const sets: UserSet[] = [];
  for (let s = 0; s < 6; s++) sets.push(emptyUserSet(s));
  for (const r of setRows) {
    if (r.slot < 0 || r.slot > 5) continue;
    sets[r.slot] = {
      slot: r.slot,
      species_id: r.species_id,
      nickname: r.nickname,
      item_id: r.item_id,
      ability_id: r.ability_id,
      nature: r.nature,
      hp_sps: r.hp_sps,
      atk_sps: r.atk_sps,
      def_sps: r.def_sps,
      spa_sps: r.spa_sps,
      spd_sps: r.spd_sps,
      spe_sps: r.spe_sps,
      move_1_id: r.move_1_id,
      move_2_id: r.move_2_id,
      move_3_id: r.move_3_id,
      move_4_id: r.move_4_id,
      notes: r.notes,
    };
  }
  const candidate: UserTeam = {
    schema_version: 1,
    id: valid.id,
    name: valid.name,
    description: valid.description,
    win_condition: valid.win_condition,
    status: valid.status,
    origin: valid.origin,
    origin_payload: valid.origin_payload,
    source_tournament_team_id: valid.source_tournament_team_id,
    validation_errors: validationErrors,
    validation_warnings: validationWarnings,
    sets: sets as UserTeam["sets"],
    created_at: valid.created_at,
    updated_at: valid.updated_at,
  };
  // Validate via UserTeamSchema for honest round-trip integrity. Allow
  // schema slip on `validation_errors`/`validation_warnings` content
  // since those echo arbitrary user-domain codes.
  const parsedTeam = UserTeamSchema.safeParse(candidate);
  if (!parsedTeam.success) {
    throw new RosterDataError(`stored user_team ${valid.id} fails its schema`, {
      cause: parsedTeam.error,
      query: valid.id,
    });
  }
  return parsedTeam.data as UserTeam;
}

/** Insert a new revision row and evict the oldest when count > 5. */
function recordRevision(
  db: Db,
  teamId: string,
  snapshot: UserTeam,
  label: string | null,
): UserTeamRevisionMeta {
  const raw = db.$client;
  const next = raw
    .prepare(
      "SELECT COALESCE(MAX(revision_number), 0) + 1 AS n FROM user_team_revisions WHERE user_team_id = ?",
    )
    .get(teamId) as { n: number };
  const revisionNumber = next.n;
  const createdAt = ISO_NOW();
  // revision_number is a monotonic sequence per team — never recycled. The
  // 5-snapshot retention is enforced by deleting the oldest after insert
  // (see DELETE clause below), so the surviving numbers form a contiguous
  // suffix (e.g. 2..6 after the 6th save). The migration's CHECK is
  // `revision_number >= 1` — no upper bound — which matches this.
  const insert = raw.prepare(
    `INSERT INTO user_team_revisions (user_team_id, revision_number, label, snapshot_json, created_at)
       VALUES (?, ?, ?, ?, ?)`,
  );
  insert.run(
    teamId,
    revisionNumber,
    label,
    JSON.stringify(snapshot),
    createdAt,
  );
  // Eviction: keep at most 5 by largest revision_number.
  const all = raw
    .prepare(
      "SELECT revision_number FROM user_team_revisions WHERE user_team_id = ? ORDER BY revision_number ASC",
    )
    .all(teamId) as Array<{ revision_number: number }>;
  if (all.length > 5) {
    const toRemove = all.length - 5;
    const oldest = all.slice(0, toRemove).map((r) => r.revision_number);
    const placeholders = oldest.map(() => "?").join(", ");
    raw
      .prepare(
        `DELETE FROM user_team_revisions WHERE user_team_id = ? AND revision_number IN (${placeholders})`,
      )
      .run(teamId, ...oldest);
  }
  return { user_team_id: teamId, revision_number: revisionNumber, created_at: createdAt };
}

/** Read one team + its set rows. Returns `null` on miss. */
function readTeam(db: Db, id: string): UserTeam | null {
  const row = db.$client
    .prepare("SELECT * FROM user_teams WHERE id = ?")
    .get(id) as UserTeamRowDb | undefined;
  if (!row) return null;
  const setRows = db.$client
    .prepare(
      "SELECT * FROM user_team_sets WHERE user_team_id = ? ORDER BY slot",
    )
    .all(id) as UserTeamSetRowDb[];
  return rowToTeam(row, setRows);
}

/**
 * Mint a new `UserTeam` (id is a fresh ulid; status starts `'draft'`;
 * auto-name unless `args.name` provided).
 *
 * **When to use it:** every entry point that creates a team — paste,
 * builder, duplicate-from-tournament, AI-prompt (future Slice 4).
 *
 * @param db — Open Drizzle DB handle.
 * @param args — Origin metadata; optional initial sets.
 * @returns The freshly-persisted `UserTeam` (six slots; status='draft').
 * @throws {z.ZodError} If `args` fails `UserTeamCreateArgsSchema`.
 * @throws {RosterDataError} If the freshly-read row fails round-trip
 *   schema validation (programmer-bug-grade corruption).
 * @throws {RosterDbError} On SQLite I/O failure (incl. `name` unique-index
 *   collision when `args.name` is provided and already exists).
 *
 * @example
 *   const t = create(db, { origin: "builder", name: "my team" });
 */
export function create(db: Db, args: UserTeamCreateArgs): UserTeam {
  const parsed = UserTeamCreateArgsSchema.parse(args);
  const id = ulid();
  const createdAt = ISO_NOW();

  // Build the initial sets array (overlay provided sets onto empties).
  const sets: UserSet[] = [];
  for (let s = 0; s < 6; s++) sets.push(emptyUserSet(s));
  for (const provided of parsed.sets) {
    if (provided.slot >= 0 && provided.slot <= 5) {
      sets[provided.slot] = provided;
    }
  }
  const name =
    parsed.name ?? autoGenerateName({ sets: sets as UserTeam["sets"] }, db);

  try {
    const tx = db.$client.transaction(() => {
      db.$client
        .prepare(
          `INSERT INTO user_teams
             (id, name, description, win_condition, status, origin,
              origin_payload, source_tournament_team_id, validation_errors,
              validation_warnings, schema_version, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, '[]', '[]', 1, ?, ?)`,
        )
        .run(
          id,
          name,
          parsed.description,
          parsed.win_condition,
          parsed.origin,
          parsed.origin_payload,
          parsed.source_tournament_team_id,
          createdAt,
          createdAt,
        );
      const insertSet = db.$client.prepare(
        `INSERT INTO user_team_sets
           (user_team_id, slot, species_id, nickname, item_id, ability_id,
            nature, hp_sps, atk_sps, def_sps, spa_sps, spd_sps, spe_sps,
            move_1_id, move_2_id, move_3_id, move_4_id, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const s of sets) {
        insertSet.run(
          id,
          s.slot,
          s.species_id,
          s.nickname,
          s.item_id,
          s.ability_id,
          s.nature,
          s.hp_sps,
          s.atk_sps,
          s.def_sps,
          s.spa_sps,
          s.spd_sps,
          s.spe_sps,
          s.move_1_id,
          s.move_2_id,
          s.move_3_id,
          s.move_4_id,
          s.notes,
        );
      }
    });
    tx();
  } catch (e) {
    throw new RosterDbError(`failed to create user_team`, {
      cause: e,
      query: id,
    });
  }
  const team = readTeam(db, id);
  if (!team) {
    throw new RosterDbError(
      `user_team ${id} disappeared after insert (transaction inconsistency)`,
    );
  }
  return team;
}

/**
 * Read a full team + sets by id.
 *
 * @param db — Open DB handle.
 * @param id — A ulid.
 * @returns The `UserTeam`, or `null` if no row matches.
 * @throws {RosterDbError} On SQLite I/O failure.
 * @throws {RosterDataError} On corrupt persisted JSON.
 */
export function get(db: Db, id: string): UserTeam | null {
  try {
    return readTeam(db, id);
  } catch (e) {
    if (e instanceof RosterDataError) throw e;
    throw new RosterDbError(`failed to read user_team ${id}`, {
      cause: e,
      query: id,
    });
  }
}

/**
 * List teams matching the filter, ordered by `updated_at DESC`.
 *
 * @param db — Open DB handle.
 * @param filter — Optional status / origin filters.
 * @returns Array of `UserTeam`, possibly empty.
 * @throws {RosterDbError} On SQLite I/O failure.
 */
export function list(db: Db, filter: UserTeamFilter): UserTeam[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.status !== undefined) {
    where.push("status = ?");
    params.push(filter.status);
  }
  if (filter.origin !== undefined) {
    where.push("origin = ?");
    params.push(filter.origin);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const rows = db.$client
    .prepare(`SELECT id FROM user_teams ${whereSql} ORDER BY updated_at DESC`)
    .all(...params) as Array<{ id: string }>;
  const teams: UserTeam[] = [];
  for (const r of rows) {
    const t = readTeam(db, r.id);
    if (t) teams.push(t);
  }
  return teams;
}

/**
 * Patch top-level fields. Triggers a revision iff status was already
 * `'saved'` (drafts don't burn revision slots).
 *
 * @param db — Open DB handle.
 * @param id — A ulid.
 * @param patch — Fields to update.
 * @returns The updated `UserTeam`.
 * @throws {UserTeamNotFoundError} If the id doesn't exist.
 * @throws {RosterDbError} On SQLite I/O failure (incl. `patch.name`
 *   colliding with an existing user_team's `name` unique index).
 */
export function update(
  db: Db,
  id: string,
  patch: UserTeamUpdatePatch,
): UserTeam {
  const existing = readTeam(db, id);
  if (!existing) {
    throw new UserTeamNotFoundError(`user_team ${id} not found`, {
      team_id: id,
    });
  }
  const updatedAt = ISO_NOW();
  const fields: string[] = [];
  const params: unknown[] = [];
  if (patch.name !== undefined) {
    fields.push("name = ?");
    params.push(patch.name);
  }
  if (patch.description !== undefined) {
    fields.push("description = ?");
    params.push(patch.description);
  }
  if (patch.win_condition !== undefined) {
    fields.push("win_condition = ?");
    params.push(patch.win_condition);
  }
  fields.push("updated_at = ?");
  params.push(updatedAt);
  params.push(id);

  const tx = db.$client.transaction(() => {
    db.$client
      .prepare(`UPDATE user_teams SET ${fields.join(", ")} WHERE id = ?`)
      .run(...params);
    if (existing.status === "saved") {
      const refreshed = readTeam(db, id);
      if (refreshed) recordRevision(db, id, refreshed, null);
    }
  });
  try {
    tx();
  } catch (e) {
    throw new RosterDbError(`failed to update user_team ${id}`, {
      cause: e,
      query: id,
    });
  }
  return readTeam(db, id) as UserTeam;
}

/**
 * Auto-persist surface: composite-key write to one slot. Never triggers
 * a revision (Stage-2 Q4 binding: `checkpoint` is the explicit affordance).
 *
 * @param db — Open DB handle.
 * @param id — A ulid for the parent team.
 * @param slot — 0..5.
 * @param patch — Partial set fields.
 * @throws {UserTeamNotFoundError} If the team doesn't exist.
 * @throws {RosterDbError} On SQLite I/O failure.
 */
export function upsertSet(
  db: Db,
  id: string,
  slot: number,
  patch: UserTeamSetUpsertPatch,
): void {
  if (slot < 0 || slot > 5) {
    throw new RosterDbError(`slot ${slot} out of range 0..5`);
  }
  const exists = db.$client
    .prepare("SELECT 1 AS x FROM user_teams WHERE id = ?")
    .get(id) as { x?: number } | undefined;
  if (!exists) {
    throw new UserTeamNotFoundError(`user_team ${id} not found`, {
      team_id: id,
    });
  }
  // Build column-update fragments for whichever fields are provided.
  const colMap: Record<string, string> = {
    species_id: "species_id",
    nickname: "nickname",
    item_id: "item_id",
    ability_id: "ability_id",
    nature: "nature",
    hp_sps: "hp_sps",
    atk_sps: "atk_sps",
    def_sps: "def_sps",
    spa_sps: "spa_sps",
    spd_sps: "spd_sps",
    spe_sps: "spe_sps",
    move_1_id: "move_1_id",
    move_2_id: "move_2_id",
    move_3_id: "move_3_id",
    move_4_id: "move_4_id",
    notes: "notes",
  };
  const updates: string[] = [];
  const params: unknown[] = [];
  for (const [k, col] of Object.entries(colMap)) {
    if (k in patch) {
      const v = (patch as Record<string, unknown>)[k];
      updates.push(`${col} = ?`);
      params.push(v ?? null);
    }
  }

  const tx = db.$client.transaction(() => {
    if (updates.length === 0) return;
    // The slot row exists from `create`; UPDATE is the common path.
    db.$client
      .prepare(
        `UPDATE user_team_sets SET ${updates.join(", ")} WHERE user_team_id = ? AND slot = ?`,
      )
      .run(...params, id, slot);
    db.$client
      .prepare("UPDATE user_teams SET updated_at = ? WHERE id = ?")
      .run(ISO_NOW(), id);
  });
  try {
    tx();
  } catch (e) {
    throw new RosterDbError(
      `failed to upsert user_team_sets (${id}, ${slot})`,
      { cause: e, query: id },
    );
  }
}

/**
 * Status transition. Gates `'saved'` on
 * `validateTeam(team, deps, { target_status: 'saved' }).errors === []`
 * (warnings are allowed; `slot_empty` is checked because the saved gate
 * runs at saved target — flow §6 contract). Creates a revision on entry
 * to (or re-entry into) `'saved'`. Per Stage-2 Q5 + plan §6.
 *
 * @param db — Open DB handle.
 * @param id — A ulid.
 * @param status — Target status.
 * @param deps — Validator deps.
 * @returns The updated `UserTeam`.
 * @throws {UserTeamValidationError} On `'saved'` with errors.
 * @throws {UserTeamNotFoundError} On unknown id.
 * @throws {RosterDbError} On SQLite I/O failure.
 */
export function setStatus(
  db: Db,
  id: string,
  status: UserTeamStatus,
  deps: ValidateDeps,
): UserTeam {
  const existing = readTeam(db, id);
  if (!existing) {
    throw new UserTeamNotFoundError(`user_team ${id} not found`, {
      team_id: id,
    });
  }
  const result = validateTeam(existing, deps, {
    target_status: status === "saved" ? "saved" : "draft",
  });
  if (status === "saved" && result.errors.length > 0) {
    throw new UserTeamValidationError(
      `cannot save user_team ${id}: ${result.errors.length} validation error(s)`,
      { team_id: id, result },
    );
  }
  const updatedAt = ISO_NOW();
  const tx = db.$client.transaction(() => {
    db.$client
      .prepare(
        `UPDATE user_teams SET
           status = ?,
           validation_errors = ?,
           validation_warnings = ?,
           updated_at = ?
         WHERE id = ?`,
      )
      .run(
        status,
        JSON.stringify(result.errors),
        JSON.stringify(result.warnings),
        updatedAt,
        id,
      );
    if (status === "saved") {
      const refreshed = readTeam(db, id);
      if (refreshed) recordRevision(db, id, refreshed, null);
    }
  });
  try {
    tx();
  } catch (e) {
    throw new RosterDbError(`failed to setStatus on user_team ${id}`, {
      cause: e,
      query: id,
    });
  }
  return readTeam(db, id) as UserTeam;
}

/**
 * Hard delete. CASCADE removes `user_team_sets` and `user_team_revisions`.
 *
 * @param db — Open DB handle.
 * @param id — A ulid.
 * @throws {RosterDbError} On SQLite I/O failure.
 */
export function deleteTeam(db: Db, id: string): void {
  try {
    db.$client.prepare("DELETE FROM user_teams WHERE id = ?").run(id);
  } catch (e) {
    throw new RosterDbError(`failed to delete user_team ${id}`, {
      cause: e,
      query: id,
    });
  }
}

/**
 * Metadata for the team's revisions, newest first. Up to 5 entries.
 *
 * @param db — Open DB handle.
 * @param id — A ulid.
 * @returns Array of `UserTeamRevisionMeta`, newest first.
 * @throws {RosterDbError} On SQLite I/O failure.
 */
export function listRevisions(
  db: Db,
  id: string,
): UserTeamRevisionMeta[] {
  try {
    const rows = db.$client
      .prepare(
        `SELECT user_team_id, revision_number, label, created_at
           FROM user_team_revisions
           WHERE user_team_id = ?
           ORDER BY revision_number DESC`,
      )
      .all(id) as Array<{
      user_team_id: string;
      revision_number: number;
      label: string | null;
      created_at: string;
    }>;
    return rows.map((r) => ({
      user_team_id: r.user_team_id,
      revision_number: r.revision_number,
      created_at: r.created_at,
      label: r.label,
    }));
  } catch (e) {
    throw new RosterDbError(`failed to list revisions for ${id}`, {
      cause: e,
      query: id,
    });
  }
}

/**
 * Restore a snapshot over the current state. Status drops to `'draft'`.
 * Does NOT create a revision (prevents recursive eviction).
 *
 * @param db — Open DB handle.
 * @param id — A ulid for the team.
 * @param revisionNumber — A 1..N number returned by `listRevisions`.
 * @returns The restored `UserTeam` (status='draft').
 * @throws {UserTeamRevisionNotFoundError} On bad `(id, revisionNumber)`.
 * @throws {RosterDbError} On SQLite I/O failure.
 */
export function restoreRevision(
  db: Db,
  id: string,
  revisionNumber: number,
): UserTeam {
  const row = db.$client
    .prepare(
      "SELECT snapshot_json FROM user_team_revisions WHERE user_team_id = ? AND revision_number = ?",
    )
    .get(id, revisionNumber) as { snapshot_json: string } | undefined;
  if (!row) {
    throw new UserTeamRevisionNotFoundError(
      `user_team_revision (${id}, ${revisionNumber}) not found`,
      { team_id: id, revision_number: revisionNumber },
    );
  }
  let snapshot: UserTeam;
  try {
    const parsed = UserTeamSchema.safeParse(JSON.parse(row.snapshot_json));
    if (!parsed.success) {
      throw new RosterDataError(
        `corrupt snapshot for revision (${id}, ${revisionNumber})`,
        { cause: parsed.error, query: id },
      );
    }
    snapshot = parsed.data;
  } catch (e) {
    if (e instanceof RosterDataError) throw e;
    throw new RosterDataError(
      `failed to parse snapshot for (${id}, ${revisionNumber})`,
      { cause: e, query: id },
    );
  }

  const updatedAt = ISO_NOW();
  const tx = db.$client.transaction(() => {
    db.$client
      .prepare(
        `UPDATE user_teams SET
           name = ?,
           description = ?,
           win_condition = ?,
           status = 'draft',
           origin = ?,
           origin_payload = ?,
           source_tournament_team_id = ?,
           validation_errors = ?,
           validation_warnings = ?,
           updated_at = ?
         WHERE id = ?`,
      )
      .run(
        snapshot.name,
        snapshot.description,
        snapshot.win_condition,
        snapshot.origin,
        snapshot.origin_payload,
        snapshot.source_tournament_team_id,
        JSON.stringify(snapshot.validation_errors),
        JSON.stringify(snapshot.validation_warnings),
        updatedAt,
        id,
      );
    db.$client
      .prepare("DELETE FROM user_team_sets WHERE user_team_id = ?")
      .run(id);
    const insertSet = db.$client.prepare(
      `INSERT INTO user_team_sets
         (user_team_id, slot, species_id, nickname, item_id, ability_id,
          nature, hp_sps, atk_sps, def_sps, spa_sps, spd_sps, spe_sps,
          move_1_id, move_2_id, move_3_id, move_4_id, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const s of snapshot.sets) {
      insertSet.run(
        id,
        s.slot,
        s.species_id,
        s.nickname,
        s.item_id,
        s.ability_id,
        s.nature,
        s.hp_sps,
        s.atk_sps,
        s.def_sps,
        s.spa_sps,
        s.spd_sps,
        s.spe_sps,
        s.move_1_id,
        s.move_2_id,
        s.move_3_id,
        s.move_4_id,
        s.notes,
      );
    }
  });
  try {
    tx();
  } catch (e) {
    throw new RosterDbError(
      `failed to restore (${id}, ${revisionNumber})`,
      { cause: e, query: id },
    );
  }
  return readTeam(db, id) as UserTeam;
}

/**
 * Manual checkpoint — create a revision on demand from any status (Stage-2 Q4).
 *
 * **When to use it:** the user wants to "save a checkpoint" mid-edit
 * without changing status. Subject to the same 5-slot retention as
 * automatic revisions (oldest evicted on the 6th).
 *
 * @param db — Open DB handle.
 * @param id — A ulid.
 * @param label — Optional human-facing label for the checkpoint.
 * @returns The freshly-recorded revision metadata.
 * @throws {UserTeamNotFoundError} On unknown id.
 * @throws {RosterDbError} On SQLite I/O failure.
 *
 * @example
 *   const meta = checkpoint(db, teamId, "before splitting Garchomp's spread");
 */
export function checkpoint(
  db: Db,
  id: string,
  label?: string,
): UserTeamRevisionMeta {
  const team = readTeam(db, id);
  if (!team) {
    throw new UserTeamNotFoundError(`user_team ${id} not found`, {
      team_id: id,
    });
  }
  try {
    return recordRevision(db, id, team, label ?? null);
  } catch (e) {
    throw new RosterDbError(`failed to checkpoint user_team ${id}`, {
      cause: e,
      query: id,
    });
  }
}
