# Tech Plan — User Teams (headless)

**Slug:** `user-teams`
**Stage:** Stage 3 — Tech plan (pending approval)
**Date:** 2026-05-08
**Author:** Tech Lead subagent
**Implements flow doc:** `docs/flows/user-teams.md` (Stage 2 approved 2026-05-08 by Rodrigo Caballero)
**Memory citations:**
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/db_orm_drizzle.md`
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/data_layer_two_tier_db.md`
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/single_db_non_destructive_build.md`
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/regulation_m_a_no_tera.md`
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/regulation_m_a_stat_rules.md`
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/regulation_m_a_roster.md`
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/labmaus_pokepaste_deferred_todos.md`

**Sibling plans:**
- `docs/plans/labmaus-tournaments.md` — owns `tournament_teams`, the source for the duplicate path.
- `docs/plans/pokepaste-sets.md` — owns the canonical Showdown-export → `TeamSet` parser (`src/tools/pokepaste/transform.ts::transformPaste`); reused as-is here.
- `docs/plans/pokemon-roster-db.md` — owns ref tables (`species`, `items`, `abilities`, `moves`, `species_abilities`, `roster_membership`) and the `createSimpleRepo` factory.

---

## 1. Goal recap

Ship the **headless** layer for user-owned teams: three new SQLite tables (`user_teams`, `user_team_sets`, `user_team_revisions`), a Drizzle-driven migration, a bespoke `userTeams` repo with auto-persist/draft semantics + 5-revision retention, three converging entry points (paste / from-scratch / duplicate-from-tournament), a central `validateTeam` validator that distinguishes **errors from warnings** (per Stage-2 Q5), an auto-name generator, and a CLI script. No UI, no AI prompt path, no lead-plan storage. Done means: a Pokepaste round-trips paste → parse → validate → save → re-read by structured equality; auto-persist takes 12 incremental writes without losing partial state; cloning a labmaus tournament team produces a structurally-equal user team with `source_tournament_team_id` set; `validateTeam` catches each of the 11 error codes plus the new `species_not_legal_warning`; saving a sixth revision evicts the oldest; existing labmaus / pokepaste / vgcguide / metavgc / pikalytics tests stay green.

---

## 2. Module boundaries

All paths absolute under `/Users/rodrigo/src/pokemon-ai-trainer/`. Existing files marked *(extend)* receive additive edits only.

### Schemas (`src/schemas/`)

#### `src/schemas/user-team.ts` (new)
- **Single responsibility:** zod schemas + inferred types for the user-teams domain — `UserTeamStatus`, `UserTeamOrigin`, `UserSet`, `UserTeam`, `UserTeamRow` (DB-row mirror), `UserTeamRevision`, `ValidationError`, `ValidationWarning`, `ValidationResult { errors, warnings }`, plus the repo-arg shapes (`UserTeamCreateArgs`, `UserTeamUpdatePatch`, `UserTeamSetUpsertPatch`, `UserTeamFilter`). Per the labmaus / pokepaste precedent, related entities cluster in one file.
- **Exported surface:**
  ```ts
  export const UserTeamStatusSchema:       z.ZodEnum<["draft","saved","archived"]>;
  export const UserTeamOriginSchema:       z.ZodEnum<["paste","builder","ai_prompt","duplicated_from_tournament"]>;
  export const UserSetSchema:              z.ZodObject<…>;       // 6 SPS ints, item/ability/moves nullable
  export const UserTeamSchema:             z.ZodObject<…>;       // top-level entity, 6 slots
  export const UserTeamCreateArgsSchema:   z.ZodObject<…>;
  export const UserTeamUpdatePatchSchema:  z.ZodObject<…>;
  export const UserTeamSetUpsertPatchSchema: z.ZodObject<…>;
  export const UserTeamFilterSchema:       z.ZodObject<…>;
  export const ValidationCodeSchema:       z.ZodEnum<[…11 codes…]>;
  export const ValidationWarningCodeSchema:z.ZodEnum<["species_not_legal_warning"]>;
  export const ValidationErrorSchema:      z.ZodObject<…>;       // {code, message, slot?}
  export const ValidationWarningSchema:    z.ZodObject<…>;       // {code, message, slot?}
  export const ValidationResultSchema:     z.ZodObject<…>;       // {errors[], warnings[]}
  export const UserTeamRevisionSchema:     z.ZodObject<…>;       // metadata + snapshot
  export const UserTeamRevisionMetaSchema: z.ZodObject<…>;       // metadata-only (list)
  export type UserTeam       = z.infer<typeof UserTeamSchema>;
  export type UserSet        = z.infer<typeof UserSetSchema>;
  // …matching `type` exports for every schema above.
  ```
- **TSDoc obligations (per CLAUDE.md §10):** every exported schema and type carries a six-element block. `UserTeamSchema` and `ValidationResultSchema` get an `@example`.
- **Does NOT do:** any DB I/O, any pokepaste parsing, any roster lookup. Pure shape + validation. Tera strip is enforced at the schema (no `tera_*` field defined; `.strict()` rejects leakage); SPS schema reuses the `SpsSchema` from `src/schemas/team-set.ts` (re-export, do not redefine — see §9).

#### `src/schemas/errors.ts` (extend)
- Add a `UserTeamError` family alongside `LabmausError` / `PokepasteError` / `PikalyticsError` / `KnowledgeError`. Same constructor pattern as `RosterError` / `PokepasteError` (`(msg, opts?: { cause?, query?, team_id? })`).
- **New exports:**
  - `UserTeamError` — base class.
  - `UserTeamValidationError` — thrown by `setStatus('saved')` when `errors.length > 0`. Carries the full `ValidationResult` on `.result` (so callers and tests inspect codes, not strings).
  - `UserTeamNotFoundError` — `get`/`update`/`delete`/`upsertSet`/`setStatus`/`restoreRevision` against an unknown id. Carries `.team_id`.
  - `UserTeamRevisionNotFoundError` — `restoreRevision` against an unknown `(team_id, revision_number)`.
- **Storage-layer errors reuse `RosterDbError` / `RosterDataError`** per the labmaus precedent (storage is shared regardless of which slice owns the table). New tool-domain errors stay in the new family.

### Data layer (`src/data/user-teams/`)

#### `src/data/user-teams/parse-pokepaste.ts` (new)
- **Single responsibility:** thin adapter that maps a raw Pokepaste body string → `UserTeam` partial (no `id`, no `created_at`, no DB-side fields). Reuses `src/tools/pokepaste/transform.ts::transformPaste` **as-is** (see §9 reuse audit; no lift required — the pokepaste parser is already a clean primitive that returns six `TeamSet` objects keyed by `tournament_team_id`+slot).
- **Exported surface:**
  ```ts
  export interface ParsePokepasteResult {
    /** A non-persisted UserTeam draft — id minted later by the repo. */
    team: Omit<UserTeam, "id" | "created_at" | "updated_at" | "schema_version">;
    /** Free-form warnings the parser surfaced (e.g. dropped tera lines). */
    raw_warnings: string[];
  }
  export function parsePokepasteToTeam(
    text: string,
    deps: ParseDeps,
  ): ParsePokepasteResult;
  export interface ParseDeps {
    db: Db;
    transform: TransformDeps;   // same shape pokepaste-sets uses
  }
  ```
- **Adapter behaviour:**
  - Wrap `transformPaste` with a synthetic `tournament_team_id` (`"user-teams:pending"`) and `paste_id` derived from a SHA-1 of the input text — **never persisted** (the repo discards the synthetic id; it exists only because `transformPaste`'s schema demands it).
  - Map each `TeamSet` → `UserSet` field-by-field: `species_roster_id` → `species_id`, `item` → `item_id` (resolved via `items.get`), `ability` → `ability_id` (via `abilities.get`), each `moves[i]` → `move_{i+1}_id` (via `moves.get`), `sps` → six `*_sps` columns (default 0 when null), `nature` passed through, `level` discarded (not part of `UserSet` v1 — flow §4.2 doesn't carry it).
  - On `PokepasteParseError` / `PokepasteRefValidationError` / `PokepasteUnknownSpeciesError`: catch, convert to a single-element `raw_warnings` entry, and **return a draft with as many slots as parsed cleanly so far** — auto-persist contract per flow §2.1 step 6 ("the draft is still saved"). The repo writes whatever slots came back; `validateTeam` re-discovers the gaps and emits structured errors.
- **Does NOT do:** DB writes, ref-table validation (the transform already does it but we **swallow** its throw to honour auto-persist). The validator is the user-facing source of truth on errors.

#### `src/data/user-teams/duplicate-from-tournament.ts` (new)
- **Single responsibility:** clone a `tournament_teams` row + its six `team_sets` rows into a `UserTeam` partial. Reads through the existing `tournaments.detail` (or sibling repo helper if one exists; otherwise direct `db.$client.prepare`) plus `sets.list({ tournament_team_id })`. Sets `origin = 'duplicated_from_tournament'`, `source_tournament_team_id = <fk>`. Original is untouched.
- **Exported surface:**
  ```ts
  export interface DuplicateResult {
    team: Omit<UserTeam, "id" | "created_at" | "updated_at" | "schema_version">;
    source_tournament_team_id: string;
  }
  export function duplicateFromTournament(
    db: Db,
    tournamentTeamId: string,
  ): DuplicateResult;
  ```
- **Throws** `UserTeamNotFoundError` (with `.team_id = tournamentTeamId` overloaded onto the field) when the FK target doesn't exist. The duplicate path returns 404 from CLI, **nothing written**, per flow §8.
- **Reuse note:** when `team_sets` has zero rows for the team (pokepaste-sets hasn't ingested its paste yet — the failure mode called out in `labmaus-tournaments.md` §18.5), the duplicate falls back to the `tournament_team_species` rows and produces a draft with `species_id` filled but no items/abilities/moves/SPS. Validator then surfaces the gaps as `slot_empty` (saved) or as no-op (draft).

#### `src/data/user-teams/auto-name.ts` (new)
- **Single responsibility:** generate a deterministic display name from a `UserTeam`'s species list, with date-prefix collision avoidance.
- **Exported surface:**
  ```ts
  export function autoGenerateName(
    team: Pick<UserTeam, "sets">,
    db: Db,
    today?: () => string,    // injected ISO YYYY-MM-DD for tests
  ): string;
  ```
- **Algorithm (per flow §5):**
  1. `nonEmpty = team.sets.filter(s => s.species_id !== null)` in slot order.
  2. Look up `species.display_name` for each via `species.get` (case-insensitive); skip slots whose lookup returns null.
  3. Take first **4** display names, join with `"-"`. If `nonEmpty.length > 4`, append ` + ${nonEmpty.length - 4}`.
  4. Empty team → `"Untitled team"` (flow doesn't pin this; surface as open question §17).
  5. Collision check: query `user_teams.name = ?` (existing names — single user, so any match is a collision); on hit, prepend `"<today> "`.
- **Does NOT do:** mutate the team. Caller decides whether the auto-name overrides the user's name (flow §5: user-provided overrides).

#### `src/data/team-validate.ts` (new)
- **Single responsibility:** the central `validateTeam` validator. Pure read against ref tables; **no DB writes**. Returns `{ errors, warnings }`. Used by the repo on every save, by `setStatus('saved')` as a hard gate, and by the CLI `validate` subcommand for ad-hoc checks. Stage-2 Q1 confirms this module does not exist today; it's scaffolded fresh.
- **Location rationale:** lives under `src/data/` not `src/db/` because it's pure-logic validation (no SQL composition), even though it consumes ref-table repos. Mirrors the existing `src/data/parseChampionsSets.ts` precedent.
- **Exported surface:**
  ```ts
  export interface ValidateDeps {
    db: Db;
    speciesRepo:    typeof import("../db/species");
    itemsRepo:      typeof import("../db/items");
    abilitiesRepo:  typeof import("../db/abilities");
    movesRepo:      typeof import("../db/moves");
    rosterRepo:     typeof import("../db/roster");
    /** Reads `species_abilities` (legal abilities per species). */
    speciesAbilities: {
      legalFor(db: Db, speciesId: string): string[];
    };
    /** Reads `species_movepool` (legal moves per species) — see §17 Q3. */
    speciesMovepool: {
      legalFor(db: Db, speciesId: string): string[];
    };
  }
  export function validateTeam(
    team: UserTeam,
    deps: ValidateDeps,
  ): ValidationResult;
  ```
- **Does NOT do:** mutate the team, throw on invalid inputs, hit the network. Returning a structured `{ errors, warnings }` is the contract — throws are reserved for bugs (e.g. malformed `team` object that fails `UserTeamSchema.safeParse`, surfaced as a single `errors` entry with `code: "schema_violation"` — surface as open question §17 since it's not on the flow's 11-code list).
- **Validation matrix:** see §3 below for the full code list and §4 for per-code triggers.

### DB layer (`src/db/`)

#### `src/db/drizzle-schema.ts` (extend, do NOT replace)
- Add three `sqliteTable` declarations: `userTeams`, `userTeamSets`, `userTeamRevisions`. Reuse the file's existing style (`check`, `index`, `uniqueIndex`, `primaryKey` from `drizzle-orm/sqlite-core`). FK from `userTeams.sourceTournamentTeamId` → `tournamentTeams.id` with **`onDelete: "set null"`** per flow Q4.
- Full DDL sketch in §5.

#### `src/db/migrations/0009_user_teams.sql` (new — drizzle-kit generated)
- Generated by `pnpm drizzle-kit generate` after the schema additions land. Filename auto-numbered after `0008_knowledge_multi_site_and_tags.sql`. Per memory `db_orm_drizzle.md`, **never hand-edit generated SQL**. Per memory `single_db_non_destructive_build.md`, the migration is **additive only** — it must not touch `tournaments` / `tournament_teams` / `tournament_team_species` / `team_sets` / `species` / etc.

#### `src/db/user-teams.ts` (new — bespoke repo)
- **Single responsibility:** CRUD + revisions for user_teams. Cannot use `createSimpleRepo` because: (a) `get` joins three tables (user_teams + user_team_sets + tournament_teams for the FK indirection), (b) `upsertSet` is a per-slot composite-key write, (c) `setStatus` runs `validateTeam` as a side-effecting gate, (d) revision retention is a transactional "insert-and-evict" pattern, (e) `list` filters on `(origin, status)` not just id/displayName. Per CLAUDE.md §10 the factory deliberately doesn't generalize that far — same reasoning that kept `tournaments.ts` and `sets.ts` bespoke.
- **Exported surface (signatures only — bodies in Stage 5):**
  ```ts
  /** Mints a ulid; auto-name unless `name` provided; status starts 'draft'. */
  export function create(db: Db, args: UserTeamCreateArgs): UserTeam;
  /** Read full team + sets. Returns null on miss. */
  export function get(db: Db, id: string): UserTeam | null;
  /** Filter by status / origin; orders by updated_at DESC. */
  export function list(db: Db, filter: UserTeamFilter): UserTeam[];
  /**
   * Patch top-level fields (name, description, win_condition).
   * Triggers a revision iff status === 'saved' (drafts don't burn revision slots).
   */
  export function update(db: Db, id: string, patch: UserTeamUpdatePatch): UserTeam;
  /** Hard delete; CASCADE removes user_team_sets and user_team_revisions. */
  export function deleteTeam(db: Db, id: string): void;     // exported as `delete` would shadow the keyword in some import patterns
  /**
   * Auto-persist surface — every keystroke / field commit writes through.
   * Composite key on (id, slot); creates the row if missing.
   * NEVER triggers a revision (drafts auto-save aggressively; revisions
   * track durable state, not edit-flow state).
   */
  export function upsertSet(
    db: Db, id: string, slot: number, patch: UserTeamSetUpsertPatch,
  ): void;
  /**
   * Status transition. Gates 'saved' on validateTeam errors=[] (warnings
   * are NOT errors — `species_not_legal_warning` does not block save).
   * Creates a revision on entry to 'saved' (and on every subsequent
   * 'saved'-state edit of name/description/win_condition or a slot — see
   * §6 for the trigger matrix). Drafts and archives don't.
   */
  export function setStatus(
    db: Db, id: string, status: UserTeamStatus, deps: ValidateDeps,
  ): UserTeam;
  /**
   * Metadata for the team's revisions. Returns at most 5 entries, newest
   * first. Cheap — does not load `snapshot_json`.
   */
  export function listRevisions(db: Db, id: string): UserTeamRevisionMeta[];
  /**
   * Restore a stored snapshot over the current state. Status drops to
   * 'draft' (restore is a fresh state — the user must re-affirm 'saved'
   * via setStatus, which re-runs the validator). DOES NOT create a
   * revision (otherwise restoring revision N would evict revision M,
   * breaking the user's mental model).
   */
  export function restoreRevision(
    db: Db, id: string, revisionNumber: number,
  ): UserTeam;
  ```
- **TSDoc:** all six elements per CLAUDE.md §10.
- **Internal helper (NOT exported):** `recordRevision(db, id, snapshot)` — the transactional "insert + evict oldest if count > 5" routine. Single source of truth for the retention rule; `setStatus` and `update` are its only callers.

#### `src/db/tool-definitions.ts` (extend)
- Add four read-only Anthropic-tool entries: `userTeamsGetTool`, `userTeamsListTool`, `userTeamsListRevisionsTool`, `userTeamsValidateTool`. Write-side tools (`create`/`update`/`upsertSet`/`setStatus`/`delete`/`restoreRevision`) are **NOT** exposed to the agent in this slice — too easy to misfire; Slice 4 (AI prompt) wires its own controlled write surface. **Surface as open question §17** for confirmation.

### Ingest / CLI script

#### `scripts/data/user-teams.ts` (new)
- **Single responsibility:** CLI entry point for `pnpm data:user-teams <subcommand>`. Subcommands per flow §3:
  - `create --name <n> [--description <d>] [--win-condition <wc>]` — empty builder team.
  - `list [--status <s>] [--origin <o>]` — table output.
  - `show <id>` — JSON dump (team + sets + revisions metadata).
  - `delete <id>` — confirms then hard-deletes.
  - `from-paste --file <path>` (or `--stdin`) — paste body → parse → create as draft.
  - `from-tournament --tournament-team-id <ttid>` — duplicate path.
  - `validate <id>` — runs `validateTeam` and prints `{ errors, warnings }` JSON.
  - `set-status <id> <status>` — wraps `setStatus`; surfaces `UserTeamValidationError` clearly.
  - `revisions <id>` — `listRevisions` table output.
  - `restore <id> <revision-number>` — `restoreRevision`.
- **Argv parsing:** same hand-rolled style as `scripts/data/ingest-labmaus.ts` (no new deps).
- **Exit codes:** `0` success; `1` on `UserTeamValidationError` / `UserTeamNotFoundError` / `RosterDbError`; `2` invalid argv.

### Tests

```
tests/schemas/user-team.test.ts
tests/data/user-teams/parse-pokepaste.test.ts
tests/data/user-teams/duplicate-from-tournament.test.ts
tests/data/user-teams/auto-name.test.ts
tests/data/team-validate.test.ts
tests/db/user-teams.test.ts
tests/db/user-teams-revisions.test.ts
tests/db/migrations-0009.test.ts
tests/scripts/user-teams.test.ts
```

### Package scripts (`package.json` extend)
- `"data:user-teams": "tsx scripts/data/user-teams.ts"`.

---

## 3. Data schemas (zod, full bodies — sketch; final lands in Stage 5)

Per CLAUDE.md §3 pure-data exemption, this entire schema file is eligible for batch landing. The implementor MUST disclose the batched scaffold in the Stage 4 commit message (per `labmaus-tournaments.md` §18.4 review finding).

```ts
// src/schemas/user-team.ts
import { z } from "zod";
import { SpsSchema } from "./team-set";   // reuse, do NOT redefine

