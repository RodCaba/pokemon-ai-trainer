# Tech Plan — Labmaus Tournaments

**Slug:** `labmaus-tournaments`
**Stage:** Stage 3 approved (2026-05-04). Stage 4 (red tests) pending.
**Approved-by:** Rodrigo Caballero (2026-05-04)
**Date:** 2026-05-04
**Author:** Tech Lead subagent
**Implements flow doc:** `/Users/rodrigo/src/pokemon-ai-trainer/docs/flows/labmaus-tournaments.md` (Stage 2 approved 2026-05-04 by Rodrigo Caballero)
**Memory citations:**
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/db_orm_drizzle.md`
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/data_layer_two_tier_db.md`
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/regulation_m_a_no_tera.md`
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/regulation_m_a_roster.md`

---

## 1. Goal recap

Ship a labmaus.net ingestion slice: two agent-callable HTTP tools (`labmaus.listTournaments`, `labmaus.getTournament`), a Drizzle-backed mirror of tournament metadata + per-team species rows, and a CLI ingest script that backfills Reg M-A Masters from 2026-04-06 to today and produces idempotent re-runs. Tera fields are stripped at the schema layer; pokepaste set ingestion is **deferred** (`team_url` is persisted as an opaque string and never fetched in this slice). Repository methods (`tournaments.list/get/teams_with/usage`) feed the meta-intelligence surface in the team builder and the lead planner's evidence layer downstream. Done means: ≥4 fixtures round-trip, two consecutive ingests produce zero row deltas, recomputed aggregates match labmaus's `pokemon[]` ordering for ≥3 fixtures (within tolerance), no `tera_*` field appears in any persisted row.

---

## 2. Module boundaries

All paths absolute under `/Users/rodrigo/src/pokemon-ai-trainer/`. New files only — existing files are extended where called out.

### Schemas (`src/schemas/`)

#### `src/schemas/tournament.ts` (new)
- **Single responsibility:** zod schemas + inferred types for everything in the labmaus tournament domain — both the **raw payload** shapes (`LabmausRawTournament`, `LabmausRawTeam`) and the **domain** shapes we persist (`TournamentResult`, `TournamentTeam`, `TournamentTeamSpecies`). Tool-input shapes (`LabmausListArgs`, `LabmausGetArgs`) and repo-input shapes (`TournamentFilter`, `TeamsWithArgs`, `UsageArgs`) live here too — one file per entity family matches the existing per-entity schema convention only loosely; tournaments are a tightly-coupled cluster, so consolidating reads better.
- **Exported surface:**
  ```ts
  export const TournamentSummarySchema: z.ZodObject<…>;
  export const TournamentDetailSchema: z.ZodObject<…>;
  export const LabmausRawTournamentSchema: z.ZodObject<…>; // raw API
  export const LabmausRawTeamSchema:       z.ZodObject<…>;
  export const TournamentResultSchema: z.ZodObject<…>;
  export const TournamentTeamSchema:   z.ZodObject<…>;
  export const TournamentTeamSpeciesSchema: z.ZodObject<…>;
  export const TournamentFilterSchema: z.ZodObject<…>;
  export const TeamsWithArgsSchema:    z.ZodObject<…>;
  export const UsageArgsSchema:        z.ZodObject<…>;
  export const UsageRowSchema:         z.ZodObject<…>;
  export const LabmausListArgsSchema:  z.ZodObject<…>;
  export const LabmausGetArgsSchema:   z.ZodObject<…>;
  export type TournamentSummary       = z.infer<typeof TournamentSummarySchema>;
  // …matching `type` exports for every schema above.
  ```
- **TSDoc obligations (per CLAUDE.md §10):** every exported schema and type carries a 6-element TSDoc block (summary, when-to-use, @returns/@throws as applicable for derived types, @example for the two tool-arg schemas).
- **Does NOT do:** any HTTP, any DB I/O, any species-id translation. Pure shape + validation.

#### `src/schemas/errors.ts` (extend)
- Add a `LabmausError` family alongside the existing `RosterError` / `CalcError` hierarchies. Same constructor pattern as `RosterError` (carries `.cause` and `.query`).
- **New exports:** `LabmausError`, `LabmausInputError`, `LabmausNetworkError`, `LabmausSchemaError`, `LabmausUnknownSpeciesError`.

### Tool layer (`src/tools/labmaus/`)

#### `src/tools/labmaus/SPEC.md` (new — written first per CLAUDE.md §8)
- **Single responsibility:** the tool spec doc. Inputs/outputs/edge-cases for `labmaus.listTournaments` and `labmaus.getTournament`. Documents the `tera_types` strip, the species-id translation, the cache key shape, the throttle policy, error semantics, the JSON-Schema descriptions used by the Anthropic SDK. Authored before any test or code (per CLAUDE.md §8 sub-bullet "Adding a new tool").

#### `src/tools/labmaus/client.ts` (new)
- **Single responsibility:** a thin HTTP client around the two labmaus endpoints. Enforces throttle, retry-with-exponential-backoff, and disk-cache. No domain mapping, no zod parsing — returns `unknown` JSON.
- **Exported surface:**
  ```ts
  export interface LabmausClientOptions {
    cacheDir: string;          // absolute path under data/cache/labmaus
    cacheTtlMs: number;        // default 24h
    throttleRps: number;       // default 1
    maxRetries: number;        // default 3
    backoffBaseMs: number;     // default 1000
    fetchImpl?: typeof fetch;  // injectable for tests
    clock?: () => number;      // injectable for tests
  }
  export interface LabmausClient {
    listCompletedTournaments(args: { regulation: string; from: string; to: string }): Promise<unknown>;
    getTournament(args: { id: number; language?: "en" }): Promise<unknown>;
  }
  export function createLabmausClient(opts: LabmausClientOptions): LabmausClient;
  ```
- **TSDoc:** full block on `createLabmausClient` and both interface methods.
- **Does NOT do:** validate, transform, or persist. Caller is responsible for handing the returned `unknown` to a zod parse.

#### `src/tools/labmaus/species-map.ts` (new)
- **Single responsibility:** translate a labmaus species identifier (`"006"`, `"038-a"`, `"479-w"`, plus the literal `"Basculegion ♂"` edge case) into our roster's Showdown-style canonical id. Pure function — DB lookup happens through `species_alias_labmaus` repo, which the caller passes in.
- **Exported surface:**
  ```ts
  export interface SpeciesMapDeps {
    aliasRepo: SimpleRepo<SpeciesAlias>;   // from species-alias-labmaus.ts
    db: Db;
  }
  export function labmausIdToRosterId(
    labmausId: string,
    displayName: string | null,
    deps: SpeciesMapDeps,
  ): string | null;
  export function labmausIdToRosterIdOrThrow(...): string;   // throws LabmausUnknownSpeciesError
  ```
- **Does NOT do:** populate the alias table (the ingest script seeds it from a committed JSON in `data/labmaus/species-alias-seed.json`); fetch from labmaus; mutate DB.

#### `src/tools/labmaus/transform.ts` (new)
- **Single responsibility:** map raw labmaus payloads (validated by `LabmausRawTournamentSchema`) into our `TournamentResult` + `TournamentTeam[]` + `TournamentTeamSpecies[]` domain rows. Strips `tera_types` (defense-in-depth — schema also strips). Preserves `placement: null`. Generates `player_key = trim(lower(player))` per Q10.
- **Exported surface:**
  ```ts
  export interface TransformedTournament {
    tournament: TournamentResult;
    teams: TournamentTeam[];
    species: TournamentTeamSpecies[];   // flattened, ordered (team_id, slot)
  }
  export function transformTournament(
    raw: LabmausRawTournament,
    fetchedAt: string,
    deps: SpeciesMapDeps,
  ): TransformedTournament;
  ```
- **Does NOT do:** HTTP, DB writes, cross-check.

