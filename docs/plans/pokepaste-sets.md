# Tech Plan — Pokepaste Set Ingest

**Slug:** `pokepaste-sets`
**Stage:** Stage 3 approved (2026-05-04). Stage 4 (red tests) pending.
**Approved-by:** Rodrigo Caballero (2026-05-04)
**Date:** 2026-05-04
**Author:** Tech Lead subagent
**Implements flow doc:** `/Users/rodrigo/src/pokemon-ai-trainer/docs/flows/pokepaste-sets.md` (Stage 2 approved 2026-05-04 by Rodrigo Caballero)
**Memory citations:**
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/db_orm_drizzle.md`
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/data_layer_two_tier_db.md`
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/regulation_m_a_no_tera.md`
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/regulation_m_a_stat_rules.md`
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/regulation_m_a_roster.md`

**Sibling plan:** `docs/plans/labmaus-tournaments.md` — pokepaste ships in parallel; the labmaus plan is revised in lockstep with this one (see Q8 of the flow doc and the §17 entry in the labmaus plan).

---

## 1. Goal recap

Ship a thin, agent-callable HTTP tool (`pokepaste.fetchPaste`), a transform layer that parses Showdown-export plaintext via `@pkmn/sets`, a Drizzle-backed `team_sets` table keyed `(tournament_team_id, slot)`, and a bespoke `sets` repo (`list`, `get`, `usage`). The labmaus ingest script gains a per-team hook that calls `fetchPaste` against the persisted `team_url` and upserts six rows per team. Tera fields are stripped at the parser boundary; Champions SPS naming is enforced at the schema (the engine-side `evs` ↔ domain-side `sps` translation lives in the transform layer); unknown items/abilities/moves cause the **transform** to throw — the **labmaus ingest script** catches per-team and continues, logging the offending paste/team/value in the run summary. Done means: ≥5 fixtures round-trip, two consecutive ingests produce zero `team_sets` deltas, no `tera_*` field appears in any persisted row, `sets.usage` answers item/ability/move/nature ranking queries cited by tournament + paste URL, full backfill of the labmaus team set finishes in under 5 minutes on a laptop.

---

## 2. Module boundaries

All paths absolute under `/Users/rodrigo/src/pokemon-ai-trainer/`. New files only — files marked *(extend)* are additive edits to existing files.

### Schemas (`src/schemas/`)

#### `src/schemas/team-set.ts` (new)

- **Single responsibility:** zod schemas + inferred types for the pokepaste domain — `Sps`, `Ivs`, `TeamSet`, `PasteFetchResult`, the tool-input shape `PokepastePasteArgs`, and the repo-input shapes `SetsListFilter`, `SetsUsageArgs`, `UsageRow` (paste-flavoured — distinct from the `UsageRow` in `tournament.ts`, which is keyed by `kind` and lives at the tournament repo). Per the labmaus precedent, related entities cluster in one file.
- **Exported surface:**
  ```ts
  export const SpsSchema:                  z.ZodObject<…>;        // hp/atk/def/spa/spd/spe ints, ≤ 32 each, total ≤ 66
  export const IvsSchema:                  z.ZodObject<…>;        // 0..31 each
  export const PokepasteSourceSchema:      z.ZodObject<…>;        // {site:"pokepaste", paste_id, source_url, fetched_at}
  export const CompletenessSchema:         z.ZodEnum<["minimal","partial","full"]>;
  export const TeamSetSchema:              z.ZodObject<…>;
  export const PasteFetchResultSchema:     z.ZodObject<…>;
  export const PokepastePasteArgsSchema:   z.ZodObject<…>;
  export const SetsListFilterSchema:       z.ZodObject<…>;
  export const SetsUsageArgsSchema:        z.ZodObject<…>;
  export const SetsUsageRowSchema:         z.ZodObject<…>;
  export type Sps                = z.infer<typeof SpsSchema>;
  export type Ivs                = z.infer<typeof IvsSchema>;
  export type TeamSet            = z.infer<typeof TeamSetSchema>;
  export type PasteFetchResult   = z.infer<typeof PasteFetchResultSchema>;
  export type PokepastePasteArgs = z.infer<typeof PokepastePasteArgsSchema>;
  export type SetsListFilter     = z.infer<typeof SetsListFilterSchema>;
  export type SetsUsageArgs      = z.infer<typeof SetsUsageArgsSchema>;
  export type SetsUsageRow       = z.infer<typeof SetsUsageRowSchema>;
  ```
- **TSDoc obligations (CLAUDE.md §10):** every exported schema and type carries the six-element block (summary, when-to-use, `@param`/`@returns`/`@throws` as applicable, `@example` for `PokepastePasteArgs` and `SetsUsageArgs`).
- **Does NOT do:** any HTTP, any DB I/O, any roster lookup. Pure shape + validation. The Tera strip is enforced at the transform layer (defense-in-depth: domain schema has no `tera_*` field defined, so `.strict()` rejects anything that slipped through).

#### `src/schemas/errors.ts` (extend)

- Add a `PokepasteError` family alongside `LabmausError` / `RosterError` / `CalcError`. Same constructor pattern (`message, opts?: { cause?, paste_id? }`).
- **New exports:**
  - `PokepasteError` — base class.
  - `PokepasteInputError` — tool-arg zod failure (e.g. malformed paste id).
  - `PokepasteNetworkError` — HTTP failure after retries; `.status` carries the last status seen.
  - `PokepasteNotFoundError` — 404 (paste deleted). Caller decides per-team whether to log+continue or fail.
  - `PokepasteParseError` — `@pkmn/sets` returned no usable team OR the export produced 0 sets OR the export is below `minimal` completeness.
  - `PokepasteRefValidationError` — unknown item / ability / move (reject-and-fail per flow §6 Q4); carries the offending value, kind (`"item"|"ability"|"move"`), paste id, and slot.
  - `PokepasteUnknownSpeciesError` — unknown roster species; consistency with labmaus species-map policy.

### Tool layer (`src/tools/pokepaste/`)

#### `src/tools/pokepaste/SPEC.md` (new — written first per CLAUDE.md §8)

- **Single responsibility:** the tool spec doc. Inputs/outputs/edge cases for `pokepaste.fetchPaste`. Documents the Tera strip, the `evs → sps` rename, the `@pkmn/sets` API pinned (Teams.importTeam, see §4.4), the cache-key shape, the throttle policy (separate 2 rps bucket — see §12), the **reject-and-fail** ref-table validation contract (see §8), the JSON Schema description used by the Anthropic SDK. Authored before any test or code (per CLAUDE.md §8 sub-bullet "Adding a new tool").

#### `src/tools/pokepaste/client.ts` (new)

- **Single responsibility:** thin HTTP client around `GET https://pokepast.es/<paste_id>/raw`. Enforces throttle (2 rps, distinct from labmaus's 1 rps — see §12), exponential-backoff retry on transient failures, and a content-addressed disk cache that **never expires** (paste URLs are content-hashed → 200 responses are immutable; 404s are *not* cached so a paste that gets re-uploaded is observable on next run).
- **Exported surface:**
  ```ts
  export interface PokepasteClientOptions {
    cacheDir:      string;                 // absolute path under data/cache/pokepaste
    throttleRps:   number;                 // default 2  (separate bucket, see §12)
    maxRetries:    number;                 // default 3
    backoffBaseMs: number;                 // default 1000
    fetchImpl?:    typeof fetch;           // injectable for tests
    clock?:        () => number;           // injectable for tests
  }
  export interface PokepasteClient {
    /** Fetch the raw Showdown export. Returns the plaintext body or throws. */
    fetchRaw(paste_id: string): Promise<string>;
  }
  export function createPokepasteClient(opts: PokepasteClientOptions): PokepasteClient;
  ```
- **TSDoc:** full block on `createPokepasteClient` and `fetchRaw`.
- **Does NOT do:** validate, parse, or persist. Returns plaintext or throws `PokepasteNetworkError` / `PokepasteNotFoundError`.

#### `src/tools/pokepaste/transform.ts` (new)