const ULID         = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/);
const ISODateTime  = z.string().datetime({ offset: false });
const ISODate      = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const RosterId     = z.string().regex(/^[a-z0-9-]+$/);

export const UserTeamStatusSchema = z.enum(["draft", "saved", "archived"]);

export const UserTeamOriginSchema = z.enum([
  "paste", "builder", "ai_prompt", "duplicated_from_tournament",
]);

export const ValidationCodeSchema = z.enum([
  "species_unknown",
  "species_not_legal",          // hard error: species in roster but is_legal=0 AND user attempted setStatus('saved')
  "ability_not_legal",
  "move_not_legal",
  "item_unknown",
  "nature_unknown",
  "sps_total_exceeded",
  "sps_per_stat_exceeded",
  "slot_empty",                 // status='saved' only
  "duplicate_species",
  "tera_present",               // defense-in-depth; reserved
]);

export const ValidationWarningCodeSchema = z.enum([
  "species_not_legal_warning",  // soft: surfaces during draft + saved; never blocks
]);

export const ValidationErrorSchema = z.object({
  code:    ValidationCodeSchema,
  message: z.string().min(1),
  slot:    z.number().int().min(0).max(5).nullable().optional(),
}).strict();

export const ValidationWarningSchema = z.object({
  code:    ValidationWarningCodeSchema,
  message: z.string().min(1),
  slot:    z.number().int().min(0).max(5).nullable().optional(),
}).strict();

