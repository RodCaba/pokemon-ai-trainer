# Flow: user-teams (headless)

**Slug:** `user-teams`
**Status:** Stage 1 — flow draft
**Author:** Claude (Opus 4.7)
**Date:** 2026-05-08

## 1. Why this slice

Team creation is the foundational user-facing capability. Every downstream
feature — tactical overview scoring, lead-plan generation, agent recommendations
— operates on a stored, validated `Team`. Without it, the agent has nowhere to
write back proposed changes and the player has no canonical "this is my
team for next event" object.

This slice lands the **headless** layer: schema, repo, parse, validate, save.
A separate `user-teams-ui` slice layers Next.js routes on top.

Per CLAUDE.md §5 the canonical `Team` entity is "6 sets + win condition + lead
plan." This slice persists the first two; lead plan is generated downstream by
`team-tactical-overview`.

## 2. User flow

The user has four entry points. All four converge on the same persisted shape:

### 2.1 Paste from Pokepaste text

1. User opens the "Create team" surface (CLI for v1; UI in Slice 3).
2. User pastes Pokepaste text (single multi-set block, 1–6 sets).
3. System parses via the existing `pokepaste-hook.ts` parser.
4. System runs `validateTeam` (see §6).
5. On success: a new `user_team` row + 6 `user_team_set` rows are written.
   Status starts at `draft`. Auto-generated name (see §5). Raw paste text
   captured verbatim in `origin_payload`.
6. On parse or validation failure: the draft is **still saved** (auto-persist
   per §2 Q3) with `status = 'draft'` and `validation_errors` populated. The
   user can edit and re-validate without losing work.

### 2.2 Build from scratch

1. User opens "Create team — blank."
2. A new `user_team` is allocated immediately with `origin = 'builder'` and
   six empty slots. (Auto-persist: every keystroke / field commit writes through.)
3. User selects species per slot from the Reg M-A roster (autocomplete
   against `species` joined to `roster_membership.is_legal=1`).