- **Single responsibility:** raw Showdown plaintext → `TeamSet[]`. Calls `Teams.importTeam(rawText)` from `@pkmn/sets` (pinned in §4.4), strips `teraType` from each parsed `PokemonSet`, renames `evs → sps` at this boundary (the engine API uses `evs`; our domain uses `sps` per CLAUDE.md §10 / `regulation_m_a_stat_rules.md`), validates `species`/`item`/`ability`/`moves` against the roster + ref tables, computes the `completeness` tag.
- **Exported surface:**
  ```ts
  export interface TransformDeps {
    db: Db;                                       // for roster + items + abilities + moves lookups
    rosterRepo: { has(db: Db, name: string, format: "RegM-A"): boolean;
                  get(db: Db, name: string, format: "RegM-A"): { id: string } | null };
    itemsRepo:    SimpleRepo<{ id: string }>;
    abilitiesRepo:SimpleRepo<{ id: string }>;
    movesRepo:    SimpleRepo<{ id: string }>;
  }
  export interface TransformInput {
    paste_id:           string;
    raw_text:           string;
    fetched_at:         string;                   // ISO-8601 UTC
    tournament_team_id: string;                   // "labmaus:<tid>:<extTid>"
  }
  export function transformPaste(input: TransformInput, deps: TransformDeps): PasteFetchResult;
  ```
- **Does NOT do:** HTTP, DB writes, throttle, cache. The transform **throws** on unknown item/ability/move (`PokepasteRefValidationError`) — it does **not** swallow the error. Callers (the ingest script) decide per-team whether to continue. See §8 for the exact contract.

#### `src/tools/pokepaste/fetch-paste.ts` (new — public tool fn)

- **Single responsibility:** the `pokepaste.fetchPaste` agent-callable tool. Validates input via `PokepastePasteArgsSchema`, calls the client, calls the transform, returns `PasteFetchResult`. Re-raises `PokepasteRefValidationError` so the caller sees it (per the reject-and-fail contract).
- **Exported surface:**
  ```ts
  export async function fetchPaste(
    args: PokepastePasteArgs,
    deps: { client: PokepasteClient; transform: TransformDeps; tournament_team_id: string },
  ): Promise<PasteFetchResult>;
  export const fetchPasteToolDefinition: Tool;     // Anthropic SDK Tool
  ```
- The `tournament_team_id` is a required dep, not an arg — agents calling the tool directly via Anthropic must supply it through a thin agent-side wrapper. Rationale: keeps the tool input minimal (just the paste id) while the persistence boundary remains correct.

### DB layer (`src/db/`)

#### `src/db/drizzle-schema.ts` (extend, do NOT replace)

- Add one `sqliteTable` declaration: `teamSets`. Mirrors the file's existing style (`check`, `index`, `primaryKey`). FK from `teamSets.tournamentTeamId` → `tournamentTeams.id` (added by the labmaus slice). FK from `teamSets.speciesRosterId` → `species.id`.

#### `src/db/migrations/0002_<auto>.sql` (new — drizzle-kit generated)

- Generated by `pnpm drizzle-kit generate` after the schema additions land. Filename auto-numbered after the labmaus migration (`0001_*.sql`).

#### `src/db/sets.ts` (new — bespoke repo)

- **Single responsibility:** the bespoke sets repo. Implements `list`, `get`, `usage`, plus the package-private `upsertTeamSets(db, sets): void` used by the ingest hook. Cannot use `createSimpleRepo` because: (a) lookups are composite-keyed `(tournament_team_id, slot)` not by id or display name, (b) `usage` is a multi-aggregate group-by joined to `tournament_teams` and `tournaments` for date-window filtering, (c) `upsertTeamSets` is a transactional bulk write. Per CLAUDE.md §10 the factory deliberately doesn't generalize that far.
- **Exported surface (signatures only — bodies in Stage 5):**
  ```ts
  export function list(db: Db, filter: SetsListFilter): TeamSet[];
  export function get(db: Db, tournament_team_id: string, slot: number): TeamSet | null;
  export function usage(db: Db, args: SetsUsageArgs): SetsUsageRow[];
  export function upsertTeamSets(db: Db, sets: TeamSet[]): void;          // ingest-only
  ```
- **TSDoc:** all six elements per export per CLAUDE.md §10. Mirrors `roster.ts` / `tournaments.ts`.

#### `src/db/tool-definitions.ts` (extend)

- Append `pokepasteFetchPasteTool` and `setsListTool` / `setsGetTool` / `setsUsageTool`. Reuses the local `tool(...)` helper. The agent reaches set-shaped data through the repo tools; the raw `fetchPaste` is exposed for completeness/debugging but is primarily called by the ingest script.

### Ingest extension (`scripts/data/`)

#### `scripts/data/ingest-labmaus.ts` (extend)

- **Single responsibility (delta only):** after each successful `tournaments.upsertTournament(db, detail)`, iterate the new `tournament_teams` rows and call a per-team pokepaste hook. The hook is a private function in the same file (no new top-level script — pokepaste is a sibling of labmaus, ingested in the same run). See §13 for the loop pseudocode and the `PokepasteRefValidationError` catch contract.

### Data + fixtures

#### `data/cache/pokepaste/` (new, **gitignored**)

- Disk cache for raw `/raw` responses (one file per paste_id). Path under `.gitignore`: `data/cache/pokepaste/`.

#### `fixtures/pokepaste/` (new, committed, immutable)

- See §11.

### Tests

```
tests/schemas/team-set.test.ts
tests/tools/pokepaste/transform.test.ts
tests/tools/pokepaste/transform-no-tera.test.ts
tests/tools/pokepaste/transform-evs-to-sps.test.ts
tests/tools/pokepaste/transform-completeness.test.ts
tests/tools/pokepaste/transform-ref-validation.test.ts
tests/tools/pokepaste/client.test.ts
tests/tools/pokepaste/fetch-paste.test.ts
tests/tools/pokepaste/tool-definitions.test.ts
tests/db/sets.test.ts
tests/db/sets-no-tera.test.ts
tests/scripts/ingest-pokepaste-hook.test.ts
tests/scripts/ingest-pokepaste-idempotency.test.ts
tests/contract/pokepaste-live.test.ts                 (gated by RUN_CONTRACT_TESTS=1)
```

---

## 3. Data schemas (zod, full bodies — sketch; final lands in Stage 5)

```ts
// src/schemas/team-set.ts
import { z } from "zod";

const ISODateTime = z.string().datetime({ offset: false });
const PasteId     = z.string().regex(/^[a-f0-9]{12,32}$/);   // hex hashes; pokepaste's range
const RosterId    = z.string().regex(/^[a-z0-9-]+$/);
const SlotIndex   = z.number().int().min(0).max(5);

// Reg M-A stat rules per regulation_m_a_stat_rules.md
export const SpsSchema = z.object({
  hp:  z.number().int().min(0).max(32),
  atk: z.number().int().min(0).max(32),
  def: z.number().int().min(0).max(32),
  spa: z.number().int().min(0).max(32),
  spd: z.number().int().min(0).max(32),
  spe: z.number().int().min(0).max(32),
}).strict().refine((s) => s.hp + s.atk + s.def + s.spa + s.spd + s.spe <= 66,
  { message: "SPS total exceeds 66 (Reg M-A cap)" });

export const IvsSchema = z.object({
  hp:  z.number().int().min(0).max(31),
  atk: z.number().int().min(0).max(31),
  def: z.number().int().min(0).max(31),
  spa: z.number().int().min(0).max(31),
  spd: z.number().int().min(0).max(31),
  spe: z.number().int().min(0).max(31),
}).strict();

export const PokepasteSourceSchema = z.object({
  schema_version: z.literal(1),
  site:           z.literal("pokepaste"),
  paste_id:       PasteId,
  source_url:     z.string().url(),
  fetched_at:     ISODateTime,
}).strict();

export const CompletenessSchema = z.enum(["minimal", "partial", "full"]);

export const TeamSetSchema = z.object({
  schema_version:     z.literal(1),
  id:                 z.string().regex(/^labmaus:\d+:\d+:[0-5]$/),  // tournament_team_id + ":" + slot
  tournament_team_id: z.string().regex(/^labmaus:\d+:\d+$/),
  slot:               SlotIndex,
  species_roster_id:  RosterId,
  item:               z.string().min(1).nullable(),
  ability:            z.string().min(1).nullable(),
  level:              z.number().int().min(1).max(100).nullable(),
  moves:              z.array(z.string().min(1)).max(4),
  sps:                SpsSchema.nullable(),
  ivs:                IvsSchema.nullable(),
  nature:             z.string().min(1).nullable(),
  completeness:       CompletenessSchema,
  source:             PokepasteSourceSchema,
  // No tera_* fields by design. .strict() below rejects any that leak through.
}).strict();

export const PasteFetchResultSchema = z.object({
  paste_id:    PasteId,
  raw_text:    z.string().min(1),
  sets:        z.array(TeamSetSchema).min(1).max(6),
  warnings:    z.array(z.string()).default([]),
  fetched_at:  ISODateTime,
}).strict();

// Tool input
export const PokepastePasteArgsSchema = z.object({
  paste_id: PasteId,
}).strict();

// Repo input
export const SetsListFilterSchema = z.object({
  tournament_id:      z.string().regex(/^labmaus:\d+$/).optional(),
  tournament_team_id: z.string().regex(/^labmaus:\d+:\d+$/).optional(),
  species_roster_id:  RosterId.optional(),
}).strict().refine((f) => !!(f.tournament_id || f.tournament_team_id || f.species_roster_id),
  { message: "at least one filter must be provided" });

export const SetsUsageArgsSchema = z.object({
  species:        RosterId,
  format:         z.literal("RegM-A"),
  lookback_days:  z.number().int().positive(),
  dimension:      z.enum(["item", "ability", "move", "nature"]),
}).strict();

export const SetsUsageRowSchema = z.object({
  dimension:      z.enum(["item", "ability", "move", "nature"]),
  key:            z.string(),
  display_label:  z.string(),
  appearances:    z.number().int().nonnegative(),
  total_sets:     z.number().int().nonnegative(),
  usage_percent:  z.number().min(0).max(100),
  citations:      z.array(z.string()).default([]),    // tournament_team_ids; click through to paste_url
}).strict();

export type Sps                = z.infer<typeof SpsSchema>;
export type Ivs                = z.infer<typeof IvsSchema>;
export type Completeness       = z.infer<typeof CompletenessSchema>;
export type TeamSet            = z.infer<typeof TeamSetSchema>;
export type PasteFetchResult   = z.infer<typeof PasteFetchResultSchema>;
export type PokepastePasteArgs = z.infer<typeof PokepastePasteArgsSchema>;
export type SetsListFilter     = z.infer<typeof SetsListFilterSchema>;
export type SetsUsageArgs      = z.infer<typeof SetsUsageArgsSchema>;
export type SetsUsageRow       = z.infer<typeof SetsUsageRowSchema>;
```