export const ValidationResultSchema = z.object({
  errors:   z.array(ValidationErrorSchema),
  warnings: z.array(ValidationWarningSchema),
}).strict();

export const UserSetSchema = z.object({
  slot:        z.number().int().min(0).max(5),
  species_id:  RosterId.nullable(),
  nickname:    z.string().min(1).nullable(),
  item_id:     z.string().min(1).nullable(),
  ability_id:  z.string().min(1).nullable(),
  nature:      z.string().min(1).nullable(),
  // Per-stat 0..32 enforced at the column CHECK level (hard); the
  // ≤66 total is enforced only by validateTeam (soft) so drafts can
  // transiently exceed during edits — see §5 / flow §4.2.
  hp_sps:      z.number().int().min(0).max(32),
  atk_sps:     z.number().int().min(0).max(32),
  def_sps:     z.number().int().min(0).max(32),
  spa_sps:     z.number().int().min(0).max(32),
  spd_sps:     z.number().int().min(0).max(32),
  spe_sps:     z.number().int().min(0).max(32),
  move_1_id:   z.string().min(1).nullable(),
  move_2_id:   z.string().min(1).nullable(),
  move_3_id:   z.string().min(1).nullable(),
  move_4_id:   z.string().min(1).nullable(),
  notes:       z.string().nullable(),
}).strict();

export const UserTeamSchema = z.object({
  schema_version:            z.literal(1),
  id:                        ULID,
  name:                      z.string().min(1),
  description:               z.string().nullable(),
  win_condition:             z.string().nullable(),
  status:                    UserTeamStatusSchema,
  origin:                    UserTeamOriginSchema,
  origin_payload:            z.string().nullable(),
  source_tournament_team_id: z.string().nullable(),    // FK; SET NULL on parent delete
  validation_errors:         z.array(ValidationErrorSchema),     // persisted as JSON
  validation_warnings:       z.array(ValidationWarningSchema),   // persisted as JSON
  sets:                      z.array(UserSetSchema).length(6),
  created_at:                ISODateTime,
  updated_at:                ISODateTime,
}).strict();

export const UserTeamCreateArgsSchema = z.object({
  origin:            UserTeamOriginSchema,
  origin_payload:    z.string().nullable().default(null),
  source_tournament_team_id: z.string().nullable().default(null),
  name:              z.string().min(1).optional(),
  description:       z.string().nullable().default(null),
  win_condition:     z.string().nullable().default(null),
  /** Optional initial sets; missing slots filled with empty placeholders. */
  sets:              z.array(UserSetSchema).max(6).default([]),
}).strict();

export const UserTeamUpdatePatchSchema = z.object({
  name:           z.string().min(1).optional(),
  description:    z.string().nullable().optional(),
  win_condition:  z.string().nullable().optional(),
}).strict();

export const UserTeamSetUpsertPatchSchema = UserSetSchema
  .omit({ slot: true })
  .partial()
  .strict();

export const UserTeamFilterSchema = z.object({
  status: UserTeamStatusSchema.optional(),
  origin: UserTeamOriginSchema.optional(),
}).strict();

export const UserTeamRevisionMetaSchema = z.object({
  user_team_id:    ULID,
  revision_number: z.number().int().min(1).max(5),
  created_at:      ISODateTime,
}).strict();

export const UserTeamRevisionSchema = UserTeamRevisionMetaSchema.extend({
  /** A frozen `UserTeam` snapshot. Schema-validated on read. */
  snapshot: UserTeamSchema,
}).strict();