4. Per slot: ability dropdown (constrained to legal abilities for that
   species), item autocomplete, nature, SPS spreads, four moves
   (constrained to species's movepool).
5. Auto-persist on each commit. `validateTeam` runs on every save and
   populates `validation_errors`; UI surfaces them but doesn't block writes.
6. User flips status to `saved` when satisfied.

### 2.3 Duplicate from a tournament team

1. User browses tournaments (existing `tournaments` / `tournament_teams`
   tables) — surface TBD in Slice 3, callable as a CLI in Slice 1.
2. User picks a `tournament_team_id`.
3. System reads the source rows (`tournament_team_species` × 6 + linked
   `team_sets` rows) and clones into `user_team_sets`.
4. New `user_team` row: `origin = 'duplicated_from_tournament'`,
   `source_tournament_team_id = <fk>`. Original is unchanged.
5. The duplicate opens in editable state — user can tweak SPS, swap an
   item, etc.

### 2.4 AI-prompted creation (DEFERRED to Slice 4)

This slice does **not** ship the AI path, but the schema must accommodate
`origin = 'ai_prompt'` so Slice 4 can land without a migration. The `origin`
enum includes the value from day one.

## 3. Tech flow

```
Pokepaste text ──► parsePokepasteText() ──┐
Builder payload  ─────────────────────────┤
tournament_team_id ─► duplicateFromTournament() ─► Team ──► validateTeam() ──► userTeams.upsert()
                                          │                       │
AI proposal (Slice 4) ────────────────────┘                       └─► validation_errors
                                                                       (non-blocking)
```

Reuse:

- `src/tools/pokepaste/parse.ts` — existing pokepaste parser
- `src/db/items.ts`, `src/db/abilities.ts`, `src/db/moves.ts`, `src/db/species.ts`
  — existing reference tables for validation
- The team-validate logic that lives somewhere today (likely in
  `src/data/team-validate.ts` or similar — flow-doc placeholder; tech plan
  will name the precise file).

New:

- `src/db/migrations/0009_user_teams.sql` — `user_teams` + `user_team_sets`
  tables.
- `src/db/drizzle-schema.ts` additions (`userTeams`, `userTeamSets`).
- `src/db/user-teams.ts` — repo with `create`, `get`, `list`, `update`,
  `delete`, `upsertSet`, `setStatus`.
- `src/data/user-teams/parse-pokepaste.ts` — thin wrapper around the
  existing pokepaste parser that maps to the `Team` shape.
- `src/data/user-teams/duplicate-from-tournament.ts` — clone path.
- `src/data/user-teams/auto-name.ts` — auto-generated name from species.
- `src/data/user-teams/validate.ts` — calls the central `validateTeam`
  and returns structured `ValidationError[]` for persistence.
- `scripts/data/user-teams.ts` — CLI: `create`, `list`, `show`,
  `delete`, `from-paste`, `from-tournament`, `validate`.

## 4. Schema (sketch — final lands in Stage 3 plan)

### 4.1 `user_teams`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | `ulid()` |
| `name` | TEXT NOT NULL | auto-generated; user-overridable |
| `description` | TEXT NULL | optional notes |
| `win_condition` | TEXT NULL | one-liner per CLAUDE.md §5 |
| `status` | TEXT NOT NULL CHECK IN ('draft','saved','archived') | default `'draft'` |
| `origin` | TEXT NOT NULL CHECK IN ('paste','builder','ai_prompt','duplicated_from_tournament') | |
| `origin_payload` | TEXT NULL | raw pokepaste text for `paste`; AI prompt for `ai_prompt`; null for others |
| `source_tournament_team_id` | TEXT NULL FK → `tournament_teams.id` | only set when `origin = 'duplicated_from_tournament'` |
| `validation_errors` | TEXT NOT NULL DEFAULT `'[]'` | JSON array of `{code, message, slot?}` |
| `created_at` | TEXT NOT NULL | ISO-8601 UTC |
| `updated_at` | TEXT NOT NULL | ISO-8601 UTC |
| `schema_version` | INTEGER NOT NULL | `1` |

### 4.2 `user_team_sets`

| Column | Type | Notes |
|---|---|---|
| `user_team_id` | TEXT FK → `user_teams.id` ON DELETE CASCADE | |
| `slot` | INTEGER 0..5 | |
| `species_id` | TEXT FK → `species.id` NULL | NULL allowed in `draft` |
| `nickname` | TEXT NULL | display only; never used in calcs |
| `item_id` | TEXT FK → `items.id` NULL | |
| `ability_id` | TEXT FK → `abilities.id` NULL | |
| `nature` | TEXT NULL CHECK IN (...known natures...) | |
| `hp_sps`/`atk_sps`/`def_sps`/`spa_sps`/`spd_sps`/`spe_sps` | INTEGER NOT NULL DEFAULT 0 | each 0..32 |
| `move_1_id`/`move_2_id`/`move_3_id`/`move_4_id` | TEXT FK → `moves.id` NULL | |
| `notes` | TEXT NULL | per-set notes |
| | | PK (`user_team_id`, `slot`) |

Constraints:

- SPS sum across the six SPS columns ≤ 66 (CHECK — but only enforced when
  status moves to `'saved'`; drafts may transiently exceed during edits and
  the validator surfaces the error).
- Per-stat 0..32 (CHECK).

## 5. Auto-generated name

Algorithm:

1. Read all six `user_team_sets` for the team in slot order.
2. For each non-null species, take its `display_name`.
3. Format: `"<First>-<Second>-..."` truncated at 4 species, suffix with
   `" + ${remaining_count}"` if 5–6.
4. Prefix with date stamp if there's already a team with the same generated
   name for this user (which is everyone, since it's single-user):
   `"2026-05-08 ${species_name}"`.

Example: `"Froslass-Glaceon-Aerodactyl-Garchomp + 2"` → if duplicate name
exists, becomes `"2026-05-08 Froslass-Glaceon-Aerodactyl-Garchomp + 2"`.

User-provided names override the auto-generation entirely (no prefix).

## 6. Validation contract

`validateTeam(team: Team): ValidationError[]` runs the following checks. Each
violation produces a structured error with a stable `code` so Slice 3 can map
to UI strings without parsing prose:

| Code | Trigger |
|---|---|
| `species_unknown` | `species_id` not in `species` |
| `species_not_legal` | not in `roster_membership` for `format='RegM-A'` with `is_legal=1` |
| `ability_not_legal` | `ability_id` not in `species_abilities` for the species |
| `move_not_legal` | `move_id` not in `species_movepool` for the species |
| `item_unknown` | `item_id` not in `items` |
| `nature_unknown` | not one of the 25 canonical natures |
| `sps_total_exceeded` | sum of 6 SPS > 66 |
| `sps_per_stat_exceeded` | any stat > 32 |
| `slot_empty` | (only at `status='saved'`) any of the 6 slots has null species |
| `duplicate_species` | same `species_id` in two slots |
| `tera_present` | reserved — Reg M-A has no Tera; flag if a future input attempts to set one |

Drafts may save with errors (auto-persist contract). `status='saved'`
requires zero errors — a `setStatus('saved')` call with non-empty
`validation_errors` returns a `UserTeamValidationError`.

## 7. Data in/out per stage

| Stage | Input | Output |
|---|---|---|
| `parsePokepasteText` | raw text | `Team` partial + raw text + warnings |
| `validateTeam` | `Team` | `ValidationError[]` |
| `duplicateFromTournament` | `tournament_team_id` | `Team` partial + `source_tournament_team_id` |
| `userTeams.create` | partial team + origin metadata | `user_teams` row id |
| `userTeams.upsertSet` | `user_team_id, slot, partial set` | row written |
| `userTeams.setStatus` | id + new status | row updated; validation gate on `'saved'` |
| `userTeams.list` | filter (origin?, status?) | array |
| `userTeams.get` | id | full team + sets |
| `userTeams.delete` | id | rows removed (cascade) |

## 8. Error / empty states

- **Pokepaste parse failure (malformed text)** → return a parse error;
  the draft can still be saved with `validation_errors = [{code: 'parse_failed',
  message}]` and the raw text retained so the user can edit.
- **Tournament team not found** → 404 from the duplicate path; nothing
  written.
- **Invalid `setStatus('saved')`** with errors → throws
  `UserTeamValidationError` listing all failures; status remains `'draft'`.
- **Empty team in `'saved'`** → blocked.
- **Cascading delete** of a tournament_team referenced as `source_*` →
  user_team's FK becomes NULL (ON DELETE SET NULL); the team is preserved.
  (Open question §11 #4.)

## 9. Success criteria

- Round-trip: paste a Pokepaste of a known tournament team → parse →
  validate (zero errors) → save → re-read → equals the input by structured
  comparison.
- Auto-persist: opening a builder team and committing 12 field changes
  produces 12 incremental writes; reading at any point shows the latest
  partial state.
- Tournament duplication: cloning a labmaus row produces a user_team that
  is structurally equal to the source rows after a join, with the FK set.
- Validator catches each of the 11 error codes via a dedicated test.
- CLI commands round-trip end-to-end on cached labmaus fixtures (no
  network).
- Existing labmaus / vgcguide / pikalytics tests stay green.

## 10. Out of scope (deferred)

- **UI** (Slice 3, `user-teams-ui`) — Next.js routes for create / edit / list.
- **AI-prompted creation** (Slice 4) — agent loop with knowledge retrieval.
- **vgcguide pokepaste tournament ingest** (separate slice
  `vgcguide-pokepaste-ingest`) — extends labmaus to follow pokepaste URLs
  found in vgcguide article bodies. Once it ships, those teams become
  duplicate-able sources for `user-teams` automatically (no `user-teams`
  schema change).
- **Sharing / multi-user** — single-user (Q1 confirmed).
- **Versioning** — no team-history table; updates overwrite. (Open
  question §11 #2.)
- **Lead plan storage** — that's the `team-tactical-overview` slice.

## 11. Open questions for Stage 2 review

1. **Where does `validateTeam` live today?** I described it as if it
   exists, but I haven't grepped to confirm. The tech plan resolves
   this — either we use the existing module or scaffold it.
2. **Versioning.** When the user edits a saved team, do we overwrite or
   keep history? My proposal: overwrite (single-user, no audit need).
   Confirm or say "keep last N revisions."
3. **Pokepaste parser ownership.** `pokepaste-hook.ts` exists for labmaus
   ingest — is it factored such that we can reuse it cleanly, or does it
   need to be lifted into `src/tools/pokepaste/parse.ts` as a shared
   primitive? Tech plan resolves.
4. **Tournament-team FK on delete.** If a tournament_team is ever deleted,
   should the user_team's `source_tournament_team_id` go NULL (preserve
   the team) or cascade-delete (lose the user team)? My proposal: SET
   NULL; the user team has its own life. Confirm.
5. **Species autocomplete: include unreleased / not-yet-legal Reg M-A
   species?** Champions occasionally adds species mid-format; do we let
   the user draft with a species that's not yet `is_legal=1`? My
   proposal: no, hard filter. Confirm.

## 12. Reviewed-by

Reviewed-by: _pending Stage 2_