The Tera strip lives in two layers by design: the transform deletes `teraType` from every `PokemonSet` returned by `@pkmn/sets`; the strict schemas above have no `tera_*` field at all, so anything that slipped through fails validation. A property test (§10 T22) scans every persisted `team_sets` row for any column or JSON key matching `/tera/i`.

---

## 4. Tool contracts

### 4.1 `pokepaste.fetchPaste`

```ts
async function fetchPaste(
  args: PokepastePasteArgs,
  deps: { client: PokepasteClient; transform: TransformDeps; tournament_team_id: string },
): Promise<PasteFetchResult>;
```

**Anthropic SDK tool description** (full text lands in Stage 5; sketch):

> `pokepaste_fetch_paste` — fetch and parse a single pokepast.es Showdown export by paste id (hex hash from the URL). Returns up to six per-Pokemon sets normalized to our domain shape — species, item, ability, level, moves, optionally SPS/IVs/nature — plus a `completeness` tag (`minimal | partial | full`) capturing how much of the export was filled in. Strips the `Tera Type:` line unconditionally (Reg M-A has no Terastallization). Validates item/ability/move against the Champions reference tables; throws `PokepasteRefValidationError` on unknown values (callers must catch and decide per-team continuation). Use this when you have a paste id from `tournaments.teams_with(...).team_url` and need the actual build behind a placing team.

**JSON Schema:** generated via `zodToJsonSchema(PokepastePasteArgsSchema, { target: "openApi3", $refStrategy: "none" })` — same pipeline as `src/db/tool-definitions.ts`.

**Pre-conditions:** `args.paste_id` is a 12–32 char hex string (zod-checked). `deps.tournament_team_id` matches `^labmaus:\d+:\d+$`.

**Post-conditions:** `result.sets.length` ∈ [1, 6]; every `set.species_roster_id` resolves through `roster.has`; no field name on any set contains `tera`; SPS totals ≤ 66 / per-stat ≤ 32 (validated by schema); `completeness` consistent with which fields are non-null.

**Cache key:** `paste/${paste_id}`. The cache is content-addressed: 200 responses are immutable, never expire, eviction is manual file delete. 404 responses are NOT cached.

**Throttle:** uses the client's own limiter (2 rps, distinct from labmaus — see §12).

**Errors:** `PokepasteInputError` (zod fail on input), `PokepasteNetworkError` (HTTP exhaustion / non-404 5xx), `PokepasteNotFoundError` (404), `PokepasteParseError` (`@pkmn/sets` returned no team or `.team.length === 0` or completeness < `minimal`), `PokepasteRefValidationError` (unknown item/ability/move — reject-and-fail per flow §6 Q4), `PokepasteUnknownSpeciesError` (species not in roster).

### 4.2 `sets.{list,get,usage}` tool definitions

Same pattern as labmaus's tournament tools — agent-callable thin wrappers over the repo, JSON-Schema-described, format-locked to `RegM-A`. Tool descriptions:

- `sets_list` — list parsed sets for a tournament, team, or species. Use to enumerate the actual builds behind a tournament's placing teams.
- `sets_get` — fetch one set by `(tournament_team_id, slot)`.
- `sets_usage` — rank items / abilities / moves / natures for a given species across a date window. Use this to answer "what's species X running in the meta?" — strictly grounded in placing-team paste data (not Pikalytics).

### 4.3 `SPEC.md` outline

Mandatory sections per CLAUDE.md §8:

1. Inputs (zod schemas verbatim).
2. Outputs (zod schemas verbatim).
3. Edge cases — minimal sets (no EVs / IVs / nature), Mega Stones (`Charizardite Y`), regional forms (`charizard-mega-y`), `♂ / ♀` symbols in species names, `Tera Type: None` line, missing ability line, paste with <6 mons.
4. Cache + throttle policy (content-addressed forever; 2 rps; separate bucket — see §12).
5. Error matrix (which exception when).
6. Citation rules — every record carries `source_url = https://pokepast.es/${paste_id}` + `fetched_at`.
7. Reg M-A hygiene clauses — Tera strip mandatory; SPS naming (not EVs); SPS cap ≤ 66.
8. **Reject-and-fail validation contract** — unknown item/ability/move → transform throws `PokepasteRefValidationError`; transform never swallows; ingest catches per-team and continues with a logged warning. SPEC.md states this verbatim so callers are explicit consumers of the contract.
9. Out of scope: paste authoring, set diffing, player-attributed retrieval, image scraping.

### 4.4 `@pkmn/sets` API pinning

Confirmed by inspecting the `5.2.0` published `index.d.ts` (verified via `npm pack @pkmn/sets`). The relevant exports:

```ts
// From @pkmn/sets v5.2.0 build/index.d.ts
declare const Teams: {
  importTeam(buf: string, data?: Data): Team | undefined;
  importTeams(buf: string, data?: Data, one?: boolean, builder?: boolean): Readonly<Team<Partial<PokemonSet>>[]>;
  // Sets.unpack / Teams.unpackTeam are for the dense PACKED format, not Showdown plaintext.
};
declare class Team<S extends Partial<PokemonSet>> {
  readonly team: S[];
  // ...
}
```