export type UserTeam              = z.infer<typeof UserTeamSchema>;
export type UserSet               = z.infer<typeof UserSetSchema>;
export type UserTeamStatus        = z.infer<typeof UserTeamStatusSchema>;
export type UserTeamOrigin        = z.infer<typeof UserTeamOriginSchema>;
export type ValidationError       = z.infer<typeof ValidationErrorSchema>;
export type ValidationWarning     = z.infer<typeof ValidationWarningSchema>;
export type ValidationResult      = z.infer<typeof ValidationResultSchema>;
export type UserTeamCreateArgs    = z.infer<typeof UserTeamCreateArgsSchema>;
export type UserTeamUpdatePatch   = z.infer<typeof UserTeamUpdatePatchSchema>;
export type UserTeamSetUpsertPatch= z.infer<typeof UserTeamSetUpsertPatchSchema>;
export type UserTeamFilter        = z.infer<typeof UserTeamFilterSchema>;
export type UserTeamRevisionMeta  = z.infer<typeof UserTeamRevisionMetaSchema>;
export type UserTeamRevision      = z.infer<typeof UserTeamRevisionSchema>;
```

**Tera defense-in-depth:** none of these schemas declare a `tera_*` field; `.strict()` everywhere ensures any leak from an upstream parser fails validation. A property test (T-USR-S6) introspects all schema bodies for tera-named keys.

---

## 4. Validation matrix

`validateTeam(team, deps)` applies the following rules. Each violation produces one entry; multiple violations on one slot produce multiple entries (callers de-dupe if they want). The `slot` field is null for whole-team violations (`duplicate_species`, `sps_total_exceeded`).

| Code | Severity | Trigger | Notes |
|---|---|---|---|
| `species_unknown` | error | `species_id !== null && !speciesRepo.has(db, id, "RegM-A")` | per-slot |
| `species_not_legal` | error | species in `species` but NOT `is_legal=1` in `roster_membership` AND **status target = 'saved'** | per-slot; promoted from warning when saving |
| `species_not_legal_warning` | warning | species in `species` but NOT `is_legal=1` AND status target ≠ 'saved' OR draft state | NEW — flow Q5; **never blocks save** per binding answer; shown alongside errors but counted separately |
| `ability_not_legal` | error | `ability_id` not in `species_abilities` for the species | per-slot |
| `move_not_legal` | error | any `move_{1..4}_id` not in `species_movepool` for the species | per-slot; emit one entry per offending move |
| `item_unknown` | error | `item_id` not in `items` | per-slot |
| `nature_unknown` | error | `nature` not in canonical-25 set (constant in `src/data/team-validate.ts`) | per-slot |
| `sps_total_exceeded` | error | sum of 6 SPS > 66 | whole-team (slot=null) |
| `sps_per_stat_exceeded` | error | any per-stat > 32 (column CHECK guards this hard at saved; emitted for debugging if a draft somehow has it) | per-slot |
| `slot_empty` | error | status target = 'saved' AND species_id null | per-slot; only emitted when caller passes `target_status: 'saved'` (validator opt-in arg — surface in §17) |
| `duplicate_species` | error | same `species_id` in two slots | whole-team |
| `tera_present` | error | any field name on the input matches `/tera/i` | whole-team; programmer-bug class |

**The binding rule (Stage-2 Q5):** `setStatus('saved')` rejects iff `errors.length > 0`. A team containing only `warnings` IS allowed to save. The `species_not_legal_warning` ↔ `species_not_legal` promotion is governed by an opt-in `target_status` arg the repo passes when invoking the validator (`'draft'` → emit warning; `'saved'` → emit error). See §17 Q1 for whether the arg lives on the validator surface or is split into two helpers.

---

## 5. Drizzle schema additions (sketch — final lands in Stage 5)

Per memory `db_orm_drizzle.md`: declarations in `src/db/drizzle-schema.ts`; migration generated by `drizzle-kit generate`; never hand-edit generated SQL. Per memory `single_db_non_destructive_build.md`: additive only, no touch of existing tables.

```ts
export const userTeams = sqliteTable("user_teams", {
  id:                      text("id").primaryKey(),
  name:                    text("name").notNull(),
  description:             text("description"),
  winCondition:            text("win_condition"),
  status:                  text("status").notNull().default("draft"),
  origin:                  text("origin").notNull(),
  originPayload:           text("origin_payload"),
  sourceTournamentTeamId:  text("source_tournament_team_id")
                              .references(() => tournamentTeams.id, { onDelete: "set null" }),
  validationErrors:        text("validation_errors").notNull().default("[]"),    // JSON array
  validationWarnings:      text("validation_warnings").notNull().default("[]"),  // JSON array
  schemaVersion:           integer("schema_version").notNull().default(1),
  createdAt:               text("created_at").notNull(),
  updatedAt:               text("updated_at").notNull(),
}, (t) => [
  check("user_teams_status_valid",
        sql`${t.status} IN ('draft','saved','archived')`),
  check("user_teams_origin_valid",
        sql`${t.origin} IN ('paste','builder','ai_prompt','duplicated_from_tournament')`),
  check("user_teams_origin_tournament_consistency",
        sql`(${t.origin} = 'duplicated_from_tournament') = (${t.sourceTournamentTeamId} IS NOT NULL)`),
  index("idx_user_teams_status").on(t.status),
  index("idx_user_teams_origin").on(t.origin),
  index("idx_user_teams_updated_at_desc").on(t.updatedAt),
  uniqueIndex("uq_user_teams_name").on(t.name),     // single-user; auto-name uses date prefix on collision
]);

export const userTeamSets = sqliteTable("user_team_sets", {
  userTeamId:  text("user_team_id").notNull()
                  .references(() => userTeams.id, { onDelete: "cascade" }),
  slot:        integer("slot").notNull(),
  speciesId:   text("species_id").references(() => species.id),     // nullable — drafts allowed
  nickname:    text("nickname"),
  itemId:      text("item_id").references(() => items.id),
  abilityId:   text("ability_id").references(() => abilities.id),
  nature:      text("nature"),
  hpSps:       integer("hp_sps").notNull().default(0),
  atkSps:      integer("atk_sps").notNull().default(0),
  defSps:      integer("def_sps").notNull().default(0),
  spaSps:      integer("spa_sps").notNull().default(0),
  spdSps:      integer("spd_sps").notNull().default(0),
  speSps:      integer("spe_sps").notNull().default(0),
  move1Id:     text("move_1_id").references(() => moves.id),
  move2Id:     text("move_2_id").references(() => moves.id),
  move3Id:     text("move_3_id").references(() => moves.id),
  move4Id:     text("move_4_id").references(() => moves.id),
  notes:       text("notes"),
}, (t) => [
  primaryKey({ columns: [t.userTeamId, t.slot] }),
  check("user_team_sets_slot_range", sql`${t.slot} BETWEEN 0 AND 5`),
  // Per-stat 0..32 — HARD CHECK (always enforced). Drafts may temporarily
  // exceed only by aggregation, never by individual stat.
  check("user_team_sets_hp_sps_le_32",  sql`${t.hpSps}  BETWEEN 0 AND 32`),
  check("user_team_sets_atk_sps_le_32", sql`${t.atkSps} BETWEEN 0 AND 32`),
  check("user_team_sets_def_sps_le_32", sql`${t.defSps} BETWEEN 0 AND 32`),
  check("user_team_sets_spa_sps_le_32", sql`${t.spaSps} BETWEEN 0 AND 32`),
  check("user_team_sets_spd_sps_le_32", sql`${t.spdSps} BETWEEN 0 AND 32`),
  check("user_team_sets_spe_sps_le_32", sql`${t.speSps} BETWEEN 0 AND 32`),
  // The 66 total is NOT a CHECK — it's validator-only so drafts can
  // transiently overshoot during edits. Per flow §4.2 last paragraph.
]);