#### `src/tools/labmaus/list-tournaments.ts` (new — public tool fn)
- **Single responsibility:** the `labmaus.listTournaments` agent-callable tool. Validates input via `LabmausListArgsSchema`, calls the client, validates output via `z.array(TournamentSummarySchema)`, returns.
- **Exported surface:**
  ```ts
  export async function listTournaments(
    args: LabmausListArgs,
    deps: { client: LabmausClient },
  ): Promise<TournamentSummary[]>;
  export const listTournamentsToolDefinition: Tool;   // Anthropic SDK Tool
  ```

#### `src/tools/labmaus/get-tournament.ts` (new — public tool fn)
- **Single responsibility:** the `labmaus.getTournament` agent-callable tool. Validates input, calls the client, validates raw output via `LabmausRawTournamentSchema`, then `transformTournament` to produce the `TournamentDetail` (overview + teams + species rows already mapped to roster ids).
- **Exported surface:**
  ```ts
  export async function getTournament(
    args: LabmausGetArgs,
    deps: { client: LabmausClient; speciesMap: SpeciesMapDeps },
  ): Promise<TournamentDetail>;
  export const getTournamentToolDefinition: Tool;
  ```

### DB layer (`src/db/`)

#### `src/db/drizzle-schema.ts` (extend, do NOT replace)
- Add four `sqliteTable` declarations: `tournaments`, `tournamentTeams`, `tournamentTeamSpecies`, `speciesAliasLabmaus`. Reuse the file's existing style (`check`, `index`, `uniqueIndex` from `drizzle-orm/sqlite-core`). FK from `tournamentTeamSpecies.rosterId` → `species.id`.

#### `src/db/migrations/0001_<auto>.sql` (new — drizzle-kit generated)
- Generated by `pnpm drizzle-kit generate` after the schema additions land. Filename auto-numbered after `0000_square_meltdown.sql` (likely `0001_*.sql`).

#### `src/db/tournaments.ts` (new — bespoke repo)
- **Single responsibility:** the bespoke tournaments repo. Implements `list`, `get`, `teams_with`, `usage`, plus the package-private `upsertTournament(db, transformed): void` used by the ingest script. Cannot use `createSimpleRepo` because: (a) `get` joins three tables (tournament + teams + species), (b) `teams_with` requires set-intersection over species rows, (c) `usage` is a multi-aggregate group-by. Per CLAUDE.md §10 the factory deliberately doesn't generalize that far.
- **Exported surface (signatures only — bodies in Stage 5):**
  ```ts
  export function list(db: Db, filter: TournamentFilter): TournamentResult[];
  export function get(db: Db, id: string): TournamentResult | null;
  export function teams_with(db: Db, args: TeamsWithArgs): TournamentTeam[];
  export function usage(db: Db, args: UsageArgs): UsageRow[];
  export function upsertTournament(db: Db, t: TransformedTournament): void;   // ingest-only
  export function recomputeAggregatesForTournament(
    db: Db, tournamentId: string,
  ): UsageRow[];                                                              // cross-check support
  ```
- **TSDoc:** all six elements per export per CLAUDE.md §10. Mirrors `roster.ts`.

#### `src/db/species-alias-labmaus.ts` (new — `createSimpleRepo`)
- **Single responsibility:** read-only ref table mapping labmaus dex-id → roster id. Per CLAUDE.md §10 ("New DB reference tables use `createSimpleRepo`"). ~30 lines.
- **Shape (sketch — final lands in Stage 5):**
  ```ts
  interface Row { id: string; rosterId: string; sourceJson: string; }
  const repo = createSimpleRepo<Row, SpeciesAlias>({
    name: "species_alias_labmaus",
    table: speciesAliasLabmaus,
    idColumn: speciesAliasLabmaus.id,
    displayNameColumn: speciesAliasLabmaus.id,   // labmaus_id is the only "name"; no display
    rowToEntity: (r) => parseOrThrow(SpeciesAliasSchema, { … }, "species_alias_labmaus", r.id),
  });
  export function list(db, format): SpeciesAlias[] { return repo.list(db, format); }
  export function get(db, labmausId, format): SpeciesAlias | null { return repo.get(db, labmausId, format); }
  export function has(db, labmausId, format): boolean { return repo.has(db, labmausId, format); }
  ```
- **TSDoc:** every wrapper carries the six-element block.

#### `src/db/tool-definitions.ts` (extend)
- Append `tournamentsListTool`, `tournamentsGetTool`, `tournamentsTeamsWithTool`, `tournamentsUsageTool`. Reuses the local `tool(...)` helper and the `RegMAFormat` literal.

### Ingest script (`scripts/data/`)

#### `scripts/data/ingest-labmaus.ts` (new)
- **Single responsibility:** CLI entry point for `pnpm data:ingest:labmaus`. Argv: `--from YYYY-MM-DD` `--to YYYY-MM-DD` `--mode full|incremental` `--db <path>` `--no-network` (replays cache only). Walks 30-day chunks oldest→newest, calls `listTournaments`, parallel-fetches `getTournament` (cap 4 concurrent), upserts via `tournaments.upsertTournament`, runs the cross-check pass, prints a report. Exit 0 on success including bounded cross-check warnings; exit 1 on schema drift, unknown species id, network exhaustion.

### Data + fixtures

#### `data/labmaus/species-alias-seed.json` (new, committed)
- Hand-curated mapping table built from observed labmaus ids in fixtures + a one-shot manual sweep. The ingest script reads it, validates against `roster.has`, and upserts into `species_alias_labmaus`. Build fails if any seed entry references an unknown roster id.

#### `data/cache/labmaus/` (new, **gitignored**)
- Disk cache for raw API responses. Path under `.gitignore`: `data/cache/labmaus/`.

#### `fixtures/labmaus/` (new, committed, immutable)
- See §12.

### Package scripts (`package.json` extend)
- `"data:ingest:labmaus": "tsx scripts/data/ingest-labmaus.ts"`.

### Tests

```
tests/schemas/tournament.test.ts
tests/tools/labmaus/species-map.test.ts
tests/tools/labmaus/transform.test.ts
tests/tools/labmaus/client.test.ts
tests/tools/labmaus/list-tournaments.test.ts
tests/tools/labmaus/get-tournament.test.ts
tests/tools/labmaus/tool-definitions.test.ts
tests/db/species-alias-labmaus.test.ts
tests/db/tournaments.test.ts
tests/db/tournaments-aggregate-cross-check.test.ts
tests/db/tournaments-no-tera.test.ts
tests/scripts/ingest-labmaus.test.ts
tests/scripts/ingest-labmaus-idempotency.test.ts
tests/contract/labmaus-live.test.ts          (gated by RUN_CONTRACT_TESTS=1)
```

---

## 3. Data schemas (zod, full bodies — sketch; final lands in Stage 5)