**We use `Teams.importTeam(rawText)`.** It accepts the human-readable Showdown export (the format pokepaste's `/raw` endpoint serves) and returns a `Team` whose `.team` is an array of `Partial<PokemonSet>`. Each `PokemonSet` (from `@pkmn/types`) carries `species`, `item`, `ability`, `level`, `moves`, `evs`, `ivs`, `nature`, `gender`, `teraType`, etc. — all optional, which matches the "almost no SPS" reality from flow §2.3.

Rejected alternatives:
- `Sets.unpack` — operates on the packed binary-ish format, not Showdown plaintext. Wrong tool.
- `Teams.unpackTeam` — same, packed format only.
- `Sets.importSet(rawText)` — single-set parser; pokepaste returns a 6-mon export, so we use the team-level entry point and iterate `.team`.

The `data?: Data` parameter (an optional `@pkmn/dex` reference) is **not** passed; we don't want `@pkmn/sets` to silently auto-correct unknown species into something legal. We do our own ref-table validation against the Champions DB.

---

## 5. Drizzle schema additions (sketch — final lands in Stage 5)

Per memory `db_orm_drizzle.md`: declarations live in `src/db/drizzle-schema.ts`; migration generated by `drizzle-kit generate`; never hand-edit the generated SQL.

```ts
// added to src/db/drizzle-schema.ts (after tournamentTeams, which lands with labmaus)
export const teamSets = sqliteTable("team_sets", {
  tournamentTeamId: text("tournament_team_id")
                       .notNull()
                       .references(() => tournamentTeams.id, { onDelete: "cascade" }),
  slot:             integer("slot").notNull(),
  speciesRosterId:  text("species_roster_id").notNull().references(() => species.id),
  item:             text("item"),
  ability:          text("ability"),
  level:            integer("level"),
  movesJson:        text("moves_json").notNull(),                  // JSON array of move display names
  spsJson:          text("sps_json"),                              // JSON object {hp,atk,def,spa,spd,spe} or NULL
  ivsJson:          text("ivs_json"),                              // JSON object or NULL
  nature:           text("nature"),
  completeness:     text("completeness").notNull(),                // 'minimal' | 'partial' | 'full'
  sourceSite:       text("source_site").notNull(),                 // always 'pokepaste'
  sourcePasteId:    text("source_paste_id").notNull(),
  sourceUrl:        text("source_url").notNull(),
  fetchedAt:        text("fetched_at").notNull(),
}, (t) => [
  primaryKey({ columns: [t.tournamentTeamId, t.slot] }),
  check("team_sets_slot_range",       sql`${t.slot} BETWEEN 0 AND 5`),
  check("team_sets_completeness_valid", sql`${t.completeness} IN ('minimal','partial','full')`),
  check("team_sets_source_site_pokepaste", sql`${t.sourceSite} = 'pokepaste'`),
  check("team_sets_level_range",      sql`${t.level} IS NULL OR (${t.level} BETWEEN 1 AND 100)`),
  check("team_sets_moves_len",        sql`json_array_length(${t.movesJson}) BETWEEN 0 AND 4`),
  check(
    "team_sets_sps_total_le_66",
    sql`${t.spsJson} IS NULL OR
        (json_extract(${t.spsJson},'$.hp')+json_extract(${t.spsJson},'$.atk')
        +json_extract(${t.spsJson},'$.def')+json_extract(${t.spsJson},'$.spa')
        +json_extract(${t.spsJson},'$.spd')+json_extract(${t.spsJson},'$.spe')) <= 66`,
  ),
  check(
    "team_sets_sps_per_stat_le_32",
    sql`${t.spsJson} IS NULL OR (
      json_extract(${t.spsJson},'$.hp')  <= 32 AND
      json_extract(${t.spsJson},'$.atk') <= 32 AND
      json_extract(${t.spsJson},'$.def') <= 32 AND
      json_extract(${t.spsJson},'$.spa') <= 32 AND
      json_extract(${t.spsJson},'$.spd') <= 32 AND
      json_extract(${t.spsJson},'$.spe') <= 32
    )`,
  ),
  index("idx_team_sets_species").on(t.speciesRosterId),
  index("idx_team_sets_item").on(t.item),
  index("idx_team_sets_ability").on(t.ability),
  index("idx_team_sets_paste_id").on(t.sourcePasteId),
]);
```

**Migration:** generated as `src/db/migrations/0002_<auto-name>.sql` by drizzle-kit. Per memory `db_orm_drizzle.md`, never hand-edit generated SQL.

---

## 6. Repository design

### 6.1 `src/db/sets.ts` (bespoke)

Same pattern as `roster.ts` / `tournaments.ts`: `WeakMap<Db, Prepared>` of pre-compiled statements; one bundle constructor per logical query. Errors wrap as `RosterDbError` (we reuse the existing class — sets share storage with roster + tournaments; tool-layer errors stay in the new `PokepasteError` family).

| Method | SQL strategy | Indexes used |
|---|---|---|
| `list(db, filter)` | `SELECT * FROM team_sets [JOIN tournament_teams ON ...] WHERE [conditional clauses on tournament_id, tournament_team_id, species_roster_id]`. Parses `moves_json`, `sps_json`, `ivs_json` into domain objects; assembles `source` block from `source_site`/`source_paste_id`/`source_url`/`fetched_at`. | `idx_team_sets_species`, PK lookups, `idx_tournament_teams_tournament_placement` (when filtering by tournament_id). |
| `get(db, tournament_team_id, slot)` | PK lookup `WHERE tournament_team_id = ? AND slot = ?`. | composite PK. |
| `usage(db, args)` | Single grouped query joining `team_sets` → `tournament_teams` → `tournaments` for the date-window filter. The `dimension` argument (`item`/`ability`/`move`/`nature`) selects which column to `GROUP BY`. For `move`, expand `moves_json` via `json_each(moves_json)` to one row per move per set. `usage_percent = 100.0 * appearances / total_sets`. `citations` aggregates `tournament_team_id`s up to a cap (e.g., 50) so payloads stay bounded. | `idx_team_sets_species`, `idx_team_sets_item`, `idx_team_sets_ability`, `idx_tournaments_format_date`. |
| `upsertTeamSets(db, sets)` | Single transaction. `INSERT … ON CONFLICT(tournament_team_id, slot) DO UPDATE SET …` for each set. Bulk-prepared statement. | composite PK. |

All exported functions get full TSDoc per CLAUDE.md §10.

### 6.2 Why `sets` cannot use `createSimpleRepo` (justification per CLAUDE.md §10)

The factory generalizes (a) one table, (b) two indexes (id, display_name), (c) a `rowToEntity`. It deliberately stops there. None of `sets`' methods fit:
- `list` filters on multiple columns, optionally joins `tournament_teams`.
- `get` is composite-keyed, not by id or display name.
- `usage` is a multi-row group-by aggregate that branches on `dimension`.
- `upsertTeamSets` is a transactional bulk write — a write path, not a read.

Same reasoning that kept `roster.ts` and `tournaments.ts` bespoke applies.

### 6.3 Reuse of upstream simple repos

The transform layer takes `itemsRepo`, `abilitiesRepo`, `movesRepo` as deps. These are the existing `createSimpleRepo`-based modules from `pokemon-roster-db` (`src/db/items.ts`, `src/db/abilities.ts`, `src/db/moves.ts`). The transform calls `.has(db, name, "RegM-A")` to validate every parsed item / ability / move; `roster.has` is used for species. No duplication.

---

## 7. Architecture patterns + the why

| Pattern | Where it lands | Why this slice |
|---|---|---|
| **Repository pattern** | `src/db/sets.ts` | Same reasoning as `roster.ts` / `tournaments.ts`: prepared statements + zod parsing in one place; the agent never sees raw SQL. |
| **Ports-and-adapters / hexagonal** | `PokepasteClient` interface vs `createPokepasteClient` impl; `transform` takes `TransformDeps`; `fetchPaste` injects both | Lets us pass a fake `fetchImpl` and a `:memory:` Db in tests without module-level globals. Mirrors labmaus and damage-calc. |
| **Anti-corruption layer** | `transform.ts` between `@pkmn/sets`'s `PokemonSet` shape and our domain | Keeps the `evs → sps` rename, the Tera strip, and the ref-table validation in one file; downstream code never sees the raw `PokemonSet`. |
| **Schema-first (zod)** | `src/schemas/team-set.ts` is the contract; types derive via `z.infer`; both ends parse before trust | Per CLAUDE.md §5. |
| **Command/query split inside the repo** | `list`/`get`/`usage` are read-only; `upsertTeamSets` is a write callable only by the ingest hook | Lets read-only DB handles power the agent at runtime; only the ingest opens read-write. |
| **Read-through, content-addressed cache** | `client.ts` checks `data/cache/pokepaste/<paste_id>.txt` before fetching; never expires (URLs are content-hashed) | Per flow §2.6 / Q6; cold-start reruns from disk for free. |
| **Idempotent upsert keyed on `(tournament_team_id, slot)`** | Composite PK; `ON CONFLICT … DO UPDATE` | Per flow §2.6 idempotency contract; two consecutive runs = zero deltas. |
| **Defense-in-depth Tera strip** | Transform deletes `teraType`; strict schema has no `tera_*`; property test scans rows | Per memory `regulation_m_a_no_tera.md`. |
| **Reject-and-fail with caller-side per-item recovery** | Transform throws `PokepasteRefValidationError`; ingest catches per-team and continues, logging | Per flow §6 Q4. The transform's purity (single failure mode) is the load-bearing property; the ingest's fan-out loop is where partial-progress lives. |

**Considered and rejected:**
- **Generic `external_sets` table reusable across pokepaste / Victory Road / Smogon analyses.** Rejected: only pokepaste exists today; premature abstraction adds an unused `source_site` partition. The `source_site` column is already there for forward compatibility without an extra table.
- **One-row-per-move table.** Rejected: moves are a fixed-length array (≤4) per set, and we only ever read them together with the set. JSON array column is the right shape; the `usage` query expands via `json_each` when it needs per-move rows.
- **Storing the full raw paste body.** Rejected: it's already in the disk cache (content-addressed, immutable), and re-deriving structured rows from raw is pure. No DB column needed.

---

## 8. Error model

| Class | Trigger | Severity | Where thrown | Where caught |
|---|---|---|---|---|
| `PokepasteInputError` | Tool-arg zod fails (malformed paste id) | user error | `fetch-paste.ts` (entry) | agent dispatcher; tests assert message |
| `PokepasteNetworkError` | HTTP non-2xx / non-404 after retries; DNS/timeout | infra | `client.ts` | `fetch-paste.ts` surfaces up; ingest hook logs and continues to next team |
| `PokepasteNotFoundError` | HTTP 404 on `/raw` (paste deleted / bad id) | data | `client.ts` | ingest hook logs and continues; the labmaus row stays without sets (per flow §4) |
| `PokepasteParseError` | `@pkmn/sets` returns `undefined` or `.team.length === 0`, OR completeness check rejects (below `minimal`) | data | `transform.ts` | ingest hook logs and continues |
| `PokepasteUnknownSpeciesError` | `roster.has(species)` returns false | data | `transform.ts` | **fails loud** in the ingest (consistency with labmaus species-map policy — indicates a roster gap that must be resolved) |
| **`PokepasteRefValidationError`** | `itemsRepo.has` / `abilitiesRepo.has` / `movesRepo.has` returns false for any parsed value | data | `transform.ts` | **ingest hook catches per-team**, records the offending value (kind + raw string + paste id + slot) in the run summary, **does not write any team_sets rows for that team**, continues to the next team. |
| `RosterDbError` (reused) | SQLite I/O on `team_sets` repo or upstream ref-table lookup | infra | `sets.ts`, ref-table repos | callers; ingest reports and exits 1 |
| `RosterDataError` (reused) | A persisted `team_sets` row fails domain schema on read | corruption | `parseOrThrow` in `sets.ts` | tests; agent path crashes loud |

### 8.1 Reject-and-fail contract (load-bearing — flow §6 Q4)

Per the flow, the transform's behavior on unknown items/abilities/moves is **non-negotiable**:

1. The transform validates every parsed item / ability / move against the Champions ref tables (`itemsRepo.has`, `abilitiesRepo.has`, `movesRepo.has`).
2. On the **first** unknown value, the transform **throws `PokepasteRefValidationError`** carrying:
   - `kind: "item" | "ability" | "move"`,
   - `value: string` (the raw display name from the paste),
   - `paste_id: string`,
   - `slot: number`.
3. The transform **MUST NOT** swallow the error and produce partial output. It returns either a complete `PasteFetchResult` or it throws.
4. The labmaus ingest's per-team `try/catch` (see §13) is the **only** place this error is caught. The catch:
   - logs the offending value into the run summary's `ref_validation_failures[]` array,
   - skips persistence of that team's `team_sets` rows (the labmaus team row stays — per flow §4 / §6 Q7),
   - continues to the next team.
5. Resolution path (per flow §4): refresh the Champions ref tables (`pnpm data:build:reg-m-a`), then re-run the labmaus ingest. The pokepaste cache means previously-successful teams cost zero network; only the previously-rejected teams will be (re-)processed.

This contract is asserted by T8 (`transform throws on unknown item, no partial output`) and T15 (`ingest catches, logs, continues`).

---

## 9. Reuse audit

**Reused (do not duplicate):**
- `RosterDbError`, `RosterDataError` from `src/schemas/errors.ts` — for `team_sets` storage I/O and corrupt-row decoding. DB errors are DB errors regardless of which table.
- `parseOrThrow` from `src/db/simple-repo.ts` — for decoding `team_sets` rows back into `TeamSet` in `sets.ts`.
- `Db`, `open()` from `src/db/open.ts` — same DB file, additive migration.
- `species` Drizzle table — `team_sets.species_roster_id` FK target.
- `tournamentTeams` Drizzle table (lands with labmaus) — `team_sets.tournament_team_id` FK target.
- `items.has`, `abilities.has`, `moves.has` from `src/db/{items,abilities,moves}.ts` — the existing `createSimpleRepo`-based ref-table repos. Used by the transform's validation step. **No new ref tables introduced** — pokepaste is a consumer, not a producer of ref data.
- `roster.has` / `roster.get` from `src/db/roster.ts` — species validation.
- The Anthropic `tool(...)` helper in `src/db/tool-definitions.ts` — extended, not duplicated.
- `zod-to-json-schema` (already a dep) — for the tool input JSON schema.
- `better-sqlite3`, `drizzle-orm`, `drizzle-kit`, `zod` — already pinned in `package.json`.
- The labmaus client's hand-rolled token-bucket throttle and file-cache primitives (lands in labmaus Stage 5 per `docs/plans/labmaus-tournaments.md` §12) — **the implementations are extracted into `src/tools/_shared/throttle.ts` + `src/tools/_shared/file-cache.ts` as a sibling-extraction step in this slice's Stage 5** so both labmaus and pokepaste consume the same primitives. The labmaus plan currently scopes them to its own `client.ts`; this plan promotes them to a shared module before the pokepaste client lands. Keeping per-host throttle buckets is then trivial: `createPokepasteClient` constructs its own bucket instance with `rps: 2`, while labmaus's stays at `rps: 1`. The token-bucket primitive itself is hostless.

**`createSimpleRepo` does NOT apply to `team_sets`** — composite PK, multi-table joins, write path. Justified in §6.2 per CLAUDE.md §10.

**NOT introduced as new dependencies:** no new HTTP client (built-in `fetch`), no new cache library (file-based, ≤30 lines, shared with labmaus), no new throttle library (token bucket, ≤20 lines, shared with labmaus). The only new package is **`@pkmn/sets@^5.2.0`** plus its transitive `@pkmn/types@^4.0.0` — explicitly justified by flow §2.6 ("battle-tested against the canonical Showdown export grammar"). `@pkmn/dex@^0.10.7` is already a dep but is **not** used here (we don't pass `data` into `Teams.importTeam` — see §4.4).

---

## 10. Test strategy + ordering

User-approved order from flow §6 Q10: **schema → transform (Tera strip + evs→sps + completeness + ref-table validation including reject-and-fail) → client (mocked HTTP, 404, throttle, cache) → repo (in-memory sqlite) → ingest hook (extends labmaus pipeline; idempotency) → contract (live, gated)**. Tests numbered in writing order.

The §3 pure-data-definition exemption (CLAUDE.md §3) applies to schema-only tests T1–T5. Everything from T6 onward is strict per-test Red→Green.

| # | Test file | Test name | Asserts | Min code to green |
|---|---|---|---|---|
| 1 | `tests/schemas/team-set.test.ts` | `TeamSetSchema parses minimal-completeness fixture` | the Charizard fixture parses; `sps`/`ivs`/`nature` are null; `completeness === "minimal"` | `TeamSetSchema` |
| 2 | `tests/schemas/team-set.test.ts` | `TeamSetSchema parses full-completeness fixture` | synthetic full fixture parses; all SPS/IVs/nature populated; `completeness === "full"` | nullable schema branches |
| 3 | `tests/schemas/team-set.test.ts` | `TeamSetSchema rejects any tera_* field via .strict()` | injected `tera_type: "Fire"` fails parse | `.strict()` |
| 4 | `tests/schemas/team-set.test.ts` | `SpsSchema rejects total > 66` | `{hp:32,atk:32,def:32,...}` fails | `.refine` |
| 5 | `tests/schemas/team-set.test.ts` | `SpsSchema rejects per-stat > 32` | `{hp:33,...}` fails | `.max(32)` per field |
| 6 | `tests/tools/pokepaste/transform.test.ts` | `transformPaste happy path on real Charizard fixture` | output matches expected `PasteFetchResult`; 6 sets in slot order | full transform impl |
| 7 | `tests/tools/pokepaste/transform-no-tera.test.ts` | `transform strips Tera Type unconditionally` | every fixture (`Tera Type: None`, `Tera Type: Fire`, mutated `teraType: "Fairy"`) → no `tera_*` in output | delete teraType in transform |
| 8 | `tests/tools/pokepaste/transform-ref-validation.test.ts` | `transform throws PokepasteRefValidationError on unknown item, no partial output` | inject "Bogus Item"; assert throw with `kind: "item"`, `value: "Bogus Item"`, `paste_id`, `slot`; assert no `PasteFetchResult` is returned | call `itemsRepo.has`; throw on miss |
| 9 | `tests/tools/pokepaste/transform-ref-validation.test.ts` | `transform throws PokepasteRefValidationError on unknown ability` | similar — `kind: "ability"` | call `abilitiesRepo.has`; throw on miss |
| 10 | `tests/tools/pokepaste/transform-ref-validation.test.ts` | `transform throws PokepasteRefValidationError on unknown move` | similar — `kind: "move"`; first unknown wins | call `movesRepo.has`; throw on miss |
| 11 | `tests/tools/pokepaste/transform-ref-validation.test.ts` | `transform throws PokepasteUnknownSpeciesError on unknown roster id` | inject `"Definitely-Not-A-Pokemon"`; assert throw | call `roster.has`; throw on miss |
| 12 | `tests/tools/pokepaste/transform-evs-to-sps.test.ts` | `transform renames evs → sps and preserves values` | hand-crafted fixture with `EVs: 252 HP / 4 Atk / ...`; assert `sps.hp === 32` (capped) and SPS-total ≤ 66 enforced — **note**: per `regulation_m_a_stat_rules.md` Champions caps are stricter than Showdown EVs; the transform is responsible for *verbatim* translation, the schema is responsible for cap rejection. Test asserts the rename is identity (post-cap-validation). | rename + schema validate |
| 13 | `tests/tools/pokepaste/transform-evs-to-sps.test.ts` | `transform rejects evs that exceed Reg M-A SPS caps` | input fixture with EV-total 510 (Showdown legal, Champions illegal); assert `PokepasteParseError` (caught at schema layer via `.refine`) | schema refine |
| 14 | `tests/tools/pokepaste/transform-completeness.test.ts` | `completeness tag minimal/partial/full computed correctly across 5 fixtures` | parameterized over each fixture; assert expected tag | tag computation |
| 15 | `tests/tools/pokepaste/transform.test.ts` | `transform handles ♂/♀ symbol in species name` | Basculegion-M fixture round-trip; species mapped to roster id | gender-symbol stripping pre-`roster.has` |
| 16 | `tests/tools/pokepaste/transform.test.ts` | `transform handles Mega Stones (Charizardite Y)` | item validates; species stays `charizard` (mega evolution implied at calc time, not at paste time) | items lookup |
| 17 | `tests/tools/pokepaste/transform.test.ts` | `transform tolerates 0–4 moves per set` | empty-moves fixture parses; assert `moves.length === 0` and `completeness === "minimal"` rejected (no moves drops below minimal) | move count branch |
| 18 | `tests/tools/pokepaste/client.test.ts` | `fetchRaw URL is correct` | mocked fetch sees `https://pokepast.es/<paste_id>/raw` | URL builder |
| 19 | `tests/tools/pokepaste/client.test.ts` | `fetchRaw throws PokepasteNotFoundError on 404 (no retry)` | mocked 404; assert one fetch call, throw with paste_id | 404 branch |
| 20 | `tests/tools/pokepaste/client.test.ts` | `fetchRaw retries 429/5xx with exp backoff` | mocked 429,429,200; assert 3 attempts | retry loop |
| 21 | `tests/tools/pokepaste/client.test.ts` | `fetchRaw surrenders after maxRetries on 5xx` | throws `PokepasteNetworkError` carrying `.status` | error wrap |
| 22 | `tests/tools/pokepaste/client.test.ts` | `client throttles to 2 rps with its own bucket (independent of labmaus)` | inject clock; fire 5 calls; assert pacing matches 2 rps; pass through a separate fake labmaus bucket asserted unaffected | shared throttle primitive, two instances |
| 23 | `tests/tools/pokepaste/client.test.ts` | `client reads from disk cache when present (no expiry)` | seed cache file with old timestamp; fetchImpl asserted unused | cache read |
| 24 | `tests/tools/pokepaste/client.test.ts` | `client writes to disk cache after a 200 fetch` | post-call, file exists with response body | cache write |
| 25 | `tests/tools/pokepaste/client.test.ts` | `client does NOT cache 404 responses` | first call 404, file does not exist; second call hits the network again | conditional cache write |
| 26 | `tests/tools/pokepaste/fetch-paste.test.ts` | `fetchPaste returns parsed PasteFetchResult on injected client + DB` | end-to-end injected; output matches golden | tool wiring |
| 27 | `tests/tools/pokepaste/fetch-paste.test.ts` | `fetchPaste re-raises PokepasteRefValidationError without swallowing` | ingest-style assertion: error reaches the top-level `await`; no `PasteFetchResult` returned | no-catch in fetchPaste |
| 28 | `tests/tools/pokepaste/tool-definitions.test.ts` | `pokepaste + sets tools have stable JSON schemas` | snapshot test, no `$ref` | reuse `tool(...)` helper |
| 29 | `tests/db/sets.test.ts` | `upsertTeamSets inserts 6 rows in a transaction` | post-call rows match input | upsert impl |
| 30 | `tests/db/sets.test.ts` | `upsertTeamSets is idempotent` | run twice; row counts unchanged | conflict clause |
| 31 | `tests/db/sets.test.ts` | `list filters by tournament_id, tournament_team_id, species_roster_id` | seeded; assert each filter | conditional WHERE |
| 32 | `tests/db/sets.test.ts` | `get returns null on miss` | unseeded composite key returns null | PK lookup |
| 33 | `tests/db/sets.test.ts` | `usage(species, dimension="item") returns ranked list with usage_percent` | known seed (e.g. 4 of 4 Sneaslers on Focus Sash); assert ordering and citations | aggregate query |
| 34 | `tests/db/sets.test.ts` | `usage(species, dimension="move") expands moves_json correctly` | seed; assert each move's appearance count | `json_each` expansion |
| 35 | `tests/db/sets.test.ts` | `usage respects lookback_days via tournament join` | seed two tournaments at different dates; assert older filtered out | join + WHERE on `tournaments.date` |
| 36 | `tests/db/sets-no-tera.test.ts` | `no row in team_sets has any column or JSON key matching /tera/i` | introspect schema and scan all `moves_json` / `sps_json` / `ivs_json` blobs | (vacuous green if §5 schema is right; explicit guard catches future regressions — flagged for §3 vacuous-green slip in change report) |
| 37 | `tests/scripts/ingest-pokepaste-hook.test.ts` | `ingest hook: happy path persists 6 team_sets per labmaus team` | seed labmaus tournament; --no-network with seeded paste cache; run ingest; assert 6 team_sets per team | hook wiring + upsertTeamSets |
| 38 | `tests/scripts/ingest-pokepaste-hook.test.ts` | `ingest hook: PokepasteRefValidationError → log warning, skip team, continue` | seed two teams (one with bogus item); assert (a) team A persisted (6 rows), (b) team B persisted 0 rows, (c) run summary contains `ref_validation_failures` entry with kind/value/paste_id/slot, (d) exit code 0 | per-team try/catch in §13 |
| 39 | `tests/scripts/ingest-pokepaste-hook.test.ts` | `ingest hook: 404 → log warning, skip team, continue (labmaus row preserved)` | seed cache that returns 404; assert 0 team_sets, labmaus row intact, run summary entry | 404 branch in catch |
| 40 | `tests/scripts/ingest-pokepaste-hook.test.ts` | `ingest hook: PokepasteUnknownSpeciesError fails loud (exit 1)` | inject unknown species; assert ingest aborts with exit 1 and the offending paste_id is logged | re-raise (no catch) for this class |
| 41 | `tests/scripts/ingest-pokepaste-idempotency.test.ts` | `running ingest twice produces zero team_sets deltas` | snapshot DB hash before+after second run; equal | (no new code if T30 green) |
| 42 | `tests/contract/pokepaste-live.test.ts` (gated by `RUN_CONTRACT_TESTS=1`) | `live pokepaste /raw for a known stable paste id parses without throwing` | real fetch; `Teams.importTeam(body)` returns a team with `.team.length >= 1`; transform succeeds end-to-end | (no new code) |

T36 qualifies for the §3 "vacuous green slip" flag — the implementor must call it out in their change report so the reviewer can confirm the property holds rather than the test holding nothing.

---

## 11. Fixtures plan

All fixtures committed and immutable; filenames carry capture date.

```
fixtures/pokepaste/
  2026-05-04__7205bf28f85d1e79.txt           (1st-place team — minimal completeness, real)
  2026-05-04__a5f32930d39e424e.txt           (2nd-place — minimal, real)
  2026-05-04__synthetic-full-spread.txt      (hand-crafted: full SPS+IVs+Nature, all six mons full)
  2026-05-04__synthetic-partial.txt          (hand-crafted: SPS only, no IVs/nature, mixed across mons)
  2026-05-04__synthetic-edge-cases.txt       (Mega Stone, regional form -alola, Basculegion ♂, empty-moves mon, missing ability line)
```

Variety dimensions (per CLAUDE.md §11):
- **Real vs synthetic.** Two real for parser realism; three synthetic for edge-case coverage.
- **Completeness spread.** Two `minimal`, one `partial`, one `full`, one mixed.
- **Reg M-A hygiene.** Every fixture contains a `Tera Type:` line (most `None`, one `Fire`, one omitted) so T7 has full coverage.
- **Species edge cases.** `♂/♀` symbol, Mega Stones, regional forms, missing ability.

Capture procedure (one-shot, executed at fixture-creation time, NOT during this Stage 3):
1. `curl 'https://pokepast.es/<id>/raw' > fixtures/pokepaste/<date>__<id>.txt`
2. Hand-author the synthetic fixtures based on the Showdown-export grammar (verifiable by running `Teams.importTeam` against them at fixture-add time).
3. For T8/T9/T10 (ref-validation), the test mutates the in-memory text — fixture files do NOT contain bogus items (keeps fixtures realistic; bogus values are injected programmatically in the test).

---

## 12. Cache + throttle implementation

**Hand-rolled, no new deps.** Both primitives are extracted to `src/tools/_shared/` as a Stage-5 sibling-extraction step (see §9 for the rationale and labmaus interaction).

### 12.1 Throttle — separate buckets per host

Per flow §6 Q6: pokepaste at **2 rps**, labmaus stays at **1 rps**. The token-bucket primitive itself is **hostless** — each `Client` constructs its own instance:

```ts
// src/tools/_shared/throttle.ts (sibling-extracted from labmaus client)
export interface TokenBucketOpts { capacity: number; refillPerSec: number; clock?: () => number; }
export interface TokenBucket { acquire(): Promise<void>; }
export function createTokenBucket(opts: TokenBucketOpts): TokenBucket;
```

`createPokepasteClient` constructs `createTokenBucket({ capacity: 1, refillPerSec: 2 })`; the labmaus client constructs `createTokenBucket({ capacity: 1, refillPerSec: 1 })`. **Each client has its own bucket instance — no shared state. This is the correct shape for "separate throttle bucket per host" because the two clients are constructed once each per process and their buckets do not interact.** Verified by T22 which exercises both buckets in the same test process.

Alternative considered: a global `Map<host, TokenBucket>`. Rejected — over-engineers for two known hosts, and the two clients already have separate constructor sites where the literal RPS value documents itself.

### 12.2 Disk cache — content-addressed, no expiry

- Path: `data/cache/pokepaste/<paste_id>.txt`. Body is the raw plaintext. Read path: `fs.existsSync(path)` → `fs.readFileSync(path, "utf8")`. Write path: atomic write (`tmp + rename`).
- TTL: **never expires**. Pokepaste URLs are content-hashes; a 200 response is immutable. Eviction: manual `rm`.
- 404 responses are NOT cached (so a paste that gets re-uploaded eventually starts working without a manual cache nuke).
- **Cache key includes all inputs per CLAUDE.md §8** — the input is just `paste_id`, and the file path is `<paste_id>.txt`. Verified by T18 (URL builder) and T23–T25 (cache behavior).

### 12.3 Retry

On `429`/`5xx`: sleep `backoffBaseMs * 2^attempt` (jittered ±20%); up to `maxRetries=3`. `4xx` other than 429 maps directly: 404 → `PokepasteNotFoundError` (no retry); other 4xx → `PokepasteNetworkError`.

### 12.4 Gitignore additions

Append `data/cache/pokepaste/` to `.gitignore`. Fixture files under `fixtures/pokepaste/` stay committed.

---

## 13. Ingest / build orchestration

This slice does NOT add a new top-level script — it **extends** `scripts/data/ingest-labmaus.ts` with a per-team hook. Per flow §2.8:

```ts
// Pseudocode — final lands in Stage 5. Inside the per-tournament loop in scripts/data/ingest-labmaus.ts.

const pokepasteClient = createPokepasteClient({
  cacheDir:      "data/cache/pokepaste",
  throttleRps:   2,                              // separate bucket; flow §6 Q6
  maxRetries:    3,
  backoffBaseMs: 1000,
  fetchImpl:     opts.noNetwork ? cacheOnlyFetch : fetch,
});

const transformDeps: TransformDeps = {
  db,
  rosterRepo:     { has: roster.has,    get: roster.get },
  itemsRepo:      itemsRefRepo,
  abilitiesRepo:  abilitiesRefRepo,
  movesRepo:      movesRefRepo,
};

for (const team of detail.teams) {
  // Idempotency: skip if team_sets already exist for this team_id.
  if (sets.list(db, { tournament_team_id: team.id }).length > 0) continue;

  const paste_id = extractPasteId(team.team_url);
  if (!paste_id) { warn("non-pokepaste team_url", { team_id: team.id, url: team.team_url }); continue; }

  try {
    const result = await fetchPaste({ paste_id }, {
      client:             pokepasteClient,
      transform:          transformDeps,
      tournament_team_id: team.id,
    });
    sets.upsertTeamSets(db, result.sets);
    runSummary.team_sets += result.sets.length;
  } catch (e) {
    if (e instanceof PokepasteNotFoundError) {
      runSummary.pokepaste_404s.push({ team_id: team.id, paste_id });
      continue;
    }
    if (e instanceof PokepasteParseError || e instanceof PokepasteNetworkError) {
      runSummary.pokepaste_failures.push({ team_id: team.id, paste_id, message: (e as Error).message });
      continue;
    }
    if (e instanceof PokepasteRefValidationError) {
      // Reject-and-fail per-team (flow §6 Q4). Transform threw; we log and continue.
      runSummary.ref_validation_failures.push({
        team_id: team.id,
        paste_id,
        kind:    e.kind,
        value:   e.value,
        slot:    e.slot,
      });
      continue;
    }
    // Unknown species → fail loud (consistency with labmaus species-map policy).
    if (e instanceof PokepasteUnknownSpeciesError) throw e;
    // Anything else is also fail-loud.
    throw e;
  }
}
```

### Argv handling

Inherits `--mode`, `--from`, `--to`, `--db`, `--no-network` from labmaus. New flag:
- `--skip-pokepaste` — bypass the pokepaste hook entirely (useful for labmaus-only re-runs while pokepaste schema is in flux).

### Parallelism

The labmaus per-tournament parallelism stays at 4 (per labmaus plan §13). Inside a single tournament, the per-team pokepaste hook runs **serially** in v1 — the throttle bucket (2 rps) is the natural limit, and parallelism inside one tournament saves at most 30 mons × 0.5 s = 15 s while complicating error attribution. v2 may parallelize via `pMap` if profiling shows it matters.

### Exit codes

Inherits labmaus's. `0` includes runs with bounded `pokepaste_404s` / `pokepaste_failures` / `ref_validation_failures`. `1` on `PokepasteUnknownSpeciesError` or DB error.

### Observability

Single JSON-line summary on stdout at the end; per-team progress to stderr. The new arrays in the run summary:
- `pokepaste_404s: Array<{team_id, paste_id}>`
- `pokepaste_failures: Array<{team_id, paste_id, message}>`
- `ref_validation_failures: Array<{team_id, paste_id, kind, value, slot}>`

---

## 14. Definition of Done mapping (CLAUDE.md §11)

| Box | This slice |
|---|---|
| Flow doc reviewed | YES — `docs/flows/pokepaste-sets.md` Stage 2 approved 2026-05-04. |
| Tech plan approved | THIS DOC — pending. |
| Failing test first (commit history visible) | enforced by Stage 4 ordering in §10; commit `test: red — pokepaste-sets`. |
| `pnpm test` passes | Stage 5 exit gate. |
| `pnpm typecheck` passes | Stage 5 exit gate; strict TS, typed signatures everywhere per §2 module specs. |
| `pnpm lint` passes | Stage 5 exit gate. |
| New external data schema-validated and fixture-backed | `TeamSetSchema` + `PasteFetchResultSchema` + 5 fixtures (§11). |
| User-facing claim cited | every persisted record carries `source.site = "pokepaste"` + `source_url` + `fetched_at`. |
| Docs touched | `tools/pokepaste/SPEC.md` written first; `package.json` adds `@pkmn/sets` dep; `.gitignore` updated. The labmaus plan is revised in lockstep (sibling deliverable per flow §6 Q8). |
| Reviewer subagent ran | Stage 6. |

**Uncovered by this slice (explicitly):** none. `tournaments.usage` now ships with full `species + items + moves + cores` dimensions on day one (the labmaus plan revision restores the items/moves dimensions previously gated on this slice); see the labmaus plan §17 Q1 entry which is now **resolved**.

---

## 15. Rollout / feature-flag

- **Always-on, no flag.** New tools and the new table don't affect existing surfaces; the agent's tool catalog gains one tool (`pokepaste_fetch_paste`) plus three sets-repo tools, all inert until invoked.
- **Migration ordering vs labmaus.** Labmaus ships migration `0001_*.sql` (creates `tournaments`, `tournament_teams`, etc.). This slice ships migration `0002_*.sql` (creates `team_sets` with FK to `tournament_teams`). drizzle-kit's incremental generation handles ordering automatically. Hard dependency: **labmaus tables must exist before `team_sets`**; documented in SPEC.md and enforced by FK at apply time.
- **Hard dependency on ref tables.** `items`, `abilities`, `moves` must be populated before any pokepaste ingest runs. The ingest script's existing pre-flight check (`SELECT COUNT(*) FROM species`) is extended to also assert `SELECT COUNT(*) FROM items > 0` etc.
- **Backfill cadence.** Same as labmaus — manual at ship; the labmaus weekly cron picks up new pastes for free (the cache means already-ingested pastes cost zero network).
- **`@pkmn/sets` version pin.** Pin `^5.2.0` in `package.json` (see §4.4). Major-version bumps gated on a manual diff of the pinned API surface.

---

## 16. Risks + mitigations

1. **`@pkmn/sets` parse drift across minor versions.** A minor `@pkmn/sets` bump could change how missing fields surface (e.g., `evs: undefined` vs absent key). **Mitigation:** weekly contract test (T42) gated by `RUN_CONTRACT_TESTS=1`; T6/T12–T14 lock the parser's current behavior against committed fixtures; minor-version bumps must keep these green.
2. **Pokepaste schema drift / new field.** Pokepaste exports could acquire a new line (e.g., a Z-Move-style annotation). **Mitigation:** `Teams.importTeam` is permissive — unknown lines surface in unmapped fields, which our domain schema's `.strict()` catches at validation time. The transform's `for-of` over known fields means new fields are silently dropped unless they're a `tera*` regression (defense-in-depth catches that explicitly).
3. **Champions ref-table churn outpaces pokepaste fixtures.** A new item (e.g., a meta patch adds "Booster Energy II") arrives in production pastes before our ref tables refresh. With reject-and-fail, every team using it is skipped, and the run summary fills with `ref_validation_failures`. **Mitigation:** flow §4 names the resolution path explicitly (`pnpm data:build:reg-m-a` then re-run; cache makes it free); T38 asserts the path works; the ingest summary is grep-friendly so the drift is observable.
4. **Cross-team partial progress hides bugs.** A latent transform bug that only fires on certain pastes (e.g., one specific item's display-name casing) gets swallowed as `ref_validation_failures` and the run keeps going. **Mitigation:** the run summary is structured + non-empty failure arrays cause stderr to print a concrete count; weekly review of failed counts is part of the operator runbook (added to SPEC.md). If `ref_validation_failures.length > 5% of teams` for a single run, exit 2 (operator escalation) — implemented as a final gate after the loop.
5. **Disk-cache content rot via partial writes.** A killed process mid-write could leave a half-written `<paste_id>.txt`. **Mitigation:** atomic write (`tmp + rename`) — the canonical small-cache idiom; T24 asserts the rename happens. Re-runs naturally re-fetch missing files.

---

## 17. Open questions for plan review

1. **Shared throttle/cache extraction sequencing.** §9 promotes the labmaus client's hand-rolled token-bucket and file-cache into `src/tools/_shared/` as part of *this* slice's Stage 5. Alternative: ship pokepaste with copy-pasted primitives in v1, dedupe in a follow-up. **Proposal:** extract now (≤30 lines, two consumers, premature-abstraction risk is low). Reviewer confirms.
Answer: Extract now
2. **`fetchPaste` agent surface.** The tool needs `tournament_team_id` to produce stable `TeamSet.id` values, but it's a dep, not an input arg, so the JSON-Schema-described tool input is just `{ paste_id }`. An agent calling the tool *without* a known `tournament_team_id` couldn't persist results. Two options: (a) keep current design — the agent calls `fetchPaste` only via the ingest path; the tool is registered for *parsing-without-persistence* use cases (e.g., "explain this paste"). (b) make `tournament_team_id` part of the tool input, optional; the tool returns sets with synthetic ids when omitted. **Proposal:** (a). Reviewer confirms.
Answer: Keep current design; `tournament_team_id` is a dep, not an input arg.

3. **`usage` citation cap.** §6 caps `citations[]` at 50 to bound payload size; for very common items (Focus Sash) we'd hit the cap fast. Trade-off vs LLM context cost. **Proposal:** cap at 50, sorted by `placement ASC, completeness DESC` so the most authoritative citations win. Reviewer confirms.
Answer: Cap at 50, sorted by placement and completeness.

**Flow-doc gap uncovered:** flow §2.5 specifies `completeness = "minimal"` requires `species + item + ability + moves`, but doesn't say what happens if `moves.length === 0` (a real edge case in the synthetic edge-cases fixture). Strict reading: "moves" is required → empty list fails. Plan as written: `moves.length === 0` drops the set below `minimal`, so the transform throws `PokepasteParseError` and the team is skipped. T17 asserts this. Calling out for explicit confirmation before Stage 5.
Answer: Yes, `moves.length === 0` fails minimal completeness and causes a parse error. This is consistent with the intended semantics of "minimal" and is explicitly asserted by T17.

---

## 18. Cross-slice note (2026-05-05): single source of truth for species attribution

The labmaus-tournaments slice originally maintained its own
`species_alias_labmaus` ref table to translate labmaus dex ids (`"038-a"`,
`"902"`, `"479-w"`) into canonical roster ids. After the labmaus slice's
post-ship simplification (`docs/plans/labmaus-tournaments.md` §18.5), that
table — and the entire labmaus-side species mapping — is gone. **Pokepaste
is now the sole source of canonical species attribution.** The pokepaste
parser yields Showdown species names that match our roster ids directly;
`team_sets.species_roster_id` is the only authoritative roster-id column
for tournament team composition.

Implications for this slice:

- The `species_roster_id` resolution path (parser → roster lookup) is
  load-bearing for downstream queries (`tournaments.usage`,
  `tournaments.teams_with`) — those queries now read from `team_sets`
  exclusively for species data.
- A pokepaste 404 (or any failed paste fetch) leaves a tournament team
  with `tournament_team_species (slot, labmaus_id)` and a
  `tournament_teams.team_url` but **no canonical roster_id**. That is the
  acceptable failure mode the labmaus simplification took on; this slice
  is responsible for shrinking that failure window over time (better
  retry policy, alternate sources, etc.).
- Reject-and-fail (§8.1) on a parser failure remains correct — silently
  fabricating roster ids would corrupt the keyspace shared with `usage`.