export const userTeamRevisions = sqliteTable("user_team_revisions", {
  userTeamId:     text("user_team_id").notNull()
                     .references(() => userTeams.id, { onDelete: "cascade" }),
  revisionNumber: integer("revision_number").notNull(),
  /** Full UserTeam snapshot, schema-validated on read. */
  snapshotJson:   text("snapshot_json").notNull(),
  createdAt:      text("created_at").notNull(),
}, (t) => [
  primaryKey({ columns: [t.userTeamId, t.revisionNumber] }),
  check("user_team_revisions_number_range",
        sql`${t.revisionNumber} BETWEEN 1 AND 5`),
  index("idx_user_team_revisions_team_created").on(t.userTeamId, t.createdAt),
]);
```

**Hard vs soft constraint summary (binding per flow §4.2):**

| Rule | Where | Why this layer |
|---|---|---|
| Per-stat SPS ≤ 32 | column CHECK | Step size 1, hard cap, no edit flow ever sets a per-stat > 32 (UI clamps) — safe to be hard. |
| Total SPS ≤ 66 | validator only | Auto-persist writes one stat at a time; intermediate states may transiently exceed 66 before the user balances them. Hard CHECK would block legitimate edits. |
| `status` enum, `origin` enum | column CHECK | Closed sets, never transient. |
| `origin = 'duplicated_from_tournament' ⇔ source_tournament_team_id IS NOT NULL` | column CHECK | Models the FK semantics directly. |
| Slot 0..5 | column CHECK | Hard, by definition. |
| Species in roster | validator only | A species deleted from roster shouldn't orphan-corrupt a saved team; SET NULL via FK preserves the reference. |
| Tera absence | schema `.strict()` + grep test | No table column for tera; CHECK is unnecessary. |

**Migration:** generated as `src/db/migrations/0009_user_teams.sql` by drizzle-kit after the schema additions land. Per memory `single_db_non_destructive_build.md`, the migration MUST run cleanly against a populated prod DB (already has `tournaments` / `team_sets` / etc.) and MUST NOT touch existing data.

---

## 6. Repository design (`src/db/user-teams.ts`)

Same pattern as `roster.ts` / `tournaments.ts`: `WeakMap<Db, Prepared>` of pre-compiled statements; one bundle constructor per logical query.

| Method | SQL strategy | Indexes used |
|---|---|---|
| `create(db, args)` | Transaction: (1) generate ulid + ISO timestamps; (2) auto-name if `args.name` undefined (calls `autoGenerateName`); (3) INSERT into `user_teams` with `status='draft'`, `validation_errors='[]'`, `validation_warnings='[]'`; (4) INSERT 6 `user_team_sets` rows (slots 0..5, mostly nulls + zeros if `args.sets` is empty); (5) overlay any provided `args.sets` via per-slot UPDATE. **No revision created** (status starts draft). | PK |
| `get(db, id)` | Two prepared statements: team-by-id, sets-by-team-id-ordered. Assemble in JS, parse via `UserTeamSchema`. | PK lookups |
| `list(db, filter)` | `SELECT * FROM user_teams WHERE status=? AND origin=? ORDER BY updated_at DESC` (filter clauses optional via Drizzle `and(...)`). For each row, batch-fetch sets via single `IN (?, ?, ...)` query to avoid N+1. | `idx_user_teams_status`, `idx_user_teams_origin`, `idx_user_teams_updated_at_desc` |
| `update(db, id, patch)` | Transaction: (1) read existing; (2) UPDATE `user_teams` with patched fields + new `updated_at`; (3) **if `existing.status === 'saved'`**, call `recordRevision(db, id, snapshot)`. | PK |
| `deleteTeam(db, id)` | `DELETE FROM user_teams WHERE id = ?` — CASCADE handles `user_team_sets` and `user_team_revisions`. | PK |
| `upsertSet(db, id, slot, patch)` | Single statement: `INSERT INTO user_team_sets (user_team_id, slot, ...) VALUES (?, ?, ...) ON CONFLICT (user_team_id, slot) DO UPDATE SET <patch fields>`. **Touches `user_teams.updated_at`** in the same transaction. **Never creates a revision** (drafts auto-persist; saved teams that get edited via `upsertSet` create the revision via the next `update` or via an explicit save flow — see open §17 Q4). | PK |
| `setStatus(db, id, status, deps)` | Transaction: (1) read existing team; (2) call `validateTeam(team, deps)`; (3) write `validation_errors` / `validation_warnings` JSON columns; (4) if `status === 'saved'`: throw `UserTeamValidationError` when `result.errors.length > 0`; else UPDATE `status`; **if entering 'saved'**, call `recordRevision`. | PK |
| `listRevisions(db, id)` | `SELECT user_team_id, revision_number, created_at FROM user_team_revisions WHERE user_team_id = ? ORDER BY revision_number DESC`. Returns metadata only — `snapshot_json` not loaded. | composite PK |
| `restoreRevision(db, id, n)` | Transaction: (1) read snapshot; (2) parse via `UserTeamSchema` (fail loud `RosterDataError` on corruption); (3) overwrite `user_teams` row + 6 `user_team_sets` rows from snapshot (DELETE + INSERT for sets is simplest); (4) set `status = 'draft'`; (5) **does NOT create a revision** (prevents recursive eviction). | PK |
| _internal_ `recordRevision(db, id, snapshot)` | Transaction: (1) `INSERT INTO user_team_revisions (..., revision_number = (SELECT COALESCE(MAX(revision_number), 0) + 1 FROM user_team_revisions WHERE user_team_id = ?))`; (2) if count > 5, `DELETE FROM user_team_revisions WHERE user_team_id = ? AND revision_number = (SELECT MIN(revision_number) ...)`. | composite PK |

**Revision trigger matrix (binding per Stage-2 Q2 + design):**

| Operation | Status before | Status after | Creates revision? | Why |
|---|---|---|---|---|
| `create` (origin = builder) | — | draft | **NO** | Drafts don't burn revisions. |
| `create` (origin = paste) | — | draft | **NO** | Same. |
| `create` (origin = duplicated_from_tournament) | — | draft | **NO** | Same. |
| `upsertSet` | draft | draft | **NO** | Auto-persist would burn 5 slots in seconds. |
| `upsertSet` | saved | saved | **NO** in v1 | Auto-persist on a saved team should NOT silently fork its history. The user must call `update` or `setStatus` to record. **Surface as open §17 Q4** — this is the most counter-intuitive call in the matrix. |
| `update` | draft | draft | **NO** | Same reasoning. |
| `update` | saved | saved | **YES** | Saved-team edits are the edit class users want to revert. |
| `setStatus('saved')` (from draft) | draft | saved | **YES** | Entry into saved state — the canonical "I want to remember this" event. |
| `setStatus('archived')` | * | archived | **NO** | Archive isn't a snapshot-worthy event. |
| `setStatus('draft')` from saved | saved | draft | **NO** | "Re-open for editing" — the saved version is already preserved as the latest revision. |
| `restoreRevision` | * | draft | **NO** | Otherwise restore would evict another snapshot. |
| `deleteTeam` | * | — | n/a (CASCADE) | Revisions go with the team. |

**Why `userTeams` cannot use `createSimpleRepo` (justification per CLAUDE.md §10):** the factory generalizes (a) one table, (b) two indexes (id + display_name), (c) a `rowToEntity`. It deliberately stops there. `get` joins user_teams ↔ user_team_sets; `setStatus` runs the validator as a gate; `upsertSet` is a per-slot composite-key write; revision retention is a transactional insert+evict; `list` filters on enum columns. None are factorable without bloating `simple-repo.ts` past its single responsibility.

---

## 7. Architecture patterns + the why

| Pattern | Where it lands | Why this slice |
|---|---|---|
| **Repository pattern** | `src/db/user-teams.ts` | Same reasoning as `tournaments.ts` / `sets.ts`: prepared statements + zod parsing in one place; the validator and CLI never see raw SQL. |
| **Three tables, not one with `current_revision_number` flag** | `user_teams` + `user_team_sets` + `user_team_revisions` | Snapshot-on-save is a **history concern**, separate from the **live editable state**. Mixing them (e.g. `user_teams.is_current=1` row + `is_current=0` revision rows) couples writes (every save touches every old row) and confuses the FK story (`source_tournament_team_id` on a 5-year-old revision row would be meaningless). The 3-table split keeps each table's invariants tight. Trade-off: snapshots duplicate what's in `user_teams` + `user_team_sets`. Acceptable — snapshots are JSON blobs cheap to store and the agent-facing repo only ever queries `user_teams` / `user_team_sets`. |
| **Drafts don't auto-revision** | Repo trigger matrix in §6 | Auto-persist is per-keystroke; if every `upsertSet` recorded a revision, the user would burn through 5 slots before they finished typing a single set. Revisions are durable-state checkpoints, not a transaction log. |
| **`validateTeam` lives in `src/data/`, not `src/db/`** | `src/data/team-validate.ts` | It's pure logic over ref-table reads; no SQL composition. Mirrors `src/data/parseChampionsSets.ts`. The repo *uses* it via injected deps; doesn't *implement* it. |
| **Errors vs warnings split** | `ValidationResult { errors, warnings }` | Stage-2 Q5 binding: unreleased species is a soft signal. Bundling everything into a single `validation_errors` array would force callers to filter by code prefix to avoid blocking save — fragile. Two arrays make the gate explicit (`setStatus('saved')` checks `errors.length` only). |
| **Pokepaste parser reused as-is** (no lift) | `src/tools/pokepaste/transform.ts::transformPaste` is already a clean primitive returning `TeamSet[]`. The user-teams adapter calls it with a synthetic `tournament_team_id` and discards the synthesizer fields. | Stage-2 Q3 binding: "reuse every tool cleanly." `scripts/data/pokepaste-hook.ts` is the **labmaus-side** orchestrator (per-team retry, run summary accumulation); `transformPaste` itself is the parser. No lift cost — the parser is already in `src/tools/pokepaste/transform.ts`. |
| **`Team` / `Set` are NEW canonical primitives, not reused `TeamSet`** | `src/schemas/user-team.ts` defines `UserTeam` / `UserSet` distinct from `team-set.ts`'s `TeamSet` | `TeamSet` is keyed by `(tournament_team_id, slot)` — an immutable capture. `UserSet` is keyed by `(user_team_id, slot)` and is **mutable**. They share the SPS/IVS sub-schemas (re-exported, not redefined) but the top-level entity has different invariants (nullable species/item/ability for drafts; user-mutable nickname/notes; no `paste_id`). Forcing one schema to model both would bloat the contract. |
| **Auto-persist surface = `upsertSet`** | repo | Every keystroke / field commit calls `upsertSet(id, slot, partial)`. Returns void. Caller (UI / CLI) doesn't await a full team re-read — the next `get` / `validate` reflects the change. |
| **CLI = thin wrapper over repo + data/** | `scripts/data/user-teams.ts` | Same shape as `scripts/data/ingest-labmaus.ts`. No business logic in argv parsing. |
| **Hard CHECK for closed sets, validator for emergent invariants** | per-stat ≤32 hard, total ≤66 soft | See §5 table. The DB layer enforces what's stable across all edit flows; the validator catches the things that depend on intent (saving a draft vs. saving for real). |
| **Defense-in-depth Tera absence** | schema `.strict()` everywhere + a property test | Per memory `regulation_m_a_no_tera.md`; one layer is too easy to regress. |

**Considered and rejected:**
- **Single `user_team_sets` row with a `revision_id` discriminator + `is_current=1` partial index** — rejected: more indexes, more JOINs to read the live team. The snapshot-per-save approach reads the current team in one PK lookup.
- **Storing revisions as a delta against the previous snapshot** — rejected: complex, premature, the data is small (~5 KB per snapshot × 5 = 25 KB per team).
- **Exposing every repo method as an Anthropic tool** — rejected: write-side tools are too easy to misfire from the agent loop. Read-side tools shipped (`get`/`list`/`listRevisions`/`validate`); writes await Slice 4's controlled surface. See §17 Q3.
- **Lifting the pokepaste parser into a generic `parseShowdownExport`** — rejected: it's already in `src/tools/pokepaste/transform.ts`. The user-teams adapter is the right place for the synthetic-id wrap.

---

## 8. Error model

| Class | Trigger | Severity | Where thrown | Where caught |
|---|---|---|---|---|
| `UserTeamValidationError` | `setStatus('saved')` with `validateTeam(...).errors.length > 0` | user error | `src/db/user-teams.ts::setStatus` | CLI `set-status` subcommand prints `.result.errors` JSON; future UI maps to inline form errors |
| `UserTeamNotFoundError` | repo read against unknown id | user error | `src/db/user-teams.ts` (`get` returns null instead — this is for `update`/`upsertSet`/`setStatus`/`delete`/`restoreRevision`) | CLI exits 1; future UI 404s |
| `UserTeamRevisionNotFoundError` | `restoreRevision` with bad `(team_id, revision_number)` | user error | `src/db/user-teams.ts::restoreRevision` | CLI exits 1 |
| `UserTeamError` | Base class for the family | — | — | — |
| `RosterDbError` (reused) | SQLite I/O on user_teams tables | infra | repo | callers; CLI exits 1 |
| `RosterDataError` (reused) | A persisted row fails domain schema on read (e.g. corrupt `validation_errors` JSON, or a snapshot in `user_team_revisions` that fails `UserTeamSchema`) | corruption | `parseOrThrow` in repo | tests; CLI fails loud |

The `UserTeamError` base class follows the same constructor as `RosterError` / `PokepasteError`: `(msg, opts?: { cause?: unknown; query?: unknown; team_id?: string })`. Storage-layer issues stay in the global `RosterDbError` umbrella per the labmaus precedent.

---

## 9. Reuse audit

| Module | Status | Notes |
|---|---|---|
| `src/tools/pokepaste/transform.ts::transformPaste` | **as-is** | Already a clean primitive. Adapter wraps with synthetic `tournament_team_id`. No lift required (Stage-2 Q3 resolved: the parser is already in `src/tools/`, not in `scripts/`). |
| `src/db/sets.ts::list` | **as-is** | `duplicateFromTournament` calls `sets.list({ tournament_team_id })` to read the source paste. |
| `src/db/tournaments.ts` | **as-is** | `duplicateFromTournament` reads tournament_teams via existing repo; no new methods needed. |
| `src/db/items.ts`, `abilities.ts`, `moves.ts`, `species.ts` | **as-is** | `validateTeam` consumes `.has` / `.get`. No changes. |
| `src/db/roster.ts::isLegalForFormat` (or equivalent — see existing `rosterMembership` join in `roster.ts`) | **as-is** | `validateTeam` calls it for `species_not_legal` / `species_not_legal_warning`. |
| `src/db/simple-repo.ts::parseOrThrow` | **as-is** | Used in `user-teams.ts` for `rowToTeamSet`-style parsing. |
| `src/db/simple-repo.ts::createSimpleRepo` | **NOT used** | `user_teams` is multi-table assembly + write path; bespoke per CLAUDE.md §10. Documented in §6. |
| `src/schemas/team-set.ts::SpsSchema`, `IvsSchema` | **re-exported** | `user-team.ts` uses the same SPS bounds (Champions invariant); re-exporting avoids drift. |
| `src/schemas/errors.ts` | **extended** | `UserTeamError` family added; existing classes untouched. |
| `src/db/drizzle-schema.ts` | **extended** | Three new tables added; existing tables untouched (memory `single_db_non_destructive_build.md`). |
| `src/db/tool-definitions.ts` | **extended** | Read-only Anthropic tool entries added. |
| `package.json` | **extended** | New `data:user-teams` script. |
| `better-sqlite3`, `drizzle-orm`, `drizzle-kit`, `zod`, `@anthropic-ai/sdk` | **as-is** | Already pinned. |

**No new dependencies introduced.** The existing in-repo primitives cover every need: the pokepaste parser is reused, ulid generation already exists in the labmaus / vgcguide ingest scripts (we'll factor into a tiny `src/db/ulid.ts` if it's not already shared — see §17 Q5), JSON parsing/stringifying is built-in.

---

## 10. Test strategy + ordering

User-approved order from flow §11 + brief: **schemas → validator (per-code) → parse-pokepaste → duplicate → auto-name → migration → repo CRUD → repo revisions → CLI smoke → existing-tests-stay-green guard.** Tests numbered USR-T1..USR-T34 in writing order. Pure-data exemption (CLAUDE.md §3) applies to schema-only tests USR-T1..USR-T6. Everything from USR-T7 onward is strict per-test Red→Green.

| # | Test file | Test name | Asserts | Min code to green |
|---|---|---|---|---|
| 1 | `tests/schemas/user-team.test.ts` | `UserTeamSchema parses minimal valid team` | round-trip via `safeParse` | schema body |
| 2 | `tests/schemas/user-team.test.ts` | `UserTeamSchema rejects tera_* fields (defense-in-depth)` | injecting `tera_type: "Fire"` fails | `.strict()` |
| 3 | `tests/schemas/user-team.test.ts` | `ValidationResult separates errors and warnings` | both arrays present, distinct | schema split |
| 4 | `tests/schemas/user-team.test.ts` | `UserSetSchema enforces per-stat 0..32` | 33 fails | bound on each `*_sps` |
| 5 | `tests/schemas/user-team.test.ts` | `UserTeamCreateArgsSchema accepts missing name (auto-generated)` | optional ok | `.optional()` |
| 6 | `tests/schemas/user-team.test.ts` | `UserTeamRevisionSchema validates nested snapshot` | nested `UserTeamSchema` round-trips | extension |
| 7 | `tests/db/migrations-0009.test.ts` | `migration 0009 creates three new tables idempotently` | run twice; no error; `sqlite_master` has the three tables | drizzle-kit-generated SQL |
| 8 | `tests/db/migrations-0009.test.ts` | `FK source_tournament_team_id ON DELETE SET NULL works` | seed user_team referring tournament_team; delete tournament; user_team's FK is NULL, team preserved | FK clause in schema |
| 9 | `tests/db/migrations-0009.test.ts` | `CASCADE on user_teams.delete removes sets and revisions` | seed; delete; counts go to 0 | FK clause |
| 10 | `tests/data/team-validate.test.ts` | `validateTeam emits species_unknown for unknown roster id` | one error, code matches, slot set | repo lookup |
| 11 | `tests/data/team-validate.test.ts` | `validateTeam emits species_not_legal for is_legal=0 species when target='saved'` | error, not warning | target_status branching |
| 12 | `tests/data/team-validate.test.ts` | `validateTeam emits species_not_legal_warning for is_legal=0 species when target='draft'` | warning, NOT in errors | target_status branching |
| 13 | `tests/data/team-validate.test.ts` | `validateTeam emits ability_not_legal` | per-slot error | species_abilities lookup |
| 14 | `tests/data/team-validate.test.ts` | `validateTeam emits move_not_legal per offending move` | one error per bad move | movepool lookup |
| 15 | `tests/data/team-validate.test.ts` | `validateTeam emits item_unknown` | per-slot error | items.has |
| 16 | `tests/data/team-validate.test.ts` | `validateTeam emits nature_unknown` | per-slot error | constant set |
| 17 | `tests/data/team-validate.test.ts` | `validateTeam emits sps_total_exceeded once for whole-team violation` | one error, slot null | sum check |
| 18 | `tests/data/team-validate.test.ts` | `validateTeam emits sps_per_stat_exceeded` | per-slot | direct check |
| 19 | `tests/data/team-validate.test.ts` | `validateTeam emits slot_empty only when target='saved'` | draft target → no error; saved target → error | gating |
| 20 | `tests/data/team-validate.test.ts` | `validateTeam emits duplicate_species` | once per dup pair | scan for collisions |
| 21 | `tests/data/team-validate.test.ts` | `validateTeam emits tera_present (programmer-bug guard)` | manually injected | property scan |
| 22 | `tests/data/team-validate.test.ts` | `validateTeam returns warnings array empty for fully legal team` | none | branch coverage |
| 23 | `tests/data/user-teams/parse-pokepaste.test.ts` | `parsePokepasteToTeam round-trips a known good fixture` | structural equality on a labmaus-captured pokepaste body | adapter wiring |
| 24 | `tests/data/user-teams/parse-pokepaste.test.ts` | `parsePokepasteToTeam returns partial team + raw_warnings on parse failure` | empty/malformed text → empty sets, one warning | catch-and-degrade |
| 25 | `tests/data/user-teams/duplicate-from-tournament.test.ts` | `duplicateFromTournament clones team_sets when present` | sets match by structure; FK populated | repo wiring |
| 26 | `tests/data/user-teams/duplicate-from-tournament.test.ts` | `duplicateFromTournament falls back to tournament_team_species when team_sets absent` | sets have species_id only, other fields null | fallback branch |
| 27 | `tests/data/user-teams/duplicate-from-tournament.test.ts` | `duplicateFromTournament throws UserTeamNotFoundError on bad ttid` | error class matches | guard |
| 28 | `tests/data/user-teams/auto-name.test.ts` | `autoGenerateName joins 1, 4, 6 species correctly` | 1: `"Sneasler"`; 4: `"A-B-C-D"`; 6: `"A-B-C-D + 2"` | algorithm |
| 29 | `tests/data/user-teams/auto-name.test.ts` | `autoGenerateName prefixes date on collision` | second team with same name gets `"YYYY-MM-DD <name>"` | unique check + prefix |
| 30 | `tests/data/user-teams/auto-name.test.ts` | `autoGenerateName respects user-provided name (no prefix)` | direct passthrough when caller passes one | (covered at repo layer; this asserts the override path) |
| 31 | `tests/db/user-teams.test.ts` | `create + get round-trip` | structural equality | INSERT + SELECT |
| 32 | `tests/db/user-teams.test.ts` | `list filters by status and origin` | seed 4; assert subset | conditional WHERE |
| 33 | `tests/db/user-teams.test.ts` | `update on a saved team creates a revision; on draft does not` | revision count delta | trigger matrix branch |
| 34 | `tests/db/user-teams.test.ts` | `upsertSet auto-persists with no revision` | seed draft; 12 upsertSet calls; revision count = 0 | upsert + no-revision |
| 35 | `tests/db/user-teams.test.ts` | `setStatus('saved') rejects on errors but tolerates warnings` | inject `species_not_legal_warning` only → save succeeds; inject `item_unknown` → throws `UserTeamValidationError` with `.result.errors[0].code = 'item_unknown'` | gate logic |
| 36 | `tests/db/user-teams.test.ts` | `deleteTeam cascades sets and revisions` | post-delete counts = 0 | FK |
| 37 | `tests/db/user-teams-revisions.test.ts` | `setStatus('saved') from draft creates revision #1` | listRevisions length 1 | recordRevision |
| 38 | `tests/db/user-teams-revisions.test.ts` | `5 saves keep all 5 revisions` | length 5, numbers 1..5 | retention |
| 39 | `tests/db/user-teams-revisions.test.ts` | `6th save evicts oldest (revision #1)` | length 5, numbers 2..6 | eviction |
| 40 | `tests/db/user-teams-revisions.test.ts` | `restoreRevision overwrites state and drops status to draft` | post-restore: team matches snapshot, status='draft', revision count unchanged | restore impl |
| 41 | `tests/db/user-teams-revisions.test.ts` | `restoreRevision throws UserTeamRevisionNotFoundError on bad number` | error class | guard |
| 42 | `tests/scripts/user-teams.test.ts` | `CLI from-paste --file <fixture> creates a draft` | exit 0, row exists | argv wiring |
| 43 | `tests/scripts/user-teams.test.ts` | `CLI from-tournament clones into a draft` | exit 0, source FK populated | argv wiring |
| 44 | `tests/scripts/user-teams.test.ts` | `CLI set-status saved exits 1 with error JSON when validation fails` | stderr contains code list | error path |
| 45 | `tests/scripts/user-teams.test.ts` | `CLI revisions + restore round-trip` | post-restore status=draft, snapshot matches | wiring |
| 46 | `tests/scripts/user-teams.test.ts` (or as a guard inside `tests/db/user-teams.test.ts`) | `existing labmaus / pokepaste / vgcguide / metavgc / pikalytics tests still pass with migration 0009 applied` | run `pnpm test`; all green | (guard — no new code; this is the gate Stage 5 ships against) |