```ts
// src/schemas/tournament.ts
import { z } from "zod";

const ISODate     = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ISODateTime = z.string().datetime({ offset: false });

// ---------- raw labmaus payloads (defensive shapes) ----------
export const LabmausRawTeamSchema = z.object({
  id:          z.number().int().nonnegative(),
  player:      z.string(),
  country:     z.string().length(2).nullable().optional().transform(v => v ?? null),
  placement:   z.number().int().positive().nullable().optional().transform(v => v ?? null),
  record:      z.string(),
  team:        z.array(z.string()).length(6),       // labmaus dex ids
  team_names:  z.array(z.string()).length(6),
  team_url:    z.string().url(),
}).passthrough();

export const LabmausRawTournamentSchema = z.object({
  overview: z.object({
    id:               z.number().int().positive(),
    tournament_code:  z.string().min(1).nullable().optional().transform(v => v ?? null),
    name:             z.string().min(1),
    organizer:        z.string().min(1).nullable().optional().transform(v => v ?? null),
    source:           z.string().min(1).nullable().optional().transform(v => v ?? null),
    regulation:       z.string(),                   // "Regulation Set M-A"
    division:         z.enum(["Masters","Seniors","Juniors"]),
    status:           z.enum(["official","unofficial"]),
    date:             ISODate,
    num_players:      z.number().int().nonnegative(),
    num_phase_2:      z.number().int().nonnegative().nullable().optional().transform(v => v ?? null),
  }).passthrough(),
  teams: z.array(LabmausRawTeamSchema),
  pokemon:      z.array(z.unknown()).optional(),    // kept for cross-check only
  items:        z.array(z.unknown()).optional(),
  moves:        z.array(z.unknown()).optional(),
  compositions: z.array(z.unknown()).optional(),
  // tera_types stripped UNCONDITIONALLY (Reg M-A invariant per regulation_m_a_no_tera.md)
}).transform((raw) => {
  // defense-in-depth: drop ANY top-level key whose name contains "tera"
  const out = { ...raw } as Record<string, unknown>;
  for (const k of Object.keys(out)) if (/tera/i.test(k)) delete out[k];
  return out as Omit<typeof raw, "tera_types"> & Record<string, unknown>;
});

// ---------- listTournaments ----------
export const TournamentSummarySchema = z.object({
  id:           z.number().int().positive(),
  date:         ISODate,
  name:         z.string().min(1),
  regulation:   z.string(),
  division:     z.enum(["Masters","Seniors","Juniors"]),
  num_players:  z.number().int().nonnegative(),
  status:       z.enum(["official","unofficial"]),
}).strict();

// ---------- domain ----------
export const TournamentSourceSchema = z.object({
  schema_version: z.literal(1),
  site:           z.literal("labmaus"),
  site_source:    z.string().min(1).nullable(),    // "limitless" etc.
  source_url:     z.string().url(),
  fetched_at:     ISODateTime,
}).strict();

export const TournamentResultSchema = z.object({
  schema_version:   z.literal(1),
  id:               z.string().regex(/^labmaus:\d+$/),
  external_id:      z.number().int().positive(),
  tournament_code:  z.string().nullable(),
  name:             z.string().min(1),
  organizer:        z.string().nullable(),
  format:           z.literal("RegM-A"),
  division:         z.enum(["Masters","Seniors","Juniors"]),
  status:           z.enum(["official","unofficial"]),
  date:             ISODate,
  num_players:      z.number().int().nonnegative(),
  num_phase_2:      z.number().int().nonnegative().nullable(),
  source:           TournamentSourceSchema,
}).strict();

export const TournamentTeamSchema = z.object({
  schema_version:    z.literal(1),
  id:                z.string().regex(/^labmaus:\d+:\d+$/),
  tournament_id:     z.string().regex(/^labmaus:\d+$/),
  external_team_id:  z.number().int().nonnegative(),
  player:            z.string(),
  player_key:        z.string(),                    // generated; trim(lower(player))
  country:           z.string().length(2).nullable(),
  placement:         z.number().int().positive().nullable(),
  record:            z.string(),
  team_url:          z.string().url(),
  fetched_at:        ISODateTime,
}).strict();

export const TournamentTeamSpeciesSchema = z.object({
  team_id:    z.string().regex(/^labmaus:\d+:\d+$/),
  slot:       z.number().int().min(0).max(5),
  labmaus_id: z.string().min(1),
  roster_id:  z.string().regex(/^[a-z0-9-]+$/),     // Showdown-style; hyphens allowed
}).strict();

export const TournamentDetailSchema = z.object({
  tournament: TournamentResultSchema,
  teams:      z.array(TournamentTeamSchema),
  species:    z.array(TournamentTeamSpeciesSchema),
}).strict();

// ---------- repo input shapes ----------
export const TournamentFilterSchema = z.object({
  format:         z.literal("RegM-A"),
  date_from:      ISODate.optional(),
  date_to:        ISODate.optional(),
  division:       z.enum(["Masters","Seniors","Juniors"]).optional(),
  status:         z.enum(["official","unofficial"]).optional(),
}).strict();

export const TeamsWithArgsSchema = z.object({
  format:         z.literal("RegM-A"),
  species:        z.array(z.string().min(1)).min(1).max(6),  // canonical roster ids
  lookback_days:  z.number().int().positive().optional(),
  min_placement:  z.number().int().positive().optional(),
}).strict();

export const UsageArgsSchema = z.object({
  format:         z.literal("RegM-A"),
  lookback_days:  z.number().int().positive(),
  weight_by:      z.enum(["appearances","wins","tournament_weight"]).default("appearances"),
}).strict();

export const UsageRowSchema = z.object({
  kind:            z.enum(["species","item","move","core"]),
  key:             z.string(),                              // canonical roster id, item id, etc.
  display_label:   z.string(),
  appearances:     z.number().int().nonnegative(),
  total_teams:     z.number().int().nonnegative(),
  usage_percent:   z.number().min(0).max(100),
  citations:       z.array(z.string()).default([]),         // tournament ids
}).strict();

// ---------- tool-arg shapes ----------
export const LabmausListArgsSchema = z.object({
  regulation:  z.literal("RegM-A"),
  date_range:  z.object({ from: ISODate, to: ISODate }).strict(),
  status:      z.enum(["official","unofficial"]).optional(),
  division:    z.enum(["Masters","Seniors","Juniors"]).optional(),
}).strict();

export const LabmausGetArgsSchema = z.object({
  id: z.number().int().positive(),
}).strict();

export type TournamentSummary       = z.infer<typeof TournamentSummarySchema>;
export type TournamentResult        = z.infer<typeof TournamentResultSchema>;
export type TournamentTeam          = z.infer<typeof TournamentTeamSchema>;
export type TournamentTeamSpecies   = z.infer<typeof TournamentTeamSpeciesSchema>;
export type TournamentDetail        = z.infer<typeof TournamentDetailSchema>;
export type TournamentFilter        = z.infer<typeof TournamentFilterSchema>;
export type TeamsWithArgs           = z.infer<typeof TeamsWithArgsSchema>;
export type UsageArgs               = z.infer<typeof UsageArgsSchema>;
export type UsageRow                = z.infer<typeof UsageRowSchema>;
export type LabmausListArgs         = z.infer<typeof LabmausListArgsSchema>;
export type LabmausGetArgs          = z.infer<typeof LabmausGetArgsSchema>;
export type LabmausRawTournament    = z.infer<typeof LabmausRawTournamentSchema>;
export type LabmausRawTeam          = z.infer<typeof LabmausRawTeamSchema>;
```

The `tera_types` strip is in two places by design: (1) the raw schema's `.transform` removes any top-level key matching `/tera/i`, and (2) the strict domain schemas have no Tera field defined, so anything that slipped through would fail validation. A property test (§11) asserts no field named `tera*` exists in any persisted row.

`placement: null` is preserved end-to-end (swiss-only events; never inferred).

---

## 4. Tool contracts

### 4.1 `labmaus.listTournaments`

```ts
async function listTournaments(
  args: LabmausListArgs,
  deps: { client: LabmausClient },
): Promise<TournamentSummary[]>;
```

**Anthropic SDK tool description** (full text lands in Stage 5; sketch):

> `labmaus_list_tournaments` — list completed Pokemon Champions Reg M-A tournaments in a date range, sourced from labmaus.net. Returns tournament summaries (id, date, name, division, num_players, status). Use this BEFORE `labmaus_get_tournament` to discover tournament ids in a window. For tournament details (teams, placements, team URLs) call `labmaus_get_tournament` with an id from this list.

**JSON Schema:** generated via `zodToJsonSchema(LabmausListArgsSchema, { target: "openApi3", $refStrategy: "none" })` — same pipeline as `src/db/tool-definitions.ts`.

**Pre-conditions:** `args.date_range.from <= args.date_range.to`. `regulation === "RegM-A"`.
**Post-conditions:** every returned summary has `regulation: "Regulation Set M-A"` (we rewrite `"RegM-A"` → `"Regulation Set M-A"` for the upstream URL; the response is then re-validated).

**Cache key:** `list/${regulation}/${from}_${to}/${status ?? "any"}/${division ?? "any"}`.
**Throttle:** uses `client`'s shared limiter (1 rps default).
**Errors:** `LabmausInputError` (zod fail on input), `LabmausNetworkError` (HTTP exhaustion), `LabmausSchemaError` (response shape rejected).

### 4.2 `labmaus.getTournament`