**Total numbered tests:** 46 (USR-T1..USR-T46).

USR-T1..USR-T6 qualify for the §3 pure-data exemption; the implementor must disclose the batched scaffold in the Stage 4 commit message per the labmaus §18.4 finding. USR-T46 is a guard, not a new behavior — flag in change report so the reviewer scrutinizes the guard rather than treating it as coverage.

**Vacuous-green flag:** USR-T2 (Tera-strip) is vacuous if the schema correctly omits the field — it asserts a property that the type system already encodes. Implementor flags in change report so the reviewer can confirm the property holds in code rather than the test holding nothing.

---

## 11. Fixtures plan

All fixtures committed and immutable; filenames carry capture date or are derived from existing labmaus fixtures.

```
fixtures/user-teams/
  2026-05-08__pokepaste_known_good.txt           (a clean Showdown export, 6 sets, full completeness)
  2026-05-08__pokepaste_minimal_completeness.txt  (item+ability+1 move, no SPS, no nature)
  2026-05-08__pokepaste_malformed.txt             (random text — exercises catch-and-degrade)
  2026-05-08__pokepaste_with_tera_line.txt        (a paste containing `Tera Type: Fire` — must be stripped)
  2026-05-08__user_team_snapshot.json             (a `UserTeam` round-trip golden for revision restore)
```

Reuse labmaus's existing `fixtures/labmaus/2026-05-04__tournament_*.json` for the duplicate-from-tournament tests — no new tournament fixtures needed; the migration already targets a populated DB.

---

## 12. Cache + throttle implementation

**Not applicable:** user-teams has no external network surface. The pokepaste path is invoked **only via cached fixture text** (CLI `from-paste --file <path>`); Slice 1 does not fetch from `pokepast.es`. If a future slice wants to wire `from-paste --url <pokepast-url>`, it'll go through the existing `pokepaste.fetchPaste` tool (with its own cache + throttle) — out of scope here.

---

## 13. Ingest / build orchestration

**Not applicable in the labmaus / vgcguide sense:** there's no external ingest. `scripts/data/user-teams.ts` is an interactive-style CLI, not a periodic ingest. Its argv handling and exit-code matrix are documented in §2 (Ingest / CLI script).

---

## 14. Definition of Done mapping (CLAUDE.md §11)

| Box | This slice |
|---|---|
| Flow doc reviewed | YES — `docs/flows/user-teams.md` Stage 2 approved 2026-05-08 by Rodrigo. |
| Tech plan approved | THIS DOC — pending. |
| Failing test first (commit history visible) | enforced by Stage 4 ordering in §10; commit `test: red — user-teams`. |
| `pnpm test` passes | Stage 5 exit gate; USR-T46 guards existing-tests-stay-green. |
| `pnpm typecheck` passes | Stage 5 exit gate; strict TS, typed signatures everywhere per CLAUDE.md §10. |
| `pnpm lint` passes | Stage 5 exit gate. |
| New external data schema-validated and fixture-backed | `UserTeamSchema` + 5 fixtures; per-slice ref-table reuse means no new external schemas. |
| User-facing claim cited | not applicable (no agent-generated recommendations in this slice); future Slice 4 will inherit citation discipline from the lead-plan slice. |
| Docs touched | `package.json` script added; this plan; flow doc already exists. No SPEC.md (no new external tool). |
| Reviewer subagent ran | Stage 6. |