```ts
async function getTournament(
  args: LabmausGetArgs,
  deps: { client: LabmausClient; speciesMap: SpeciesMapDeps },
): Promise<TournamentDetail>;
```

**Anthropic SDK tool description** (sketch):

> `labmaus_get_tournament` — fetch the full payload for a single labmaus tournament: overview, all registered teams with placements/records/countries/pokepaste URLs, and per-team species composition mapped to canonical roster ids. Strips the `tera_types` field unconditionally (Reg M-A has no Terastallization). Use after `labmaus_list_tournaments` returns ids you want to drill into. Does NOT fetch pokepaste set details — use the future `pokepaste_*` tools for that (deferred).

**Pre-conditions:** `args.id` is a positive integer (zod-checked).
**Post-conditions:** `result.species.length === result.teams.length * 6`; every `roster_id` resolves through `roster.has`; no top-level field name contains `tera`.

**Cache key:** `tournament/${id}`.
**Errors:** `LabmausInputError`, `LabmausNetworkError`, `LabmausSchemaError`, `LabmausUnknownSpeciesError` (any species id failed translation; carries the offending labmaus id and team id).

### 4.3 `SPEC.md` outline

Mandatory sections per CLAUDE.md §8:
1. Inputs (zod schemas verbatim).
2. Outputs (zod schemas verbatim).
3. Edge cases — empty windows, swiss-only events (`placement: null`), single-phase events (`num_phase_2: null`), missing `country`, the `"Basculegion ♂"` literal, `tournament_code: null` on some events.
4. Cache + throttle policy.
5. Error matrix (which exception when, with examples).
6. Citation rules — every record carries `source_url = https://labmaus.net/tournaments/${id}` + `fetched_at`.
7. Reg M-A hygiene clause — Tera strip is mandatory.
8. Out-of-scope: pokepaste fetching, cross-source dedup, division != Masters in v1.

---

## 5. Drizzle schema additions (sketch — final lands in Stage 5)

Per memory `db_orm_drizzle.md`: declarations live in `src/db/drizzle-schema.ts`; migration generated by `drizzle-kit generate`; never hand-edit the generated SQL.

```ts
export const tournaments = sqliteTable("tournaments", {
  id:               text("id").primaryKey(),                    // "labmaus:56757"
  externalId:       integer("external_id").notNull(),
  tournamentCode:   text("tournament_code"),
  name:             text("name").notNull(),
  organizer:        text("organizer"),
  format:           text("format").notNull(),                   // "RegM-A"
  division:         text("division").notNull(),
  status:           text("status").notNull(),
  date:             text("date").notNull(),                     // ISO YYYY-MM-DD
  numPlayers:       integer("num_players").notNull(),
  numPhase2:        integer("num_phase_2"),
  sourceSite:       text("source_site").notNull(),              // "labmaus"
  sourceSiteSource: text("source_site_source"),                 // "limitless" | null
  sourceUrl:        text("source_url").notNull(),
  fetchedAt:        text("fetched_at").notNull(),
}, (t) => [
  uniqueIndex("tournaments_site_external_uq").on(t.sourceSite, t.externalId),
  check("tournaments_format_regma",     sql`${t.format}   = 'RegM-A'`),
  check("tournaments_division_valid",   sql`${t.division} IN ('Masters','Seniors','Juniors')`),
  check("tournaments_status_valid",     sql`${t.status}   IN ('official','unofficial')`),
  index("idx_tournaments_format_date").on(t.format, t.date),
]);

export const tournamentTeams = sqliteTable("tournament_teams", {
  id:              text("id").primaryKey(),                     // "labmaus:56757:244471"
  tournamentId:    text("tournament_id").notNull().references(() => tournaments.id, { onDelete: "cascade" }),
  externalTeamId:  integer("external_team_id").notNull(),
  player:          text("player").notNull(),
  playerKey:       text("player_key").notNull(),
  country:         text("country"),
  placement:       integer("placement"),
  record:          text("record").notNull(),
  teamUrl:         text("team_url").notNull(),
  fetchedAt:       text("fetched_at").notNull(),
}, (t) => [
  uniqueIndex("tournament_teams_tournament_external_uq").on(t.tournamentId, t.externalTeamId),
  index("idx_tournament_teams_tournament_placement").on(t.tournamentId, t.placement),
  index("idx_tournament_teams_player_key").on(t.playerKey),
  check("tournament_teams_country_iso2",
        sql`${t.country} IS NULL OR length(${t.country}) = 2`),
  check("tournament_teams_placement_positive",
        sql`${t.placement} IS NULL OR ${t.placement} > 0`),
]);

export const tournamentTeamSpecies = sqliteTable("tournament_team_species", {
  teamId:     text("team_id").notNull().references(() => tournamentTeams.id, { onDelete: "cascade" }),
  slot:       integer("slot").notNull(),
  labmausId:  text("labmaus_id").notNull(),
  rosterId:   text("roster_id").notNull().references(() => species.id),
}, (t) => [
  primaryKey({ columns: [t.teamId, t.slot] }),
  check("tournament_team_species_slot_range", sql`${t.slot} BETWEEN 0 AND 5`),
  index("idx_tournament_team_species_roster_id").on(t.rosterId),
]);

export const speciesAliasLabmaus = sqliteTable("species_alias_labmaus", {
  id:         text("id").primaryKey(),                          // labmaus dex-id ("038-a")
  rosterId:   text("roster_id").notNull().references(() => species.id),
  sourceJson: text("source_json").notNull(),
}, (t) => [
  index("idx_species_alias_labmaus_roster_id").on(t.rosterId),
]);
```

**Migration:** generated as `src/db/migrations/0001_<auto-name>.sql` by drizzle-kit. The `drizzle.config.ts` already exists from the roster slice. Per memory `db_orm_drizzle.md`, never hand-edit generated SQL.

---

## 6. Repository design

### 6.1 `src/db/tournaments.ts` (bespoke)

Same pattern as `roster.ts`: `WeakMap<Db, Prepared>` of pre-compiled statements; one bundle constructor per logical query.

| Method | SQL strategy | Indexes used |
|---|---|---|
| `list(db, filter)` | `SELECT * FROM tournaments WHERE format=? AND (date>=? AND date<=?) AND division=? AND status=? ORDER BY date DESC, id ASC` (filter clauses conditionally appended via Drizzle's `and(...optional)`) | `idx_tournaments_format_date` |
| `get(db, id)` | Three prepared statements: tournament-by-id, teams-by-tournament-id (ORDER BY placement NULLS LAST, external_team_id), species-by-team-id. Assemble in JS into a `TournamentResult` plus joined relations the caller asks for. v1 returns just the `TournamentResult`; team/species joins are exposed via `teams_with` + a future `tournaments.teams(id)` if needed (not in flow §5). | PK lookups + cascade indexes |
| `teams_with(db, args)` | Subquery: `SELECT team_id FROM tournament_team_species WHERE roster_id IN (?,?,...) GROUP BY team_id HAVING COUNT(DISTINCT roster_id) = ?`. Then join to `tournament_teams` and `tournaments` for filtering by `format`, `lookback_days` (computed against `tournaments.date`), `min_placement`. | `idx_tournament_team_species_roster_id`, `idx_tournament_teams_tournament_placement` |
| `usage(db, args)` | Single grouped query whose `kind` argument selects the dimension: `species` (group by `tournament_team_species.roster_id`), `item` and `move` (join `team_sets` from the `pokepaste-sets` sibling slice; for `move`, expand `team_sets.moves_json` via `json_each`), `core` (2-mon co-occurrences over `tournament_team_species`). Filter by date window + format, compute `appearances` and `usage_percent = 100.0 * appearances / total_teams`. v1 ships **all four dimensions on day one** because `pokepaste-sets` ships in parallel (per `docs/plans/pokepaste-sets.md` and flow Q8 of that slice; the previous deferral is removed). | `idx_tournament_team_species_roster_id`, `idx_tournaments_format_date`, `idx_team_sets_item`, `idx_team_sets_species` (from pokepaste-sets) |
| `upsertTournament(db, t)` | Single transaction. `INSERT … ON CONFLICT(id) DO UPDATE SET ...` for tournament; `DELETE FROM tournament_teams WHERE tournament_id = ?` then bulk insert (simpler than per-team upsert; species cascades). | unique constraint |
| `recomputeAggregatesForTournament(db, id)` | Scoped variant of `usage` for cross-check — returns the per-species ranking for one tournament. | same as `usage` |

All exported functions get full TSDoc per CLAUDE.md §10. Errors wrap as `RosterDbError` (we reuse the existing class — labmaus shares storage with roster, so `RosterDbError` is the right umbrella for "SQLite I/O failed"; tool-layer errors stay in the new `LabmausError` family).

### 6.2 `src/db/species-alias-labmaus.ts` (`createSimpleRepo`)

The factory fits perfectly — single table, lookup by `id`, no display_name, no joins. Per CLAUDE.md §10: ~30-line file. We pass `idColumn === displayNameColumn` to the factory and rely on the `byId` path; the `byDisplayName` branch is harmless dead code (factory returns `null` on miss). Justified deviation noted in TSDoc.

### 6.3 Why `tournaments` cannot use the factory (justification per CLAUDE.md §10)

The factory generalizes (a) one table, (b) two indexes (id, display_name), (c) a `rowToEntity`. It deliberately stops there. `tournaments.get` joins three tables; `teams_with` requires an N-species set-intersection; `usage` is a multi-row group-by aggregate; `upsertTournament` is a transactional write. None of these are factorable without bloating `simple-repo.ts` past its single responsibility. Same reasoning that kept `roster.ts` bespoke applies here.

---

## 7. Architecture patterns + the why

| Pattern | Where it lands | Why this slice |
|---|---|---|
| **Repository pattern** | `src/db/tournaments.ts`, `src/db/species-alias-labmaus.ts` | Same reasoning as `roster.ts`: one narrow seam per concern; prepared statements + zod parsing live in one place; agent code never sees raw SQL. |
| **Ports-and-adapters / hexagonal** | `LabmausClient` interface vs. `createLabmausClient` impl; tool fns take `deps` injected (client, speciesMap) | Lets us pass a fake `fetchImpl` and a `:memory:` Db in tests with no module-level mock plumbing. Mirrors the way `damage-calc` injects `Generations.get(0)`. |
| **Anti-corruption layer** | `transform.ts` between labmaus's flat dex-string shape and our roster-id + provenance shape | Keeps the ugliness of `"038-a"` / `"Basculegion ♂"` in one file; downstream code never sees a labmaus id. |
| **Schema-first (zod)** | `src/schemas/tournament.ts` is the contract; types derive via `z.infer`; both ends of the network boundary parse before trust | Per CLAUDE.md §5. |
| **Command/query split inside the repo** | `list`/`get`/`teams_with`/`usage` are read-only queries with no side effects; `upsertTournament`/`recomputeAggregates…` are commands callable only by the ingest script | Lets readonly DB handles power the agent at runtime; only the ingest opens read-write. |
| **Read-through cache** | `client.ts` checks `data/cache/labmaus/...` before fetching; cache TTL 24h | Cold-start backfill replays from disk on dev iteration; matches Q7. |
| **Idempotent upsert keyed on `(source_site, external_id)`** | Unique index on `tournaments`; cascading delete-then-insert for teams | Per flow §2.6 idempotency contract; two consecutive runs = zero deltas. |
| **Defense-in-depth Tera strip** | Schema `.transform` AND a property test scanning rows for `tera*` keys | Per memory `regulation_m_a_no_tera.md`; one layer is too easy to regress. |

**Considered and rejected:**
- **One mega-schema file at `src/schemas/labmaus.ts`** — rejected: tool-arg shapes and domain shapes have different reuse profiles. But we did consolidate the *domain* cluster (`TournamentResult` + `TournamentTeam` + `TournamentTeamSpecies`) in one file because they're always used together.
- **A generic `tournament_aggregates` table** — rejected: aggregates are derivable from raw rows. Storing them duplicates state and risks drift.
- **Storing the labmaus `pokemon[]`/`items[]` arrays raw** — rejected per flow §2.2; we recompute and use labmaus's version only for cross-check at ingest time.

---

## 8. Error model

| Class | Trigger | Severity | Where thrown | Where caught |
|---|---|---|---|---|
| `LabmausInputError` | Tool-arg zod fails (e.g. invalid date range, `regulation !== "RegM-A"`) | user error | tool fns (entry) | agent dispatcher; tests assert message |
| `LabmausNetworkError` | HTTP non-2xx after retries exhausted; DNS/timeout | infra | `client.ts` | tool fns surface up; ingest script logs and continues to next chunk |
| `LabmausSchemaError` | Raw labmaus response fails `LabmausRawTournamentSchema` (drift) | upstream | tool fns (response parse) | contract test asserts; ingest fails loud |
| `LabmausUnknownSpeciesError` | `labmausIdToRosterId` returns null AND caller used the OrThrow variant | data | `species-map.ts` and `transform.ts` | ingest script: fails loud per flow §4 ("ingest fails loud with the offending id; no partial team is written") |
| `RosterDbError` (reused) | SQLite I/O on `tournaments` repo | infra | `tournaments.ts`, `species-alias-labmaus.ts` | callers; ingest reports and exits 1 |
| `RosterDataError` (reused) | A persisted row fails domain schema on read | corruption | `parseOrThrow` in `species-alias-labmaus`; manual `safeParse` in `tournaments` repo | tests; agent path crashes loud |

The `LabmausError` base class follows the same constructor shape as `RosterError`/`CalcError`: `(msg, opts?: { cause?: unknown; query?: unknown })`. Re-using `RosterDbError`/`RosterDataError` for storage-layer issues keeps the "is this a DB problem?" type guard global.

---

## 9. Reuse audit

**Reused (do not duplicate):**
- `createSimpleRepo<Row, Entity>`, `parseOrThrow`, `toCanonicalId` from `src/db/simple-repo.ts` — for `species_alias_labmaus`. Per CLAUDE.md §10 mandatory rule.
- `RosterDbError`, `RosterDataError` from `src/schemas/errors.ts` — for storage-layer issues in the new repo (DB errors are DB errors regardless of which table).
- `Db` type, `open()` from `src/db/open.ts` — same DB file, additive migration.
- `species` Drizzle table from `src/db/drizzle-schema.ts` — `tournament_team_species.roster_id` FK target, and `species_alias_labmaus.roster_id` FK target.
- Anthropic tool helper pattern from `src/db/tool-definitions.ts` — same `tool(name, description, schema)` builder; we extend the file rather than create a sibling.
- `zod-to-json-schema` (already a dep) — for tool-input JSON schemas.
- `better-sqlite3`, `drizzle-orm`, `drizzle-kit` — already pinned in `package.json`.
- `@anthropic-ai/sdk` `Tool` type — already imported by `tool-definitions.ts`.
- TS `fetch` (built-in in Node 20+) — confirm Node version in `package.json` engines (deferred check; if pre-20, use the existing test runner's polyfill or `undici` from devDeps — none currently listed, so we lean on built-in).

**NOT introduced as new dependencies:**
- No new HTTP client (no `axios`, no `got`, no `node-fetch`). Built-in `fetch` covers our needs.
- No new cache library. Hand-rolled file-based cache (≤30 lines) — TTLs are coarse, contents are JSON, file-per-key.
- No new throttle library. Hand-rolled token-bucket inside `client.ts` (≤20 lines, injectable clock for tests). Matches the existing convention of small purpose-built primitives over packages (cf. `simple-repo.ts`).
- No new test mocking framework — vitest's `vi.fn()` covers `fetchImpl` injection.

If any of these turn out non-trivial in Stage 5, the implementor flags it and the user approves a dep before proceeding (per CLAUDE.md §12 "When in doubt").

---

## 10. Test strategy + ordering

User-approved order from flow Q11: **schema → species-map → transform → client (mocked) → repo (in-memory sqlite) → ingest end-to-end on fixtures → idempotency → aggregate cross-check → contract (live, gated)**. Tests numbered in writing order.

Pure-data-definition exemption (CLAUDE.md §3) applies to schema-only tests (T1–T6). Everything from T7 onward is strict per-test Red→Green.

| # | Test file | Test name | Asserts | Min code to green |
|---|---|---|---|---|
| 1 | `tests/schemas/tournament.test.ts` | `TournamentSummarySchema parses fixture listing` | listing fixture parses, every record matches schema | `TournamentSummarySchema` |
| 2 | `tests/schemas/tournament.test.ts` | `LabmausRawTournamentSchema strips tera_types` | input with `tera_types: [...]` parses; output has no `tera_types` key | `.transform` strip |
| 3 | `tests/schemas/tournament.test.ts` | `LabmausRawTournamentSchema preserves placement: null` | swiss-only fixture parses; `teams[].placement` stays null | nullable schema |
| 4 | `tests/schemas/tournament.test.ts` | `LabmausRawTournamentSchema preserves num_phase_2: null` | single-phase fixture parses with null | nullable schema |
| 5 | `tests/schemas/tournament.test.ts` | `TournamentResultSchema rejects unknown fields` | strict() refuses extra keys | `.strict()` |
| 6 | `tests/schemas/tournament.test.ts` | `LabmausListArgsSchema rejects from > to` | superRefine catches | refinement |
| 7 | `tests/db/species-alias-labmaus.test.ts` | `repo.list returns seeded aliases sorted` | seed 5 rows; assert all returned in id order | createSimpleRepo wiring |
| 8 | `tests/db/species-alias-labmaus.test.ts` | `repo.get('038-a') resolves to ninetales-alola` | seed; lookup | one prepared stmt |
| 9 | `tests/db/species-alias-labmaus.test.ts` | `repo.get unknown returns null` | unseeded id returns null | factory default |
| 10 | `tests/tools/labmaus/species-map.test.ts` | `labmausIdToRosterId returns null for unknown id` | empty alias table; returns null | calls `aliasRepo.get` |
| 11 | `tests/tools/labmaus/species-map.test.ts` | `labmausIdToRosterIdOrThrow throws LabmausUnknownSpeciesError with offending id` | error msg contains `"038-z"` | OrThrow wrapper |
| 12 | `tests/tools/labmaus/species-map.test.ts` | `every labmaus_id in fixtures resolves` | iterate all fixture team rows; map all; expect zero nulls | seed alias table from `species-alias-seed.json` |
| 13 | `tests/tools/labmaus/species-map.test.ts` | `Basculegion ♂ literal maps to basculegionm` | hand-coded fixture entry | seed entry |
| 14 | `tests/tools/labmaus/transform.test.ts` | `transformTournament happy path on fixture 56757` | tournament+teams+species shapes match expected golden | fetchedAt injection, id formatting |
| 15 | `tests/tools/labmaus/transform.test.ts` | `transform strips any tera-named field defense-in-depth` | fixture mutated to inject `tera_inferred: [...]` survives raw schema strip; transform output has no tera key | property loop |
| 16 | `tests/tools/labmaus/transform.test.ts` | `transform preserves placement null` | swiss fixture | passthrough |
| 17 | `tests/tools/labmaus/transform.test.ts` | `transform generates player_key = trim(lower(player))` | input `"KST VGC "` → `"kst vgc"` | one helper line |
| 18 | `tests/tools/labmaus/transform.test.ts` | `transform produces 6 species rows per team in slot order` | length math + slot ordering | loop |
| 19 | `tests/tools/labmaus/client.test.ts` | `listCompletedTournaments URL-encodes regulation correctly` | mocked fetch sees `regulation=Regulation+Set+M-A` | URL builder |
| 20 | `tests/tools/labmaus/client.test.ts` | `client throttles to 1 rps` | inject clock; fire 3 calls; assert 2nd/3rd delayed ~1s | token bucket |
| 21 | `tests/tools/labmaus/client.test.ts` | `client retries 429 with exp backoff` | mocked fetch returns 429,429,200; assert 3 attempts | retry loop |
| 22 | `tests/tools/labmaus/client.test.ts` | `client surrenders after maxRetries on 5xx` | throws `LabmausNetworkError` carrying status | error wrap |
| 23 | `tests/tools/labmaus/client.test.ts` | `client reads from disk cache when fresh` | seed cache file; fetchImpl asserted unused | cache read |
| 24 | `tests/tools/labmaus/client.test.ts` | `client writes to disk cache after fetch` | post-call, file exists with response body | cache write |
| 25 | `tests/tools/labmaus/list-tournaments.test.ts` | `listTournaments returns parsed summaries from fixture` | injected client returns fixture; output matches | tool wiring |
| 26 | `tests/tools/labmaus/get-tournament.test.ts` | `getTournament returns full TournamentDetail with mapped species` | injected client + seeded alias DB; output matches golden | tool wiring + transform call |
| 27 | `tests/tools/labmaus/get-tournament.test.ts` | `getTournament throws LabmausUnknownSpeciesError when alias missing` | unseed one id; assert error | OrThrow path |
| 28 | `tests/tools/labmaus/tool-definitions.test.ts` | `four labmaus tools have stable JSON schemas` | snapshot test, no `$ref` | reuse `tool(...)` helper |
| 29 | `tests/db/tournaments.test.ts` | `upsertTournament inserts tournament+teams+species in tx` | post-call rows match input | upsert impl |
| 30 | `tests/db/tournaments.test.ts` | `upsertTournament is idempotent` | run twice; row counts unchanged | conflict clause + delete-then-insert for teams |
| 31 | `tests/db/tournaments.test.ts` | `list filters by date range and division` | seed 4 tournaments; filter; assert subset | conditional WHERE |
| 32 | `tests/db/tournaments.test.ts` | `teams_with(["sneasler","kingambit"]) returns only teams containing both` | seeded; assert intersection | HAVING COUNT DISTINCT |
| 33 | `tests/db/tournaments.test.ts` | `teams_with respects min_placement` | filter excludes swiss-out rows | WHERE placement <= ? AND IS NOT NULL |
| 34 | `tests/db/tournaments.test.ts` | `usage(kind="species") returns species rows with correct usage_percent` | known seed; assert math | aggregate query |
| 34a | `tests/db/tournaments.test.ts` | `usage(kind="item") returns item rows joined through team_sets` | seed labmaus + team_sets fixtures (the `pokepaste-sets` slice's `team_sets` table is a hard dependency for this test; ordering: this test is written *after* the pokepaste-sets `upsertTeamSets` lands, or with hand-inserted rows if pokepaste-sets is still mid-flight); assert ranking + citations | item-dimension branch in `usage` |
| 34b | `tests/db/tournaments.test.ts` | `usage(kind="move") expands moves_json correctly` | seed; assert each move's appearance count via `json_each` | move-dimension branch |
| 34c | `tests/db/tournaments.test.ts` | `usage(kind="core") returns 2-mon co-occurrences` | seeded teams with overlapping pairs; assert ranking | self-join on `tournament_team_species` |
| 35 | `tests/db/tournaments-no-tera.test.ts` | `no row in tournaments tables has any column matching /tera/i` | introspect SQL + scan all source_json blobs | (vacuous green if §5 schema is right; explicit guard catches future regressions) |
| 36 | `tests/scripts/ingest-labmaus.test.ts` | `ingest --no-network runs end-to-end on fixtures` | seed alias table + cache; run main; expected row counts | ingest orchestration code |
| 37 | `tests/scripts/ingest-labmaus-idempotency.test.ts` | `running ingest twice produces zero row deltas` | snapshot DB hash before+after second run; equal | (no new code if T30 green) |
| 38 | `tests/db/tournaments-aggregate-cross-check.test.ts` | `recomputed species ranking matches labmaus pokemon[] order ± tolerance for fixture 56757` | sort both; assert top-N match within ±0.05 absolute or ±1% relative per Q6 | recomputeAggregatesForTournament + tolerance comparator |
| 39 | `tests/db/tournaments-aggregate-cross-check.test.ts` | `cross-check warns but does not fail on out-of-tolerance diff` | inject mismatch; assert warning logged, no throw | warning channel |
| 40 | `tests/contract/labmaus-live.test.ts` (gated by `RUN_CONTRACT_TESTS=1`) | `live labmaus.getTournament(56757) matches our schema` | real fetch; `LabmausRawTournamentSchema.parse` succeeds | (no new code) |

T35 qualifies for the §3 "vacuous green slip" flag — the implementor must call it out in their change report so the reviewer can confirm the property holds rather than the test holding nothing.

---

## 11. Fixtures plan

All fixtures committed and immutable; filenames carry capture date.

```
fixtures/labmaus/
  2026-05-04__completed_tournaments_regm-a_30d.json    (listing — ≥10 entries spanning the window)
  2026-05-04__tournament_56757.json                    (large, 42 players, mixed countries, top-cut placements)
  2026-05-04__tournament_56756.json                    (small, ~16 players)
  2026-05-04__tournament_swiss_only.json               (placement: null on every row)
  2026-05-04__tournament_no_phase2.json                (num_phase_2: null)
  2026-05-04__tournament_with_basculegion_m.json       (covers the "Basculegion ♂" literal)
```

Capture procedure (one-shot, executed by author at fixture-creation time, NOT during this Stage 3):
1. `curl 'https://labmaus.net/api/completed_tournaments?...' | jq -S . > fixtures/.../listing.json`
2. For each chosen tournament id: `curl 'https://labmaus.net/api/tournament?tournament=<id>&language=en' | jq -S . > fixtures/.../tournament_<id>.json`
3. Verify the union of `team[]` arrays exhaustively populates `data/labmaus/species-alias-seed.json`.

Naming convention follows the roster slice's date-prefixed fixtures.

---

## 12. Cache + throttle

**Hand-rolled, no new deps.**

- **Disk cache.** `data/cache/labmaus/<key-hash>.json`. Key shape: `${endpoint}:${sortedQueryString}` → SHA-1 → first 16 hex chars. Cache record: `{ key, args, fetchedAt, body }`. TTL 24h (Q7). Read path: open file → if `now - fetchedAt < TTL`, return body; else fall through to network. Write path: atomic write (tmp + rename). Eviction: not in v1 — disk is cheap.
- **Throttle.** Token bucket: `capacity=1, refillRate=1 token/s`, awaited per request. Implementation injects `clock: () => number` for tests. Single shared instance per `LabmausClient`.
- **Retry.** On `429`/`5xx`: sleep `backoffBaseMs * 2^attempt` (jittered ±20%); up to `maxRetries=3`. `4xx` other than 429 is non-retryable → wrap as `LabmausNetworkError` with status and body.
- **Cache key MUST include all inputs** per CLAUDE.md §8 — verified by T19 (the URL builder test) and a dedicated cache-key unit test inside T23/T24.
- **Gitignore additions.** Append `data/cache/labmaus/` to `.gitignore`. Fixture files under `fixtures/labmaus/` stay committed.

---

## 13. Ingest script orchestration

`scripts/data/ingest-labmaus.ts`:

```ts
// Pseudocode — final lands in Stage 5.
async function main(argv: string[]): Promise<number> {
  const opts = parseArgs(argv);  // --from, --to, --mode, --db, --no-network, --concurrency
  const db = open(opts.db);
  await seedAliasTable(db, "data/labmaus/species-alias-seed.json");

  const client = createLabmausClient({
    cacheDir: "data/cache/labmaus",
    cacheTtlMs: 24 * 60 * 60 * 1000,
    throttleRps: 1,
    maxRetries: 3,
    backoffBaseMs: 1000,
    fetchImpl: opts.noNetwork ? cacheOnlyFetch : fetch,
  });

  const chunks = chunkDateRange(opts.from, opts.to, /*days*/ 30); // oldest→newest
  let total = { tournaments: 0, teams: 0, species: 0, warnings: 0 };

  for (const chunk of chunks) {
    const summaries = await listTournaments({
      regulation: "RegM-A",
      date_range: { from: chunk.from, to: chunk.to },
      division: "Masters",   // v1 filter per Q3
    }, { client });

    // Parallel fan-out, capped at 4
    await pMap(summaries, async (s) => {
      const detail = await getTournament({ id: s.id }, { client, speciesMap });
      tournaments.upsertTournament(db, detail);

      // Cross-check pass
      const ours = tournaments.recomputeAggregatesForTournament(db, detail.tournament.id);
      const theirs = (raw as any).pokemon as Array<{ id: string; usage_percent: number }> | undefined;
      if (theirs) {
        const diff = compareWithinTolerance(ours, theirs, { abs: 0.05, rel: 0.01 });
        if (!diff.ok) { logWarn("cross-check mismatch", diff); total.warnings++; }
      }
      total.tournaments++; total.teams += detail.teams.length; total.species += detail.species.length;
    }, { concurrency: 4 });
  }

  console.log(JSON.stringify({ ok: true, ...total }));
  return 0;
}
```

**Argv handling.**
- `--mode full` (default): cold-start — `from = 2026-04-06`, `to = today`.
- `--mode incremental`: weekly — `from = today − 14d`, `to = today` (14-day overlap absorbs late-finalized brackets per flow §2.6).
- `--no-network`: forces cache-only; used by tests and dry runs.

**Exit codes.**
- `0` — success, including bounded cross-check warnings.
- `1` — schema drift (`LabmausSchemaError`), unknown species (`LabmausUnknownSpeciesError`), DB error.
- `2` — invalid argv.

**Observability.**
- Single JSON-line summary on stdout at end (counts + warnings).
- Per-tournament progress to stderr.
- Cross-check diffs structured-logged for grep.

---

## 14. Definition of Done mapping (CLAUDE.md §11)

| Box | This slice |
|---|---|
| Flow doc reviewed | YES — `docs/flows/labmaus-tournaments.md` Stage 2 approved 2026-05-04. |
| Tech plan approved | THIS DOC — pending. |
| Failing test first (commit history visible) | enforced by Stage 4 ordering in §11; commit `test: red — labmaus-tournaments`. |
| `pnpm test` passes | Stage 5 exit gate. |
| `pnpm typecheck` passes | Stage 5 exit gate; strict TS, typed signatures everywhere per §3 module specs. |
| `pnpm lint` passes | Stage 5 exit gate. |
| New external data schema-validated and fixture-backed | `LabmausRawTournamentSchema` + 4+ fixtures. |
| User-facing claim cited | every persisted record carries `source_url` + `fetched_at`. |
| Docs touched | `tools/labmaus/SPEC.md` written first; `package.json` script added; `.gitignore` updated. |
| Reviewer subagent ran | Stage 6. |

**Uncovered by this slice (explicitly):** none. Item/move usage rows in `tournaments.usage` are populated on day one via the `team_sets` table from the parallel `pokepaste-sets` slice (resolution of §17 Q1).

---

## 15. Rollout / feature-flag

- **Always-on, no flag.** New tools and tables don't affect existing surfaces; the agent's tool catalog gains four entries but they're inert until invoked.
- **Migration ordering vs roster DB.** The roster slice ships migration `0000_square_meltdown.sql` (already in `src/db/migrations/`). This slice generates `0001_*.sql` via drizzle-kit. The roster build script (`pnpm data:build:reg-m-a`) opens the same DB file and runs migrations idempotently before populating species. Hard dependency: **species table must be populated before `pnpm data:ingest:labmaus` runs**, because `tournament_team_species.roster_id` FKs into `species.id`. Documented in the SPEC.md and enforced by an early check in the ingest script (`SELECT COUNT(*) FROM species` → must be > 0).
- **Backfill cadence.** Manual once at ship; weekly cron thereafter (matches `pokemon-roster-db`'s "external cron" model per Q9). Cron config out of scope (user-managed).

---

## 16. Risks + mitigations

1. **Labmaus schema drift.** Upstream adds/renames a field; ingest breaks silently or schema rejects. **Mitigation:** weekly contract test (T40) gated by `RUN_CONTRACT_TESTS=1`; `passthrough()` on raw schemas absorbs additive changes; `LabmausSchemaError` from required-field changes fails loud with the offending path.
2. **Unknown labmaus species id mid-ingest.** New form suffix (e.g. `"903-x"`) appears in production data we've never seen. **Mitigation:** ingest fails loud with the offending id and team id; user runs a one-shot patch on `species-alias-seed.json`; build re-resumes from the cache (already-fetched tournaments won't re-hit the network). Species-map's OrThrow path is tested (T11).
3. **Pokepaste deferral leaves teams set-less.** `team_url` is opaque; downstream features that need item/move/SPS data can't be built from labmaus alone. **Mitigation:** explicit scope boundary in flow §2.3 and §2.9; this slice persists `team_url` and stops. The pokepaste-sets slice is the next data-layer slice; the lead planner does not ship before it.
4. **Contract test flakiness.** Live labmaus may be temporarily 5xx; weekly contract test fails with no real schema drift. **Mitigation:** gate behind `RUN_CONTRACT_TESTS=1`; the runner tolerates 5xx with a skip-not-fail; only schema-shape mismatches fail.
5. **Fixture maintenance burden.** Six committed JSON fixtures must stay in lockstep with schema changes. **Mitigation:** a single `re-validate fixtures` test (folded into T1) iterates every file; schema changes that break fixtures show up immediately; fixtures are immutable per filename so we capture-anew rather than edit.

---

## 17. Open questions for plan review

1. **Item/move usage rows.** ~~Flow §5 success criteria mentions "per species + per item + per move + per core" usage. The pokepaste deferral makes items/moves unreachable in this slice. **Proposal:** ship `usage` returning species + cores only.~~ **RESOLVED 2026-05-04** — pokepaste-sets ships in parallel (`docs/plans/pokepaste-sets.md`); `usage` now ships with `species + items + moves + cores` on day one. §6 and §10 (T34a/b/c) updated accordingly. Items/moves dimensions read from `team_sets` (owned by the pokepaste slice).
2. **`LabmausError` vs reusing `RosterError`.** Storage layer reuses `RosterDbError`/`RosterDataError`; tool layer creates a fresh `LabmausError` family. Reviewer confirms this split (alternative: one `IngestError` umbrella for all data-source tool errors).
Answer: The split makes sense to me. `LabmausError` is specific to the labmaus slice and can evolve independently, while `RosterDbError`/`RosterDataError` are more general and already in use across the codebase. This way we keep a clear distinction between errors related to the data source and errors related to database operations.
3. **`tournaments.get` return shape.** ~~Plan as written returns just the `TournamentResult` (no joined teams).~~ **RESOLVED 2026-05-04** — `tournaments.detail(id)` shipped as a third repo method returning full `TournamentDetail` (tournament + teams + species joined). `get` stays slim. §6 repo table updated.

**Flow-doc gap uncovered:** §2.5 specifies `tournament_team_species (team_id FK, slot 0..5, labmaus_id, roster_id FK→species.id)` but the success criteria don't pin a per-team uniqueness rule on `slot`. This plan adds `PRIMARY KEY (team_id, slot)`, which is stricter than the flow doc requires. Calling out for explicit confirmation.
Answer: The `PRIMARY KEY (team_id, slot)` constraint makes sense to enforce the intended data model where each team can have up to 6 species, each in a specific slot. This will help maintain data integrity and prevent issues with duplicate entries for the same team and slot. Let's go with this stricter constraint.

---

## 18. Stage 6 outcomes (2026-05-05)

### 18.1 Review

Full review report at [`docs/reviews/labmaus-tournaments.md`](../reviews/labmaus-tournaments.md). Verdict: ship-after-blockers. Two blockers, ten suggested refactor items, five deferrals. The user approved applying all 10; deferrals annotated.

### 18.2 Applied fixes (commit `refactor: apply review — labmaus-tournaments`)

1. **`LabmausClient.nextAllowedAt()` removed** from the public interface. T20 rewritten to use `vi.useFakeTimers()` + `setTimeout` spy, asserting two real ≥1000ms throttle delays across three calls. The throttle now runs in real-clock mode in tests; `clockOverride` removed.
2. **`usage(kind="item"|"move")` implemented** against a `team_sets` LEFT JOIN. Schema added to `src/db/drizzle-schema.ts` (`team_sets` table, owned by the parallel pokepaste-sets slice; this slice ships the table empty so labmaus's `usage` returns `[]` on items/moves until pokepaste populates it). Migration `0002_dry_tony_stark.sql` generated. T34a/T34b strengthened — non-vacuous when `team_sets` has rows.
3. **Plan patched** (this file): §17-Q1 and §17-Q3 marked RESOLVED with strikethrough; this §18 added.
4. **`tournaments.list` converted to Drizzle query builder** with `and(...clauses)` composition; raw-SQL fallback removed.
5. **Orphan `void` imports deleted** from `scripts/data/ingest-labmaus.ts` (aliasRepo / speciesTable / sql).
6. **`--no-network` mode** now propagates `LabmausSchemaError` and `LabmausUnknownSpeciesError`; only `LabmausNetworkError` is treated as cache-miss-skip.
7. **Cross-check pass wired** into the ingest loop: `recomputeAggregatesForTournament` runs after each upsert, `compareWithinTolerance` (±0.05 absolute or ±1% relative) compares to labmaus's own `pokemon[]` aggregate, out-of-tolerance entries emit a JSON-line warning.
8. **Cross-sync comments** added to `SpeciesAlias` (in `src/tools/labmaus/species-map.ts`) and `SpeciesAliasSchema` (in `src/db/species-alias-labmaus.ts`).
9. **`labmausIdToRosterId` displayName fallback** implemented — when id-lookup misses, the function normalizes `displayName` (♂/♀ stripped, hyphenated, lowercased) and retries via the roster.
10. **Tool-definitions wording corrected** — `tournamentsGetTool` description no longer claims `tournaments_detail` is "future."

### 18.3 Deferrals (annotated as inline `// TODO(stage6-deferred):` comments)

| # | Concern | Inline anchor | Belongs in |
|---|---|---|---|
| 1 | Extend `createSimpleRepo` to accept optional `displayNameColumn` (the current `idColumn === displayNameColumn` workaround prepares an extra statement per Db) | `src/db/species-alias-labmaus.ts:37` | Next ref-table consumer slice (natures? types?) |
| 2 | Real fixture-cache-seeded `--no-network` integration test (current `fakeFetchEmpty` returns `[]` and makes T36/T37 partly vacuous) | `scripts/data/ingest-labmaus.ts:127` | pokepaste-sets sibling or ingest-hardening slice |
| 3 | 3-mon and 4-mon cores in `usage(kind="core")` (flow §1.1 promised; plan §6 currently restricts to 2-mon) | `src/db/tournaments.ts:357` | New flow doc |
| 4 | `--strict-offline` argv mode + date validation (`chunkDateRange` accepts NaN dates today) | `scripts/data/ingest-labmaus.ts:243` | argv-validation / ingest-hardening slice |
| 5 | Live contract test polish — surface `parsed.error.issues` on schema drift for clearer diagnostics | tests/contract/labmaus-live.test.ts (NIT) | accept-or-defer; track if drift bites |

### 18.4 §3 pure-data exemption disclosure (review finding 3)

The Stage 4 "red" commit (`f0a5ca9`) shipped substantial scaffolding alongside the failing tests: `src/schemas/tournament.ts` (≈279 lines), the Drizzle schema additions (≈88 lines), and the migration are all final, not stubs. The schema file qualifies for CLAUDE.md §3's pure-data exemption (zod definitions, no behavior). The other items stretched the rule — module signatures were larger than "minimum to compile" and the disclosure CLAUDE.md §3 last paragraph requires was not written in the commit message. Recording it here for traceability; future slices should disclose pure-data batches in the Stage 4 commit message itself.