**Uncovered by this slice (explicitly):** UI (Slice 3), AI prompt path (Slice 4), lead-plan storage (`team-tactical-overview` slice), sharing / multi-user (out of scope by Q1).

---

## 15. Rollout / feature-flag

- **Always-on, no flag.** Three new tables, additive only; existing surfaces unaffected.
- **Migration ordering.** `0009_user_teams.sql` sits after the current head `0008_knowledge_multi_site_and_tags.sql`. Hard dependency: **`tournament_teams` must exist** (FK target). It does today (migration `0001_*`); the order is safe.
- **Per memory `single_db_non_destructive_build.md`:** the migration runs against the live `data/reg-m-a/db.sqlite` without touching tournaments / team_sets / species. Verified by USR-T46 (existing tests stay green).
- **Backfill:** none — the tables start empty. The first user-team is created via the CLI.

---

## 16. Risks + mitigations

1. **Pokepaste parser regression risk via reuse.** If a future change to `transformPaste` tightens its contract (e.g. requires a real labmaus tournament_team_id), the user-teams adapter's synthetic id breaks. **Mitigation:** USR-T23 round-trips through the real adapter; a regression in `transformPaste`'s contract surfaces as a test failure. The synthetic id pattern is documented in `parse-pokepaste.ts`'s TSDoc so reviewers can flag tightening contracts.
2. **Drizzle migration on a populated prod DB.** Migration 0009 must not touch existing data (memory `single_db_non_destructive_build.md`). **Mitigation:** USR-T46 asserts existing tests stay green; integration test seeds a tournament before migration, asserts row preservation.
3. **`species_not_legal_warning` ↔ `species_not_legal` overlap.** Easy to misclassify and accidentally block save on a draft containing an unreleased species. **Mitigation:** USR-T11 + USR-T12 assert the target_status branching directly; USR-T35 asserts `setStatus('saved')` tolerates warnings and rejects errors.
4. **Revision retention edge cases.** A race between two `setStatus('saved')` calls could double-evict or skip a number. **Mitigation:** v1 is single-user, single-process; the repo wraps each `recordRevision` in a transaction so the count is always consistent. Document the assumption; flag a multi-process concern in §17 for the future.
5. **`upsertSet` on a saved team silently doesn't revision (§6 Q4).** Counter-intuitive. **Mitigation:** TSDoc on `upsertSet` calls it out explicitly; USR-T34 asserts the no-revision behavior; flagged in §17 for explicit user confirmation.
6. **Auto-name collisions across `archived` teams.** The unique index on `name` doesn't filter by status; archiving a team and creating a new one with the same auto-name fails the unique check before the date-prefix logic can fire. **Mitigation:** auto-name's collision query checks `name = ?` regardless of status; date-prefix runs unconditionally on hit. USR-T29 covers basic collision; surface as §17 Q6 for archived edge case.

---

## 17. Open questions for plan review

1. **`validateTeam` signature: one `target_status` arg, or two helpers?** The `species_not_legal_warning` ↔ `species_not_legal` promotion and the `slot_empty` gating both depend on whether the caller intends to save. Two reasonable shapes:
   - (a) `validateTeam(team, deps, opts?: { target_status?: 'draft' | 'saved' })` — one entry point, opt-in arg, default `'draft'`.
   - (b) `validateForDraft(team, deps)` + `validateForSave(team, deps)` — explicit, two helpers, harder to misuse.
   **Proposal: (a)**, defaulting to `'draft'` (the auto-persist case). Confirm.
2. **Schema-violation code.** A `UserTeam` value passed to `validateTeam` that fails its own schema is a programmer bug (the repo just read it). Should the validator throw, or return a single `{ code: 'schema_violation', message }` error? **Proposal: throw `RosterDataError`** — it's a corruption signal, not a user error. Confirm.
3. **Anthropic tool surface.** This plan exposes only **read-only** tools (`get`, `list`, `listRevisions`, `validate`). Write-side (`create`, `update`, `upsertSet`, `setStatus`, `delete`, `restoreRevision`) is **NOT** agent-callable in Slice 1. **Proposal: confirm** — Slice 4 (AI prompt) wires its own controlled write surface. Alternative: ship `create` and `setStatus` agent-callable now so Slice 4 can compose without expanding the tool catalog mid-flight.
4. **`upsertSet` on a saved team — revision or not?** §6 Q4 — the trigger matrix says NO (auto-persist on a saved team should not silently fork its history). Counter-intuitive: a user editing a saved team via the builder UI would expect each edit to be recoverable. **Proposal: NO in v1.** The user calls `update` (which DOES revision) when they finish a logical edit batch, or re-runs `setStatus('saved')` (which DOES revision via re-entry into 'saved' from 'saved' — needs an explicit branch in `setStatus`). Confirm.
5. **ULID factory.** `src/db/ulid.ts` doesn't exist as a shared module today (the labmaus / vgcguide ingest scripts each have their own helper). **Proposal: factor into `src/db/ulid.ts` as part of this slice** so user-teams + future slices share. Flag if the user prefers we keep slice-local copies and refactor later.
6. **Auto-name collision against archived teams.** The unique index on `user_teams.name` matches all rows regardless of status. **Proposal: auto-name's collision query honors archived status (i.e. archived names are not considered collisions for new auto-names).** This requires either (a) excluding archived from the unique index (a partial index — drizzle-kit support TBD) or (b) keeping the unique index global and date-prefixing on collision regardless of archived status. **Proposal: (b)** — simplest, matches the flow's date-prefix algorithm exactly. Confirm.
7. **Empty-team auto-name.** Flow §5 doesn't pin the empty case. **Proposal: `"Untitled team"`** with date-prefix on collision (same algorithm). Confirm.
8. **Validator's `species_not_legal_warning` for `is_legal=0` species without a `target_status`.** When a species exists in `roster_membership` with `is_legal=0`, draft validation surfaces the warning. But what if the species isn't in `roster_membership` at all (a new species the roster build hasn't ingested)? **Proposal: that's `species_unknown` (error), not the warning** — unknown to the system is harder to recover from than known-illegal. Confirm.
9. **Stage 4 ordering of pure-data tests.** USR-T1..USR-T6 are eligible for the §3 pure-data exemption. Should Stage 4 batch them as a single commit, or run strict per-test Red→Green for them too? **Proposal: batch** — explicit disclosure in commit message per §18.4 finding from labmaus.

**Flow-doc gaps uncovered (for the reviewer):**
- **Empty-team auto-name** (Q7 above) — flow §5 doesn't pin.
- **Revision trigger on `upsertSet` of a saved team** (Q4 above) — flow §11 Q2 binds the retention number but not the trigger taxonomy.
- **`level` on `UserSet`** — pokepaste's `TeamSet.level` is dropped in the adapter (flow §4.2 doesn't carry a level column). Confirm — for Reg M-A every set is L50, but the team-builder UI may want to surface non-50 for hypothetical play.
- **Where `teamValidate` lives in the agent tool catalog** (Q3 above) — flow doc tags it as a "validate" subcommand only.

---

## 18. Stage 6 deferred TODOs (greppable)

Per memory `labmaus_pokepaste_deferred_todos.md`, deferred work is annotated as `// TODO(stage6-deferred):` at point of relevance and tabulated here so the reviewer can grep before starting the next slice.

| # | Concern | Inline anchor (Stage 5 will add) | Belongs in |
|---|---|---|---|
| 1 | UI hook surface — Slice 3 will need a `subscribeToTeam(id, callback)` for live auto-persist updates | `src/db/user-teams.ts` (TODO at `upsertSet`) | `user-teams-ui` slice |
| 2 | AI prompt write surface — Slice 4 will need a sanctioned `create` + `setStatus` Anthropic tool, possibly with a side-channel for the prompt origin payload | `src/db/tool-definitions.ts` | `user-teams-ai-prompt` slice |
| 3 | `vgcguide-pokepaste-ingest` dependency — once that slice ships, `tournament_teams` rows will gain `team_url` values that pokepaste-sets can resolve, and the duplicate path picks them up automatically (no schema change here) | (no inline; documented here) | dependency note |
| 4 | Multi-user / sharing — schema would need a `user_id` column on `user_teams` and `user_team_revisions` | (no inline; documented here) | future slice |
| 5 | Lead-plan storage attachment — `LeadPlan` per CLAUDE.md §7 lives in a separate slice; `user_teams` doesn't carry a lead-plan FK in v1 | (no inline) | `team-tactical-overview` slice |
| 6 | Level on `UserSet` — drop-from-adapter today; resurface if non-50 hypothetical play matters | `src/data/user-teams/parse-pokepaste.ts` (TODO at the level discard) | future slice |

---

## 19. Migration / change log

This is the slice's first plan revision. No prior approved version.

---
