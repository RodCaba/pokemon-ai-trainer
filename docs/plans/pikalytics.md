# Tech Plan — Pikalytics Usage Stats

**Slug:** `pikalytics`
**Stage:** Stage 3 approved (2026-05-06). Stage 4 (red tests) pending.
**Approved-by:** Rodrigo Caballero (2026-05-06)
**Date:** 2026-05-06
**Author:** Tech Lead subagent
**Implements flow doc:** `docs/flows/pikalytics.md` (Stage 2 approved 2026-05-06 by Rodrigo Caballero)
**Memory citations:**
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/db_orm_drizzle.md`
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/data_layer_two_tier_db.md`
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/single_db_non_destructive_build.md`
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/regulation_m_a_no_tera.md`
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/regulation_m_a_stat_rules.md`
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/regulation_m_a_roster.md`
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/labmaus_pokepaste_deferred_todos.md`

**Sibling precedents:** `docs/plans/pokepaste-sets.md` (HTTP-source + transform + ref-table validation + agent-tool registration discipline); `docs/plans/labmaus-tournaments.md` (full-roster ingest loop, run summary fields, skip-existing pattern, contract-test gating).

---

## 1. Goal recap

Ship the third meta-intelligence source: a thin, agent-callable HTTP tool family backed by a Drizzle `pikalytics_snapshots` table, populated by a weekly `scripts/data/ingest-pikalytics.ts` script that walks all 286 Reg-M-A roster species against Pikalytics's AI-Markdown endpoint. Per flow §6 answers: iterate the full roster (404s logged as "not in coverage"); skip-existing on `(species_roster_id, as_of)` keeps re-runs free; two agent tools register on day one (`pikalyticsTeammatesTool` first-class for the user's primary use case, `pikalyticsUsageTool` as the umbrella with a `dimension` discriminator); strictly Pikalytics with no cross-source merging in this slice; permissive parser on optional sections, strict on `as_of` + `usage_percent`; both `source_url` (human, citation surface) and `ai_url` (machine, refresh) persist; teammate name → roster id resolves through the existing `roster.get` (no new alias table); unresolved teammates log to `unknown_teammate_names[]` and are excluded from `teammates_json`. Done means: ≥5 fixtures round-trip, two consecutive ingests produce zero `pikalytics_snapshots` deltas, no `tera_*` field appears in any persisted row, both agent tools are registered in `ROSTER_TOOL_DEFINITIONS`, cold-start ingest of 286 species completes in under 10 minutes on a laptop, weekly refresh under 60 seconds when nothing changed.

---

## 2. Module boundaries

All paths absolute under `/Users/rodrigo/src/pokemon-ai-trainer/`. New files only — files marked *(extend)* are additive edits to existing files.

### Schemas (`src/schemas/`)

#### `src/schemas/pikalytics.ts` (new)

- **Single responsibility:** zod schemas + inferred types for the pikalytics domain — `TeammateEntry`, `FrequencyEntry`, `PikalyticsSourceBlock`, `PikalyticsSnapshot`, plus tool-input shapes `PikalyticsFetchSpeciesArgs`, `PikalyticsTeammatesArgs`, `PikalyticsUsageArgs`, and the response row type `PikalyticsUsageRow`. One file per slice (matches `team-set.ts` and `tournament.ts` precedent).
- **Exported surface:**
  ```ts
  export const TeammateEntrySchema:           z.ZodObject<…>;   // {roster_id, percent}
  export const FrequencyEntrySchema:          z.ZodObject<…>;   // {name, percent}
  export const PikalyticsSourceBlockSchema:   z.ZodObject<…>;   // {site, source_url, ai_url, fetched_at}
  export const PikalyticsSnapshotSchema:      z.ZodObject<…>;   // strict; no tera_* fields
  export const PikalyticsFetchSpeciesArgsSchema: z.ZodObject<…>;
  export const PikalyticsTeammatesArgsSchema:    z.ZodObject<…>;
  export const PikalyticsUsageArgsSchema:        z.ZodObject<…>;
  export const PikalyticsUsageRowSchema:         z.ZodObject<…>;
  export type TeammateEntry              = z.infer<typeof TeammateEntrySchema>;
  export type FrequencyEntry             = z.infer<typeof FrequencyEntrySchema>;
  export type PikalyticsSourceBlock      = z.infer<typeof PikalyticsSourceBlockSchema>;
  export type PikalyticsSnapshot         = z.infer<typeof PikalyticsSnapshotSchema>;
  export type PikalyticsFetchSpeciesArgs = z.infer<typeof PikalyticsFetchSpeciesArgsSchema>;
  export type PikalyticsTeammatesArgs    = z.infer<typeof PikalyticsTeammatesArgsSchema>;
  export type PikalyticsUsageArgs        = z.infer<typeof PikalyticsUsageArgsSchema>;
  export type PikalyticsUsageRow         = z.infer<typeof PikalyticsUsageRowSchema>;
  ```
- **TSDoc obligations (CLAUDE.md §10):** every exported schema and type carries the six-element block. `@example` for `PikalyticsTeammatesArgs` and `PikalyticsUsageArgs`.
- **Does NOT do:** any HTTP, any DB I/O, any roster lookup. The Tera strip is enforced at the **transform** layer; the schema's `.strict()` is the second line of defense (no `tera_*` keys defined → strict rejects anything that leaked through).

#### `src/schemas/errors.ts` (extend)

- Add a `PikalyticsError` family. Same constructor pattern as `PokepasteError` / `LabmausError`.
- **New exports:**
  - `PikalyticsError` — base class. Carries `.cause`, optional `.species_roster_id`.
  - `PikalyticsInputError` — tool-arg zod failure (unknown roster id, bad limit, etc.).
  - `PikalyticsNetworkError` — HTTP non-2xx (other than 404) after retries; `.status` carries the last status seen.
  - `PikalyticsNotFoundError` — HTTP 404 (species not in Pikalytics's coverage). The ingest script logs and continues.
  - `PikalyticsParseError` — Markdown parser couldn't extract the required `as_of` + `usage_percent`. Optional sections missing are NOT errors (per flow §6 Q5). Non-fatal at ingest level — logged into `parse_failures[]`.
  - `PikalyticsTeraLeakError` — defense-in-depth: any `tera_*` key surfaced in the parsed structure. Programmer-bug class; **fail-loud**.

### Tool layer (`src/tools/pikalytics/`)

#### `src/tools/pikalytics/SPEC.md` (new — written first per CLAUDE.md §8)

- **Single responsibility:** the tool spec doc. Documents inputs/outputs/edge cases for the agent-callable surface (`pikalytics.fetchSpecies`, `pikalytics.teammates`, `pikalytics.usage`). Documents the AI-Markdown endpoint contract, the `as_of` parsing rule, the format-slug pin (`gen9championsvgc2026regma`), the URL builder, the cache-key shape, the throttle policy (1 rps shared bucket — see §12), the **permissive-on-optional-sections / strict-on-required-headers** parser contract, the **Tera strip** rule, the JSON-Schema descriptions of both registered agent tools. Authored before any test or code per CLAUDE.md §8 sub-bullet "Adding a new tool".

#### `src/tools/pikalytics/client.ts` (new)

- **Single responsibility:** thin HTTP client around `GET https://www.pikalytics.com/ai/pokedex/<format-slug>/<species-slug>`. Enforces throttle (1 rps; conservative default per Cloudflare-fronted hosts), exponential-backoff retry on transient failures, and a content-stable disk cache (TTL = `Number.POSITIVE_INFINITY`; key includes `as_of`).
- **Exported surface:**
  ```ts
  export interface PikalyticsClientOptions {
    cacheDir:      string;                 // absolute path under data/cache/pikalytics
    throttleRps:   number;                 // default 1
    maxRetries:    number;                 // default 3
    backoffBaseMs: number;                 // default 1000
    fetchImpl?:    typeof fetch;           // injectable for tests
    clock?:        () => number;           // injectable for tests
  }
  export interface PikalyticsRawFetch {
    body:       string;                    // raw markdown
    source_url: string;                    // human URL
    ai_url:     string;                    // machine URL
  }
  export interface PikalyticsClient {
    /** Fetch the raw markdown body (uncached behavior tested in §10 T20–T24). */
    fetchSpeciesMarkdown(species_slug: string, as_of_hint?: string): Promise<PikalyticsRawFetch>;
  }
  export function createPikalyticsClient(opts: PikalyticsClientOptions): PikalyticsClient;
  ```
- **TSDoc:** full block on `createPikalyticsClient` and `fetchSpeciesMarkdown`.
- **Does NOT do:** validate, parse, persist, or resolve roster ids. Returns plaintext markdown (or both URLs) or throws `PikalyticsNetworkError` / `PikalyticsNotFoundError`. The cache key is `<species_slug>__<as_of_hint?>`; first fetch (no `as_of_hint`) misses; the response body's parsed `as_of` is what subsequent calls key on, so steady-state cold restarts hit cache. (Acceptable trade — the script always knows `as_of` after the first parse and re-keys reads if needed; v1 just re-fetches once per cold start per species.)

#### `src/tools/pikalytics/parse-markdown.ts` (new)

- **Single responsibility:** pure-function Markdown extractor. Given the raw markdown string, return a structured intermediate `RawSnapshot`:
  ```ts
  export interface RawSnapshot {
    as_of:        string;                       // "2026-05-07"
    usage_percent: number;                      // 40.13
    teammates:    Array<{ display_name: string; percent: number }>;
    items:        Array<{ name: string; percent: number }>;
    abilities:    Array<{ name: string; percent: number }>;
    moves:        Array<{ name: string; percent: number }>;
    raw_warnings: string[];                     // e.g. "missing Common Items section"
  }
  export function parsePikalyticsMarkdown(raw: string): RawSnapshot;
  ```
- **Contract (per flow §6 Q5):** **permissive on optional sections** (missing sections produce empty arrays + a warning), **strict on `as_of` + `usage_percent`** (missing → throw `PikalyticsParseError`).
- Regexes (sketch): `/^>\s*Data as of\s+(\d{4}-\d{2}-\d{2})/m` for `as_of`; `/^##\s+Usage\n+([\d.]+)%/m` for usage; per-section `/^-\s+\*\*(.+?)\*\*:\s+([\d.]+)%/gm` after locating the section header. Each regex anchored, multiline-flagged, isolated — per pokepaste's lesson (T17/T20 fixture-collision bugs) the parser is tested independently of the transform.
- **Does NOT do:** roster resolution, schema validation, tera-strip, HTTP. Pure string → struct.

#### `src/tools/pikalytics/transform.ts` (new)

- **Single responsibility:** raw markdown → `PikalyticsSnapshot`. Orchestrates: `parsePikalyticsMarkdown` → tera-strip property check → roster-id resolution for teammates → schema validate. Builds the `id` (`pikalytics:<format-slug>:<species_roster_id>:<as_of>`) and the `source` block (both URLs + `fetched_at`).
- **Exported surface:**
  ```ts
  export interface PikalyticsTransformDeps {
    db: Db;
    rosterRepo: { has(db: Db, name: string, format: "RegM-A"): boolean;
                  get(db: Db, name: string, format: "RegM-A"): { id: string } | null };
  }
  export interface PikalyticsTransformInput {
    species_roster_id: string;
    raw_markdown:      string;
    source_url:        string;
    ai_url:            string;
    fetched_at:        string;                  // ISO-8601 UTC
  }
  export interface PikalyticsTransformResult {
    snapshot:                PikalyticsSnapshot;
    unknown_teammate_names:  string[];          // names that didn't resolve via roster.get
  }
  export function transformPikalyticsMarkdown(
    input: PikalyticsTransformInput,
    deps:  PikalyticsTransformDeps,
  ): PikalyticsTransformResult;
  ```
- **Tera-strip discipline (per memory `regulation_m_a_no_tera.md`):** the transform asserts no key in the parsed `RawSnapshot` (or anywhere in the assembled snapshot) matches `/tera/i`. Property check; on hit, throws `PikalyticsTeraLeakError`. Defense-in-depth: schema is `.strict()` and has no `tera_*` field defined.
- **Teammate resolution (per flow §6 Q7):** for each `{display_name, percent}`, call `roster.get(db, display_name, "RegM-A")`. If hit, push `{roster_id, percent}` into `teammates_json`. If miss, drop the entry from `teammates_json` and append `display_name` to `unknown_teammate_names`. Returned to caller for run-summary aggregation.
- **Does NOT do:** HTTP, DB writes, throttle, cache. Returns either a complete `PikalyticsTransformResult` or throws (`PikalyticsParseError`, `PikalyticsTeraLeakError`).

#### `src/tools/pikalytics/fetch-species.ts` (new — public tool fn)

- **Single responsibility:** the `pikalytics.fetchSpecies` agent-callable tool. Validates input via `PikalyticsFetchSpeciesArgsSchema`, derives the species slug from `roster.get(species_roster_id).display_name` (lowercase), calls the client, calls the transform, returns `PikalyticsSnapshot`.
- **Exported surface:**
  ```ts
  export async function fetchSpecies(
    args: PikalyticsFetchSpeciesArgs,
    deps: { client: PikalyticsClient; transform: PikalyticsTransformDeps },
  ): Promise<PikalyticsSnapshot>;
  export const pikalyticsFetchSpeciesToolDefinition: Tool;   // legacy / debug surface
  ```
- The "human" tool surface is `pikalyticsTeammatesTool` + `pikalyticsUsageTool` (see §4); `fetchSpecies` is a lower-level building block primarily called by the ingest script. Both are registered in `ROSTER_TOOL_DEFINITIONS` from day one (per flow §6 Q3 + the explicit lesson learned from pokepaste's Stage 6 BLOCKER).

### DB layer (`src/db/`)

#### `src/db/drizzle-schema.ts` (extend, do NOT replace)

- Add one `sqliteTable` declaration: `pikalyticsSnapshots`. FK from `pikalyticsSnapshots.speciesRosterId` → `species.id`. Unique on `(speciesRosterId, asOf)`. See §5.

#### `src/db/migrations/00XX_pikalytics_snapshots.sql` (new — drizzle-kit generated)

- Generated by `pnpm drizzle-kit generate` after the schema additions land. Filename auto-numbered after the latest committed migration (currently `0004_*`); will land as `0005_<auto>.sql` (or higher if an interleaving slice ships first — drizzle-kit handles ordering).

#### `src/db/pikalytics.ts` (new — bespoke repo)

- **Single responsibility:** the bespoke pikalytics repo. Implements `get`, `teammates`, `usage`, plus the package-private `upsertSnapshot(db, snapshot): void` used by the ingest script. Cannot use `createSimpleRepo` because: (a) lookups are by `species_roster_id` returning the *latest* row (composite key `(species, as_of)` resolved via `ORDER BY as_of DESC LIMIT 1`); (b) `teammates` and `usage(dimension="teammate")` expand a JSON column via `json_each(teammates_json)` and rank; (c) `usage` discriminates on `dimension` and joins through different JSON columns. Per CLAUDE.md §10 the factory deliberately doesn't generalize that far.
- **Exported surface (signatures only — bodies in Stage 5):**
  ```ts
  export function get(db: Db, args: { species_roster_id: string }): PikalyticsSnapshot | null;
  export function teammates(db: Db, args: { species_roster_id: string; limit?: number }): TeammateEntry[];
  export function usage(db: Db, args: PikalyticsUsageArgs): PikalyticsUsageRow[];
  export function upsertSnapshot(db: Db, snapshot: PikalyticsSnapshot): { inserted: boolean };
  export function exists(db: Db, species_roster_id: string, as_of: string): boolean;
  ```
- **TSDoc:** all six elements per export per CLAUDE.md §10. Mirrors `roster.ts` / `tournaments.ts` / `sets.ts`.

#### `src/db/tool-definitions.ts` (extend)

- Append **two** tool definitions to `ROSTER_TOOL_DEFINITIONS` (per flow §6 Q3 — both registered on day one):
  - `pikalyticsTeammatesTool` — first-class. Input `{ format: "RegM-A", species: <RosterId>, limit?: number }`. Description disambiguates from `pikalyticsUsageTool`.
  - `pikalyticsUsageTool` — umbrella with `dimension` discriminator (`species | item | ability | move | teammate`). Input `{ format, dimension, species?: RosterId, limit?: number }` with cross-field validation (when `dimension !== "species"`, `species` is required).
- The lower-level `pikalyticsFetchSpeciesTool` is **also** appended (debug / parsing-without-persistence surface) — three new tools total, mirroring pokepaste's "fetch + repo-tools" pattern. The `tool(...)` helper from this same file is reused; no duplication.

### Ingest script (`scripts/data/`)

#### `scripts/data/ingest-pikalytics.ts` (new — top-level script)

- **Single responsibility:** the weekly ingest entry point. Walks `roster.list(db, { format: "RegM-A" })`, derives slugs, calls `fetchSpecies` per species, upserts via `upsertSnapshot`, accumulates the run summary. Pseudocode in §13.
- This is a **new top-level script** (unlike pokepaste, which extended labmaus's). Pikalytics's source is independent of labmaus tournaments — there's no per-team hook semantics — so it gets its own argv surface and its own cron entry.

#### `scripts/pikalytics-demo.ts` (new — operator script per flow §6 Q9)

- **Single responsibility:** ad-hoc operator script that prints, for a hard-coded species (defaults to `sneasler`), the top-N Pikalytics teammates next to a placeholder for labmaus equivalent (full cross-source comparison lives in a future `meta-merger` slice — see §15). Useful for sanity-checking after an ingest run. Mirrors `scripts/labmaus-latest.ts` shape.

### Data + fixtures

#### `data/cache/pikalytics/` (new, **gitignored**)

- Disk cache for raw AI-markdown responses (one file per `<species_slug>__<as_of>` key). Path under `.gitignore`: `data/cache/pikalytics/`.

#### `fixtures/pikalytics/` (new, committed, immutable)

- See §11.

### Tests

```
tests/schemas/pikalytics.test.ts
tests/tools/pikalytics/parse-markdown.test.ts
tests/tools/pikalytics/transform.test.ts
tests/tools/pikalytics/transform-no-tera.test.ts
tests/tools/pikalytics/transform-roster-resolution.test.ts
tests/tools/pikalytics/client.test.ts
tests/tools/pikalytics/fetch-species.test.ts
tests/tools/pikalytics/tool-definitions.test.ts
tests/db/pikalytics.test.ts
tests/db/pikalytics-no-tera.test.ts
tests/scripts/ingest-pikalytics.test.ts
tests/scripts/ingest-pikalytics-idempotency.test.ts
tests/contract/pikalytics-live.test.ts                 (gated by RUN_CONTRACT_TESTS=1)
```

---

## 3. Data schemas (zod, full bodies — sketch; final lands in Stage 5)

```ts
// src/schemas/pikalytics.ts
import { z } from "zod";

const ISODateTime = z.string().datetime({ offset: false });
const ISODate     = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const RosterId    = z.string().regex(/^[a-z0-9-]+$/);
const FormatLit   = z.literal("RegM-A");
const FormatSlug  = z.literal("gen9championsvgc2026regma");
const Percent     = z.number().min(0).max(100);

export const TeammateEntrySchema = z.object({
  roster_id: RosterId,
  percent:   Percent,
}).strict();

export const FrequencyEntrySchema = z.object({
  name:    z.string().min(1),
  percent: Percent,
}).strict();

export const PikalyticsSourceBlockSchema = z.object({
  site:       z.literal("pikalytics"),
  source_url: z.string().url(),    // human URL: /pokedex/...
  ai_url:     z.string().url(),    // machine URL: /ai/pokedex/...
  fetched_at: ISODateTime,
}).strict();

// PikalyticsSnapshot — one row per (species, as_of). No tera_* fields by design.
// .strict() rejects any tera_* leak; the transform's property check is the
// first line of defense, the schema is the second.
export const PikalyticsSnapshotSchema = z.object({
  schema_version:    z.literal(1),
  id:                z.string().regex(
                       /^pikalytics:gen9championsvgc2026regma:[a-z0-9-]+:\d{4}-\d{2}-\d{2}$/,
                     ),
  format:            FormatLit,
  format_slug:       FormatSlug,
  species_roster_id: RosterId,
  as_of:             ISODate,
  usage_percent:     Percent.nullable(),     // STAGE-6 deviation (a) — live AI-markdown lacks `## Usage` (verified 2026-05-07; see §19)
  teammates:         z.array(TeammateEntrySchema).max(50),
  items:             z.array(FrequencyEntrySchema).max(50),
  abilities:         z.array(FrequencyEntrySchema).max(20),
  moves:             z.array(FrequencyEntrySchema).max(50),
  sample_size:       z.number().int().nonnegative().nullable(),
  source:            PikalyticsSourceBlockSchema,
}).strict();

// Tool inputs.
export const PikalyticsFetchSpeciesArgsSchema = z.object({
  format:            FormatLit,
  species_roster_id: RosterId,
}).strict();

export const PikalyticsTeammatesArgsSchema = z.object({
  format:  FormatLit,
  species: RosterId,
  limit:   z.number().int().min(1).max(50).optional(),
}).strict();

export const PikalyticsUsageArgsSchema = z.object({
  format:    FormatLit,
  dimension: z.enum(["species", "item", "ability", "move", "teammate"]),
  species:   RosterId.optional(),
  limit:     z.number().int().min(1).max(100).optional(),
}).strict().superRefine((args, ctx) => {
  if (args.dimension !== "species" && !args.species) {
    ctx.addIssue({
      code: "custom",
      message: "`species` is required when dimension is item|ability|move|teammate",
      path: ["species"],
    });
  }
});

export const PikalyticsUsageRowSchema = z.object({
  dimension:     z.enum(["species", "item", "ability", "move", "teammate"]),
  key:           z.string(),                    // roster_id (for teammate/species) or display name (for item/ability/move)
  display_label: z.string(),
  usage_percent: Percent,
  source_url:    z.string().url(),
  as_of:         ISODate,
}).strict();
```

The Tera strip lives in two layers by design: the transform asserts no key on the parsed `RawSnapshot` matches `/tera/i` (programmer-bug class — throws `PikalyticsTeraLeakError`); the strict schemas above have no `tera_*` field, so anything that slips through the transform fails validation. A property test (§10 PIKA-T26) scans every persisted `pikalytics_snapshots` row for any column or JSON key matching `/tera/i`.

**Why `.strict()` not `.passthrough()`:** zod's default is to *strip* unknown keys silently — neither accept-nor-reject. We want **reject** on extras: a `tera_type:` line that the parser somehow surfaced into the snapshot must fail validation rather than be silently dropped (silent drop = the source of truth disagrees with the persisted record without anyone noticing). `.strict()` is the right knob.

---

## 4. Tool contracts

### 4.1 `pikalytics.fetchSpecies`

```ts
async function fetchSpecies(
  args: PikalyticsFetchSpeciesArgs,
  deps: { client: PikalyticsClient; transform: PikalyticsTransformDeps },
): Promise<PikalyticsSnapshot>;
```

**Anthropic SDK tool description** (full text lands in Stage 5; sketch):

> `pikalytics_fetch_species` — fetch and parse the current Pikalytics aggregate-usage snapshot for one Reg-M-A species. Returns the species's overall usage %, top teammates with co-occurrence %, and frequency breakdowns of items / abilities / moves, all keyed to Pikalytics's own `as_of` publication date. Strips any Tera-shaped field unconditionally (Reg M-A has no Terastallization). Use this when you need to see a single species's current ladder behavior end-to-end; for ranked subsets prefer `pikalytics_teammates` or `pikalytics_usage`.

**Pre-conditions:** `args.species_roster_id` resolves through `roster.has`. `args.format === "RegM-A"`. The species *slug* used in the URL is `roster.get(...).display_name.toLowerCase()` — STAGE-6 deviation (c) — NOT the no-hyphen `species_roster_id`. Discovered via PIKA-T29b regression guard for Mega/regional/form variants (`charizardmegay → charizard-mega-y`). See §19.

**Post-conditions:** `result.species_roster_id === args.species_roster_id`; `result.as_of` matches `^\d{4}-\d{2}-\d{2}$`; no field name on the snapshot or any nested entry contains `tera`. `usage_percent` is nullable per deviation (a).

**Cache key:** `<species_slug>` (STAGE-6 deviation (g) — the `as_of_hint`/`<slug>__<as_of>` shape was dead code; `client.ts` no longer accepts the hint. The calendar-week skip-existing pre-check makes a per-`as_of` cache key unnecessary; revisit if the heuristic moves to true `as_of` skip-check.). Cache TTL = `Number.POSITIVE_INFINITY` per `_shared/file-cache.ts` content-stable mode.

**Throttle:** 1 rps via the client's bucket (per-host, instance-owned, hostless primitive — see §12).

**Errors:** `PikalyticsInputError` (zod fail / unknown roster id), `PikalyticsNetworkError`, `PikalyticsNotFoundError` (404), `PikalyticsParseError`, `PikalyticsTeraLeakError`.

### 4.2 `pikalytics.teammates`

```ts
function teammates(db: Db, args: PikalyticsTeammatesArgs): TeammateEntry[];
```

**Anthropic SDK tool description:**

> `pikalytics_teammates` — return the top-N most-common teammates (by Showdown-ladder co-occurrence %) for a Reg-M-A species, ranked by `percent` descending, sourced from the persisted Pikalytics snapshot. Each entry carries the teammate's roster id and the co-occurrence %. Use this to answer "what pairs well with X?" or to seed core-finding heuristics. For the full snapshot (incl. items/abilities/moves) use `pikalytics_fetch_species`; for usage rankings on dimensions other than teammates use `pikalytics_usage`.

**Pre-conditions:** snapshot for `species` exists in `pikalytics_snapshots` (else returns `[]`).

**Post-conditions:** result length ≤ `limit ?? 10`, ordered by `percent DESC`, all roster ids resolve through `roster.has`.

**Errors:** `PikalyticsInputError` on zod fail. DB I/O wraps as `RosterDbError` (reused).

### 4.3 `pikalytics.usage`

```ts
function usage(db: Db, args: PikalyticsUsageArgs): PikalyticsUsageRow[];
```

**Anthropic SDK tool description:**

> `pikalytics_usage` — rank items / abilities / moves / teammates / overall species by Pikalytics ladder usage %. The `dimension` parameter selects the ranking axis. For `dimension === "species"`, returns top species across the meta (no `species` arg required). For `item | ability | move | teammate`, returns the top-ranked entries observed *on a given species's snapshot* — `species` is required. Strictly Pikalytics-sourced; cross-source merging (with labmaus / pokepaste) lives in a future slice.

**Pre-conditions:** zod passes (cross-field check on `dimension` + `species`).

**Post-conditions:** rows ordered by `usage_percent DESC`, length ≤ `limit ?? 25`. Each row carries `source_url` + `as_of` so the agent can cite verbatim.

**Errors:** `PikalyticsInputError` on zod fail; `RosterDbError` on I/O.

### 4.4 `SPEC.md` outline

Mandatory sections per CLAUDE.md §8:

1. **Inputs** — zod schemas verbatim for the three tools.
2. **Outputs** — `PikalyticsSnapshot`, `TeammateEntry`, `FrequencyEntry`, `PikalyticsUsageRow` verbatim.
3. **Edge cases** — empty Common Teammates section, empty Common Items section, missing `Common Moves` (rare), an `as_of` line that regresses backwards (logged warning, still ingested), Mega forms (`charizard-mega-y`), regional forms (`ninetales-alola`), names with apostrophes (`Farfetch'd` → `farfetchd`), 404 (logged), upstream html instead of markdown (parser fails fast).
4. **Cache + throttle policy** — content-stable forever (`POSITIVE_INFINITY` TTL); 1 rps bucket; cache key includes `as_of` after first parse.
5. **Error matrix** — which exception when (mirrors §8).
6. **Citation rules** — every persisted record carries `source.site = "pikalytics"`, `source.source_url` (human page, what the agent links to), `source.ai_url` (machine page, what we re-fetch from), `source.fetched_at` (our fetch time), and the row carries `as_of` (Pikalytics's own publication date). Citations in agent output **must** quote `source_url` not `ai_url`.
7. **Reg M-A hygiene clauses** — Tera strip mandatory; format slug is hard-coded for v1; only `RegM-A` accepted at the type boundary.
8. **Permissive-on-optional / strict-on-required parser contract** — the parser MUST fail loud on missing `as_of` or `usage_percent`; missing `Common Items / Abilities / Moves / Teammates` produce empty arrays plus `raw_warnings`.
9. **Out of scope:** spreads parsing, "Counters" section, formats other than Reg M-A, Munchstats, cross-source merging.

---

## 5. Drizzle schema additions (sketch — final lands in Stage 5)

Per memory `db_orm_drizzle.md`: declarations live in `src/db/drizzle-schema.ts`; migration generated by `drizzle-kit generate`; never hand-edit the generated SQL. `db.$client` is the raw escape hatch only when Drizzle's type-safe builder can't express what we need.

```ts
// added to src/db/drizzle-schema.ts (after teamSets / tournamentTeams)
export const pikalyticsSnapshots = sqliteTable("pikalytics_snapshots", {
  id:                text("id").primaryKey(),
  format:            text("format").notNull(),                 // 'RegM-A'
  formatSlug:        text("format_slug").notNull(),            // 'gen9championsvgc2026regma'
  speciesRosterId:   text("species_roster_id").notNull().references(() => species.id),
  asOf:              text("as_of").notNull(),                  // ISO date 'YYYY-MM-DD'
  usagePercent:      real("usage_percent").notNull(),
  teammatesJson:     text("teammates_json").notNull(),         // JSON array of {roster_id, percent}
  itemsJson:         text("items_json").notNull(),             // JSON array of {name, percent}
  abilitiesJson:     text("abilities_json").notNull(),
  movesJson:         text("moves_json").notNull(),
  sampleSize:        integer("sample_size"),                   // nullable — pikalytics doesn't expose
  sourceUrl:         text("source_url").notNull(),
  aiUrl:             text("ai_url").notNull(),
  fetchedAt:         text("fetched_at").notNull(),
}, (t) => [
  uniqueIndex("uq_pikalytics_species_as_of").on(t.speciesRosterId, t.asOf),
  index("idx_pikalytics_species_as_of_desc").on(t.speciesRosterId, sql`${t.asOf} DESC`),
  index("idx_pikalytics_as_of").on(t.asOf),
  check("pikalytics_format_regma",       sql`${t.format} = 'RegM-A'`),
  check("pikalytics_format_slug_value",  sql`${t.formatSlug} = 'gen9championsvgc2026regma'`),
  check("pikalytics_usage_pct_range",    sql`${t.usagePercent} BETWEEN 0 AND 100`),
  check("pikalytics_as_of_iso",          sql`${t.asOf} GLOB '____-__-__'`),
]);
```

**Migration:** generated as `src/db/migrations/00XX_<auto-name>.sql` by drizzle-kit (next free integer; currently 0005). Per memory `db_orm_drizzle.md`, never hand-edit generated SQL. The migration creates the table + the unique index + the two read indexes + the four CHECK constraints.

**Why JSON columns rather than child tables:** pikalytics queries are coarse-grained (top-N teammates / items / etc. for one species); we never aggregate teammates *across* species in this slice (cross-source merging is deferred per flow §6 Q4). JSON columns + `json_each` keep the schema simple and the writes single-row. The cost (no FK from teammates_json[*].roster_id to species.id) is acceptable: the transform validates each id through `roster.has` before it lands. Same trade `team_sets.moves_json` made.

---

## 6. Repository design

### 6.1 `src/db/pikalytics.ts` (bespoke)

Same pattern as `roster.ts` / `tournaments.ts` / `sets.ts`: `WeakMap<Db, Prepared>` of pre-compiled statements; one bundle constructor per logical query. Errors wrap as `RosterDbError` (DB I/O — reused) and `RosterDataError` (corrupt-row decoding — reused via `parseOrThrow`); tool-layer errors stay in the `PikalyticsError` family.

| Method | SQL strategy | Indexes used |
|---|---|---|
| `get(db, {species_roster_id})` | `SELECT * FROM pikalytics_snapshots WHERE species_roster_id = ? ORDER BY as_of DESC LIMIT 1`. Decode via `parseOrThrow(PikalyticsSnapshotSchema, …)`. | `idx_pikalytics_species_as_of_desc`. |
| `teammates(db, {species_roster_id, limit})` | Reads `get`-equivalent row, parses `teammates_json`, slices to `limit` (default 10). Could also be `SELECT json_extract(teammates_json, '$') FROM …`, but we already round-trip the snapshot for citation provenance. | `idx_pikalytics_species_as_of_desc`. |
| `usage(db, args)` | Branches on `dimension`. For `species`: `SELECT … WHERE (species_roster_id, as_of) IN (SELECT species_roster_id, MAX(as_of) FROM pikalytics_snapshots GROUP BY species_roster_id) AND usage_percent IS NOT NULL ORDER BY usage_percent DESC LIMIT ?` — STAGE-6 deviation (h), implements latest-per-species (regression guard: PIKA-T39b). For `teammate / item / ability / move`: load the species's latest snapshot, expand the relevant JSON column via `json_each(<col>_json)` (or in TS post-load — the JSON arrays are bounded ≤50), rank by `value->>'$.percent'` descending. | `idx_pikalytics_species_as_of_desc` for the load; for `dimension="species"` a `(species, MAX(as_of))` correlated subquery — fine at 286 rows. |
| `upsertSnapshot(db, snapshot)` | `INSERT … ON CONFLICT(species_roster_id, as_of) DO NOTHING`. Returns `{ inserted: bool }` from `result.changes`. Per memory `single_db_non_destructive_build.md` and the labmaus + pokepaste precedent, skip-existing wins under (species, as_of). | `uq_pikalytics_species_as_of`. |
| `exists(db, species, as_of)` | `SELECT 1 FROM pikalytics_snapshots WHERE species_roster_id = ? AND as_of = ? LIMIT 1`. Used by the ingest's pre-fetch skip-existing check (cheap; avoids a network call when we already have the latest). | `uq_pikalytics_species_as_of`. |

All exported functions get full TSDoc per CLAUDE.md §10.

### 6.2 Why `pikalytics` cannot use `createSimpleRepo` (justification per CLAUDE.md §10)

The factory generalizes (a) one table, (b) two indexes (id, display_name), (c) a `rowToEntity`. None of `pikalytics`' methods fit:
- `get` is by `species_roster_id` *and* picks the latest `as_of` — composite-key with an ORDER BY/LIMIT.
- `teammates` and `usage(dimension="teammate")` expand a JSON column.
- `usage(dimension="species")` aggregates across all rows.
- `upsertSnapshot` is a write path with ON CONFLICT semantics.

Same reasoning that kept `tournaments.ts` and `sets.ts` bespoke applies. Per CLAUDE.md §10 the factory deliberately doesn't generalize that far.

### 6.3 Reuse of upstream simple repos and bespoke repos

The transform layer takes `rosterRepo` as a dep. The `roster.has` and `roster.get` functions from `src/db/roster.ts` are the existing repo — **no new alias mapping table** (per flow §6 Q7). `roster.get(db, name, "RegM-A")` already does case-insensitive lookup against `display_name` + `aliases` + canonical id; pikalytics teammate names like `Charizard-Mega-Y` resolve directly. The pokepaste slice's `normalizeSpeciesName` helper is **not needed here** — Pikalytics emits names already in our roster's canonical convention (no `Mega <X>` prefix style).

---

## 7. Architecture patterns + the why

| Pattern | Where it lands | Why this slice |
|---|---|---|
| **Repository pattern** | `src/db/pikalytics.ts` | Same reasoning as `roster.ts` / `tournaments.ts` / `sets.ts`: prepared statements + zod parsing in one place; the agent never sees raw SQL. |
| **Ports-and-adapters / hexagonal** | `PikalyticsClient` interface vs `createPikalyticsClient` impl; `transform` takes `PikalyticsTransformDeps`; `fetchSpecies` injects both | Lets us pass a fake `fetchImpl` and a `:memory:` Db in tests without module-level globals. Mirrors labmaus + pokepaste. |
| **Anti-corruption layer** | `transform.ts` between the upstream Markdown shape and our domain | Keeps the parser, the tera-strip, the roster-id resolution, and the schema validation in one place; downstream code never sees raw markdown. |
| **Pure-parser separation** | `parse-markdown.ts` is independent of `transform.ts` | Per the lesson from pokepaste's T17/T20 fixture-collision bugs: keeping the parser pure and tested independently makes regex-fragile drift catchable in isolation. |
| **Schema-first (zod)** | `src/schemas/pikalytics.ts` is the contract; types derive via `z.infer`; both ends parse before trust | Per CLAUDE.md §5. |
| **Command/query split inside the repo** | `get` / `teammates` / `usage` / `exists` are read-only; `upsertSnapshot` is a write callable only by the ingest script | Lets read-only DB handles power the agent at runtime. |
| **Read-through, content-stable cache** | `client.ts` checks `data/cache/pikalytics/<slug>__<as_of>.json` before fetching; never expires (same `(species, as_of)` ⇒ same body) | Per flow §2.7; `_shared/file-cache.ts` already supports `Number.POSITIVE_INFINITY` TTL. |
| **Idempotent insert keyed on `(species, as_of)`** | Unique index; `ON CONFLICT … DO NOTHING` | Per flow §2.7 idempotency contract; two consecutive runs = zero deltas. First-write wins under skip-existing semantics. |
| **Defense-in-depth Tera strip** | Transform fails-loud on `tera_*`; strict schema has no `tera_*` field; property test scans persisted rows | Per memory `regulation_m_a_no_tera.md`. |
| **Reject-and-log split per failure class** | Programmer-bug class (`PikalyticsTeraLeakError`) propagates; data class (404, parse failure, unknown teammate name) accumulates into the run summary | Per pokepaste's §8 split — the load-bearing distinction is "did our code lie about reality" vs "did the upstream world misbehave". |

**Considered and rejected:**
- **Generic `external_usage_snapshots` table reusable across pikalytics + Munchstats + Smogon Stats.** Rejected: only Pikalytics ships in this slice; cross-source merging belongs to a `meta-merger` slice (per flow §6 Q4) that owns reconciliation policy. Premature abstraction adds an unused `source_site` partition; the column would always be `'pikalytics'`.
- **Per-teammate child table (`pikalytics_teammates`).** Rejected: bounded array (≤50), single-species reads, no cross-species teammate joins in this slice. JSON column + `json_each` is the right shape.
- **Storing the raw markdown body.** Rejected: it's already in the disk cache (content-stable, immutable), and re-deriving structured rows from raw is pure. No DB column needed; saves index space + write amplification.
- **A new `species_alias_pikalytics` ref table.** Rejected per flow §6 Q7. `roster.get` already resolves display names + aliases; recurring unresolved names indicate a real roster gap (resolution path: extend `data/reg-m-a/aliases.json`, rebuild the roster, re-run ingest).

---

## 8. Error model

| Class | Trigger | Severity | Where thrown | Where caught |
|---|---|---|---|---|
| `PikalyticsInputError` | Tool-arg zod fails (unknown roster id, bad limit, missing `species` when `dimension !== "species"`) | user error | `fetch-species.ts` / `tool-definitions.ts` boundary; `pikalytics.ts` repo entry | agent dispatcher; tests assert message |
| `PikalyticsNetworkError` | HTTP non-2xx (other than 404) after retries; DNS / timeout | infra | `client.ts` | `fetch-species.ts` surfaces up; ingest script logs into `network_failures[]` and continues |
| `PikalyticsNotFoundError` | HTTP 404 on the AI endpoint (species not in Pikalytics's coverage for this format) | data | `client.ts` | ingest logs into `species_404s[]` and continues; `fetch-species` re-raises (callers decide) |
| `PikalyticsParseError` | Markdown missing required `as_of` or `usage_percent` | data | `parse-markdown.ts` (re-raised by `transform.ts`) | ingest logs into `parse_failures[]` and continues |
| `PikalyticsTeraLeakError` | Defense-in-depth: a `tera_*`-named key surfaced in the parsed structure or assembled snapshot | **programmer bug — fail loud** | `transform.ts` | nowhere — propagates to fail the test / the ingest run. Resolution: fix the parser. |
| `RosterDbError` (reused) | SQLite I/O on `pikalytics_snapshots` repo | infra | `pikalytics.ts` | callers; ingest reports and exits 1 |
| `RosterDataError` (reused) | A persisted row fails `PikalyticsSnapshotSchema` on read | corruption | `parseOrThrow` in `pikalytics.ts` | tests; agent path crashes loud |

### 8.1 Reject-and-log contract (load-bearing — flow §6 Q5 + Q7 + Q8)

Per the flow, the ingest's behavior on per-species failures is **non-negotiable**:

1. **404** → `species_404s[]` entry, no row written, continue.
2. **Parse error** (missing `as_of` / `usage_percent`) → `parse_failures[]` entry with the species id and the parser's message, no row written, continue.
3. **Network exhaustion (non-404 5xx after retries)** → `network_failures[]` entry, no row written, continue. The species rolls forward to the next ingest run (cache miss next time).
4. **Unknown teammate name** (cannot resolve via `roster.get`) → drop that *entry* from `teammates_json`, append the display name to `unknown_teammate_names[]`. The snapshot is still written (per flow §6 Q7 — Option B). Recurring entries indicate a roster gap.
5. **`PikalyticsTeraLeakError`** → propagate. **Fail loud.** This is a programmer bug in the parser/transform; silently continuing would corrupt downstream data.

Resolution paths are documented in SPEC.md and the ingest script's `--help`.

---

## 9. Reuse audit

**Reused (do not duplicate):**
- **`src/tools/_shared/throttle.ts`** — `createTokenBucket({ refillPerSec: 1, clock })`. The hostless primitive labmaus (1 rps) and pokepaste (2 rps) already use; pikalytics constructs its own 1-rps instance. Already shipped (per pokepaste §9 / §12). **This materially shrinks the plan vs. naïve implementation: ~20 LOC saved + already-tested.**
- **`src/tools/_shared/file-cache.ts`** — `createFileCache({ dir, ttlMs: Number.POSITIVE_INFINITY, clock })`. Already supports the content-stable forever mode (per the docstring). Pikalytics uses `<species_slug>__<as_of>` as the key. **~30 LOC saved + already-tested.**
- **`roster.has` / `roster.get` from `src/db/roster.ts`** — for species existence checks (`fetchSpecies` precondition) and teammate name resolution. Per flow §6 Q7, no new alias table.
- **`parseOrThrow` from `src/db/simple-repo.ts`** — for decoding `pikalytics_snapshots` rows back into `PikalyticsSnapshot` in `pikalytics.ts`. Same pattern as `tournaments.ts` / `sets.ts`.
- **`Db`, `open()` from `src/db/open.ts`** — same DB file, additive migration.
- **`species` Drizzle table** — `pikalyticsSnapshots.speciesRosterId` FK target.
- **`RosterDbError`, `RosterDataError`** from `src/schemas/errors.ts` — for storage I/O and corrupt-row decoding. DB errors are DB errors regardless of which table.
- **The `tool(...)` helper in `src/db/tool-definitions.ts`** — extended, not duplicated; the new tools share the JSON-Schema generation pipeline.
- **`zod-to-json-schema`** (already a dep) — for tool input JSON schemas.
- **`better-sqlite3`, `drizzle-orm`, `drizzle-kit`, `zod`** — already pinned in `package.json`. No new deps.

**`createSimpleRepo` does NOT apply to `pikalytics_snapshots`** — composite-keyed-with-LIMIT, JSON-expansion queries, ON CONFLICT DO NOTHING. Justified in §6.2 per CLAUDE.md §10.

**NOT introduced as new dependencies:** no markdown parser library — the upstream format is small and regex-extractable, and pulling in `remark` + plugins for ~8 anchored regex matches is over-engineering. We considered `marked` (already transitively present? no — confirmed not in `package.json`) and rejected: the parser is ≤50 LOC, exhaustively fixture-tested, and the regex form is exactly as fragile as a markdown-AST visitor would be against upstream restructure (the failure mode is "section header renamed", which both approaches catch via tests). No new HTTP client (built-in `fetch`). No new test mocking framework (vitest's `vi.fn()` covers `fetchImpl` injection).

**Considered — `marked@^11.x` for markdown parsing — and rejected:** ~50KB transitive weight + a v11 → v12 migration cycle every ~6 months. The gain (AST-level extraction) is illusory because we'd still have to walk the AST for `> Data as of …`, `## Usage`, `## Common Teammates` headers — same fragility, more lines, more deps.

---

## 10. Test strategy + ordering

User-approved order from flow §6 Q10: **schema → markdown parser → transform (tera strip + roster resolution) → client (mocked HTTP, 404, throttle, cache) → fetch-species (tool integration) → repo (in-memory sqlite) → ingest end-to-end on fixtures → idempotency → contract (live, gated)**. Tests numbered in writing order.

The §3 pure-data-definition exemption (CLAUDE.md §3) applies to schema-only tests **PIKA-T1–PIKA-T6**. Everything from PIKA-T7 onward is strict per-test Red→Green; any vacuous-green slip must be flagged in the change report.

Numbering: `PIKA-T<n>`. Existing labmaus tests use T1–T40, pokepaste uses T1–T42 (numbered fresh per slice); using a `PIKA-T` prefix avoids any cross-slice number conflict and lets reviewers grep for this slice's tests. (The prefix lives in the test name string, not the file path.)

| # | Test file | Test name | Asserts | Min code to green |
|---|---|---|---|---|
| PIKA-T1 | `tests/schemas/pikalytics.test.ts` | `PikalyticsSnapshotSchema parses real Garchomp fixture` | the Garchomp fixture (pre-transformed shape) parses; teammates/items/abilities/moves arrays populated | `PikalyticsSnapshotSchema` |
| PIKA-T2 | `tests/schemas/pikalytics.test.ts` | `PikalyticsSnapshotSchema rejects any tera_* field via .strict()` | injected `tera_type: "Fire"` fails parse | `.strict()` |
| PIKA-T3 | `tests/schemas/pikalytics.test.ts` | `PikalyticsSnapshotSchema accepts empty teammates / items / abilities / moves` | snapshot with all four arrays empty parses | nullable-but-required-array branches |
| PIKA-T4 | `tests/schemas/pikalytics.test.ts` | `PikalyticsSnapshotSchema rejects format != RegM-A` | `format: "RegM-B"` fails | `FormatLit` literal |
| PIKA-T5 | `tests/schemas/pikalytics.test.ts` | `PikalyticsUsageArgsSchema requires species when dimension != "species"` | `{dimension:"item"}` without `species` fails; with `species` passes | `superRefine` |
| PIKA-T6 | `tests/schemas/pikalytics.test.ts` | `TeammateEntrySchema clamps percent to [0,100]` | percent=120 fails, =0 / =100 pass | `Percent` |
| PIKA-T7 | `tests/tools/pikalytics/parse-markdown.test.ts` | `parsePikalyticsMarkdown extracts as_of and usage_percent` | real Garchomp fixture → `{as_of:"2026-05-07", usage_percent:40.13, …}` | regex anchors |
| PIKA-T8 | `tests/tools/pikalytics/parse-markdown.test.ts` | `parsePikalyticsMarkdown throws PikalyticsParseError on missing as_of` | mutated fixture without `> Data as of …` line; assert throw | required-section check |
| PIKA-T9 | `tests/tools/pikalytics/parse-markdown.test.ts` | `parsePikalyticsMarkdown throws PikalyticsParseError on missing usage_percent` | mutated fixture without `## Usage` section; assert throw | required-section check |
| PIKA-T10 | `tests/tools/pikalytics/parse-markdown.test.ts` | `parsePikalyticsMarkdown returns empty arrays + warnings on missing optional sections` | synthetic-empty-sections fixture — assert teammates/items/abilities/moves all `[]`, `raw_warnings` lists the missing ones | permissive branch |
| PIKA-T11 | `tests/tools/pikalytics/parse-markdown.test.ts` | `parsePikalyticsMarkdown extracts hyphenated species names verbatim from teammates` | Sneasler fixture has `Charizard-Mega-Y`; assert preserved | regex `\*\*([^*]+)\*\*` |
| PIKA-T12 | `tests/tools/pikalytics/parse-markdown.test.ts` | `parsePikalyticsMarkdown handles 1- to 3-decimal percentages` | mixed-precision fixture; assert numeric equality | `parseFloat` on percent capture |
| PIKA-T13 | `tests/tools/pikalytics/transform.test.ts` | `transformPikalyticsMarkdown happy path on real Garchomp fixture` | output snapshot matches expected; `id` formed correctly; `source` block present | full transform impl |
| PIKA-T14 | `tests/tools/pikalytics/transform-no-tera.test.ts` | `transform throws PikalyticsTeraLeakError if tera_* surfaces in parsed struct` | feed parser-output mock with `tera_type: "Fire"` injected; assert throw | `/tera/i` property scan |
| PIKA-T15 | `tests/tools/pikalytics/transform-no-tera.test.ts` | `transform on synthetic-tera-leak fixture succeeds (lines stripped at parser)` | the fixture has `> Tera type: Fire` lines that the parser ignores; assert no warnings about tera and no error | parser ignores unknown headers |
| PIKA-T16 | `tests/tools/pikalytics/transform-roster-resolution.test.ts` | `transform resolves all teammate names via roster.get` | every committed-fixture teammate resolves; `unknown_teammate_names` is `[]` | `roster.get` call loop |
| PIKA-T17 | `tests/tools/pikalytics/transform-roster-resolution.test.ts` | `transform drops unresolved teammate name and accumulates into unknown_teammate_names` | inject `"Definitely-Not-Pokemon"` into a fixture; assert dropped from `teammates`; assert pushed to `unknown_teammate_names`; snapshot still written | drop branch |
| PIKA-T18 | `tests/tools/pikalytics/transform-roster-resolution.test.ts` | `transform handles Charizard-Mega-Y display name correctly` | resolve via `roster.get`; assert canonical roster id (`charizardmegay` or whatever the roster currently emits) | identity through `roster.get` |
| PIKA-T19 | `tests/tools/pikalytics/transform-roster-resolution.test.ts` | `transform persists exactly the source.source_url and source.ai_url provided by client` | inject both URLs; assert verbatim on snapshot | passthrough |
| PIKA-T20 | `tests/tools/pikalytics/client.test.ts` | `fetchSpeciesMarkdown URL is correct` | mocked fetch sees `https://www.pikalytics.com/ai/pokedex/gen9championsvgc2026regma/garchomp` | URL builder |
| PIKA-T21 | `tests/tools/pikalytics/client.test.ts` | `fetchSpeciesMarkdown returns both source_url and ai_url derived from slug` | assert `source_url` is the `/pokedex/...` form, `ai_url` the `/ai/pokedex/...` form | URL builder |
| PIKA-T22 | `tests/tools/pikalytics/client.test.ts` | `fetchSpeciesMarkdown throws PikalyticsNotFoundError on 404 (no retry)` | mocked 404; assert one fetch call, throw with species_slug | 404 branch |
| PIKA-T23 | `tests/tools/pikalytics/client.test.ts` | `fetchSpeciesMarkdown retries 429/5xx with exp backoff` | mocked 429, 500, 200; assert 3 attempts | retry loop |
| PIKA-T24 | `tests/tools/pikalytics/client.test.ts` | `fetchSpeciesMarkdown surrenders after maxRetries on 5xx` | throws `PikalyticsNetworkError` carrying `.status` | error wrap |
| PIKA-T25 | `tests/tools/pikalytics/client.test.ts` | `client throttles to 1 rps (independent bucket from labmaus / pokepaste)` | inject clock; fire 4 calls; assert pacing matches 1 rps; pass through a separate fake bucket asserted unaffected | shared `createTokenBucket` instance |
| PIKA-T26 | `tests/tools/pikalytics/client.test.ts` | `client reads from disk cache when present (content-stable, no expiry)` | seed cache file; fetchImpl asserted unused | `_shared/file-cache.ts` `Number.POSITIVE_INFINITY` mode |
| PIKA-T27 | `tests/tools/pikalytics/client.test.ts` | `client writes to disk cache after a 200 fetch` | post-call, file exists with response body in JSON envelope | cache write path |
| PIKA-T28 | `tests/tools/pikalytics/client.test.ts` | `client does NOT cache 404 responses` | first call 404, file does not exist; second call hits the network again | conditional cache write |
| PIKA-T29 | `tests/tools/pikalytics/fetch-species.test.ts` | `fetchSpecies returns parsed PikalyticsSnapshot end-to-end on injected client + DB` | end-to-end injected; output matches golden | tool wiring |
| PIKA-T30 | `tests/tools/pikalytics/fetch-species.test.ts` | `fetchSpecies throws PikalyticsInputError on unknown roster id` | input `"not-a-pokemon"`; assert throw | precondition check |
| PIKA-T31 | `tests/tools/pikalytics/tool-definitions.test.ts` | `pikalytics tools are registered in ROSTER_TOOL_DEFINITIONS` | assert `pikalytics_teammates`, `pikalytics_usage`, `pikalytics_fetch_species` all present (preempts pokepaste's Stage 6 BLOCKER per flow §6 Q3) | append in `tool-definitions.ts` |
| PIKA-T32 | `tests/tools/pikalytics/tool-definitions.test.ts` | `pikalytics tools have stable JSON schemas (no $ref)` | snapshot test | reuse `tool(...)` helper |
| PIKA-T33 | `tests/db/pikalytics.test.ts` | `upsertSnapshot inserts a row` | post-call row matches input; `inserted: true` | upsert impl |
| PIKA-T34 | `tests/db/pikalytics.test.ts` | `upsertSnapshot is idempotent — second call returns inserted:false, no row delta` | run twice; row count unchanged; second result.inserted=false | conflict clause |
| PIKA-T35 | `tests/db/pikalytics.test.ts` | `get returns latest snapshot when multiple as_of values exist for one species` | seed two rows for same species, different `as_of`; assert `get` returns the newer | `ORDER BY as_of DESC LIMIT 1` |
| PIKA-T36 | `tests/db/pikalytics.test.ts` | `get returns null on miss` | unseeded species returns null | empty branch |
| PIKA-T37 | `tests/db/pikalytics.test.ts` | `teammates returns ranked list with default limit=10` | seeded snapshot; assert order by percent DESC; length ≤ 10 | json parse + sort |
| PIKA-T38 | `tests/db/pikalytics.test.ts` | `teammates respects limit override` | limit=3; assert length 3 | slice |
| PIKA-T39 | `tests/db/pikalytics.test.ts` | `usage(dimension="species") returns top species by usage_percent across the meta` | seed 5 species snapshots; assert ordering | aggregate query |
| PIKA-T40 | `tests/db/pikalytics.test.ts` | `usage(dimension="item", species="garchomp") returns Garchomp's items ranked` | seed; assert order + each row carries source_url + as_of | json_each (or post-load sort) |
| PIKA-T41 | `tests/db/pikalytics.test.ts` | `usage(dimension="teammate", species="garchomp") matches teammates() output shape-projected` | parity check between the two paths | shared internal helper |
| PIKA-T42 | `tests/db/pikalytics.test.ts` | `exists(species, as_of) returns true after upsert, false otherwise` | seeded; assert both | PK-prefix lookup |
| PIKA-T43 | `tests/db/pikalytics-no-tera.test.ts` | `no row in pikalytics_snapshots has any column or JSON key matching /tera/i` | introspect schema cols + scan all `*_json` blobs | (vacuous green if §5 schema is right + transform fail-loud is correct; explicit guard catches future regressions — flagged for §3 vacuous-green slip in change report) |
| PIKA-T44 | `tests/scripts/ingest-pikalytics.test.ts` | `ingest --no-network runs end-to-end on fixtures (3 species)` | seed cache with 3 fixtures; run `main`; assert 3 rows persisted; run summary `total_snapshots: 3`, `skipped_existing: 0`, all failure arrays empty | script orchestration code |
| PIKA-T45 | `tests/scripts/ingest-pikalytics.test.ts` | `ingest logs species_404s on cached 404 response` | seed cache with one synthetic 404 marker (or use `fetchImpl` that returns 404); assert run summary `species_404s` contains the species id; exit 0 | catch-and-log |
| PIKA-T46 | `tests/scripts/ingest-pikalytics.test.ts` | `ingest logs parse_failures on bad markdown` | seed cache with `synthetic-bad-markdown` (no `as_of`); assert `parse_failures` populated; exit 0 | catch `PikalyticsParseError` |
| PIKA-T47 | `tests/scripts/ingest-pikalytics.test.ts` | `ingest logs unknown_teammate_names from transform` | seed fixture with one unresolvable teammate; assert run summary `unknown_teammate_names` populated and snapshot still persisted | wire transform return → summary |
| PIKA-T48 | `tests/scripts/ingest-pikalytics.test.ts` | `ingest fails loud on PikalyticsTeraLeakError` | seed a transform that throws TeraLeak (mock `transformPikalyticsMarkdown`); assert script exits non-zero | no catch for programmer-bug class |
| PIKA-T49 | `tests/scripts/ingest-pikalytics.test.ts` | `ingest skip-existing: a species with current as_of already in DB does not refetch` | pre-seed DB with snapshot at as_of=X; mock client to throw if called for that species (assert client unused); assert summary `skipped_existing` incremented | `exists` pre-check |
| PIKA-T50 | `tests/scripts/ingest-pikalytics-idempotency.test.ts` | `running ingest twice produces zero pikalytics_snapshots deltas` | snapshot DB hash before+after second run; equal | (no new code if PIKA-T34 + PIKA-T49 green) |
| PIKA-T51 | `tests/contract/pikalytics-live.test.ts` (gated by `RUN_CONTRACT_TESTS=1`) | `live pikalytics AI markdown for Garchomp parses without throwing` | real fetch; `parsePikalyticsMarkdown` extracts `as_of` + `usage_percent`; transform succeeds end-to-end | (no new code) |

**Pure-data exemption flag:** PIKA-T1–PIKA-T6 (schema-only). PIKA-T43 qualifies for the §3 "vacuous green slip" flag — the implementor must call it out in the change report.

**Total numbered tests:** 51. (Below the 25–40 target band the contract suggests, but the slice naturally needs the parser to be exhaustively tested per the flow's lesson on regex fragility, and the ingest-script branch coverage is non-negotiable per the run-summary contract. If the reviewer wants to compress, candidates are merging PIKA-T18/PIKA-T19 into PIKA-T13 and dropping PIKA-T41 (parity is implicit). I left them split for Stage 4 clarity.)

---

## 11. Fixtures plan

All fixtures committed and immutable; filenames carry capture date. Per flow §6 instruction: 3 real species pages + 2 synthetic edge-case fixtures.

```
fixtures/pikalytics/
  2026-05-07__garchomp.md                    (real, fetched live — high-usage, full sections)
  2026-05-07__sneasler.md                    (real — high-usage, hyphenated teammates incl. mega forms)
  2026-05-07__kingambit.md                   (real — different ability/move distribution; co-occurrence with garchomp)
  2026-05-07__synthetic-empty-sections.md    (hand-crafted: as_of + usage_percent only; all four section bodies empty / missing)
  2026-05-07__synthetic-tera-leak.md         (hand-crafted: contains `> Tera type: Fire` lines that the transform's
                                              property check must NOT see — the parser must ignore unknown
                                              non-section lines so they don't surface; if the parser regresses
                                              and forwards them, PIKA-T14 catches it)
  2026-05-07__synthetic-bad-markdown.md      (hand-crafted: plain text "<html>404 Not Found</html>" — parser must
                                              throw PikalyticsParseError; used in PIKA-T46 / ingest negative path)
```

Variety dimensions (per CLAUDE.md §11):
- **Real vs synthetic.** Three real for parser realism (covers ~95% of the format we'll actually see); three synthetic for edge cases.
- **Section completeness.** Real fixtures fully populated; one synthetic empty-everything-but-required; one bad-markdown.
- **Reg M-A hygiene.** One synthetic deliberately injects `> Tera type: …` lines so the parser-ignores-unknown-headers contract is exercised.
- **Mega / regional forms.** Sneasler's teammates include `Charizard-Mega-Y`; ensures roster-resolution path covers hyphenated names.

Capture procedure (one-shot, executed at fixture-creation time, NOT during this Stage 3):

```bash
curl -sS 'https://www.pikalytics.com/ai/pokedex/gen9championsvgc2026regma/garchomp' \
  -H 'User-Agent: pokemon-ai-trainer/0.1 (rodser4@gmail.com)' \
  > fixtures/pikalytics/2026-05-07__garchomp.md
# repeat for sneasler, kingambit
# hand-author the three synthetic fixtures.
# Verify each parses cleanly (or throws as expected) before committing.
```

Cache path (`data/cache/pikalytics/`) is gitignored; fixtures under `fixtures/pikalytics/` stay committed.

---

## 12. Cache + throttle implementation

**Hand-rolled is already done — both primitives in `src/tools/_shared/`.** Pikalytics consumes the existing implementations.

### 12.1 Throttle — instance-owned bucket per client

Per flow §2.7: pikalytics at **1 rps** (Pikalytics is Cloudflare-fronted; politeness is the courteous default; we have no signal that we can go faster).

```ts
// In createPikalyticsClient
import { createTokenBucket } from "../_shared/throttle";
const bucket = createTokenBucket({ refillPerSec: opts.throttleRps ?? 1, clock: opts.clock });
// every fetchSpeciesMarkdown call: await bucket.acquire(); then network.
```

The token-bucket primitive itself is hostless — each client constructs its own instance. labmaus (1 rps), pokepaste (2 rps), and pikalytics (1 rps) all coexist with independent buckets. Verified by PIKA-T25.

### 12.2 Disk cache — content-stable, no expiry

```ts
// In createPikalyticsClient
import { createFileCache } from "../_shared/file-cache";
const cache = createFileCache({
  dir:    opts.cacheDir,                         // e.g. data/cache/pikalytics
  ttlMs:  Number.POSITIVE_INFINITY,              // (species_slug, as_of) ⇒ stable body
  clock:  opts.clock,
});
```

- **Cache key shape:** `<species_slug>__<as_of>` if `as_of` is known to the caller (after the first parse, the ingest script has it from the existing DB row); `<species_slug>` alone on cold start. 200 responses are written under both forms when both are known. Per CLAUDE.md §8, the cache key includes all inputs.
- 404 responses are NOT cached — `_shared/file-cache.ts`'s envelope has no notion of "negative cache" and we don't want to invent one (a species that's added to coverage between runs should be picked up on the next ingest without manual cache nukes).
- Atomic writes (`tmp + rename`) — already in `_shared/file-cache.ts`.

### 12.3 Retry

On `429`/`5xx`: sleep `backoffBaseMs * 2^attempt` (jittered ±20%); up to `maxRetries=3`. `4xx` other than 429 maps directly: 404 → `PikalyticsNotFoundError` (no retry); other 4xx → `PikalyticsNetworkError`. Same shape as labmaus + pokepaste.

### 12.4 Gitignore additions

Append `data/cache/pikalytics/` to `.gitignore`. Fixture files under `fixtures/pikalytics/` stay committed.

---

## 13. Ingest / build orchestration

`scripts/data/ingest-pikalytics.ts` — new top-level script. Pseudocode (final lands in Stage 5):

```ts
// scripts/data/ingest-pikalytics.ts
async function main(argv: string[]): Promise<number> {
  const opts = parseArgs(argv);  // --db, --no-network, --species (optional, single-species debug)
  const db = open(opts.db);

  const client = createPikalyticsClient({
    cacheDir:      process.env.PIKALYTICS_CACHE_DIR ?? "data/cache/pikalytics",
    throttleRps:   1,                             // flow §2.7 — Cloudflare politeness
    maxRetries:    3,
    backoffBaseMs: 1000,
    fetchImpl:     opts.noNetwork ? cacheOnlyFetch : fetch,
  });

  const transformDeps: PikalyticsTransformDeps = {
    db,
    rosterRepo: { has: roster.has, get: roster.get },
  };

  const speciesIds = opts.species
    ? [opts.species]
    : roster.list(db, { format: "RegM-A" }).map((s) => s.id);    // all 286 per flow §6 Q1

  const summary = {
    total_snapshots: 0,
    skipped_existing: 0,
    species_404s: [] as string[],
    parse_failures: [] as Array<{ species: string; message: string }>,
    network_failures: [] as Array<{ species: string; status?: number; message: string }>,
    unknown_teammate_names: [] as Array<{ species: string; teammate: string }>,
    input_errors: [] as string[],     // STAGE-6 deviation (j) — PikalyticsInputError no longer mis-routed to species_404s. See §19.
  };

  // STAGE-6 deviation (e): the implementation skips on `fetched_at >= weekStart`,
  // not on `latest.as_of`, since `as_of` is upstream-controlled and only known
  // post-fetch. Trade is documented in §19 — at worst 6 days late on a republish
  // with the same as_of value.
  for (const species_id of speciesIds) {            // serial: 1 rps throttle is the bottleneck
    try {
      const weekStart = isoWeekStart(new Date());
      const recent = db.$client.prepare(
        "SELECT 1 FROM pikalytics_snapshots WHERE species_roster_id = ? AND fetched_at >= ? LIMIT 1",
      ).get(species_id, weekStart);
      if (recent !== undefined) {
        summary.skipped_existing += 1;
        continue;
      }

      const snapshot = await fetchSpecies(
        { format: "RegM-A", species_roster_id: species_id },
        { client, transform: transformDeps },
      );
      const result = pikalytics.upsertSnapshot(db, snapshot);
      if (result.inserted) summary.total_snapshots += 1;
      else                  summary.skipped_existing += 1;

      // Unknown-teammate accumulation: fetch-species returned the snapshot,
      // but the transform's PikalyticsTransformResult also exposed
      // `unknown_teammate_names`. Plumb that through fetchSpecies's
      // return type or a side-channel `onWarning` callback (final shape in Stage 5).
      // Conservative sketch: extend fetchSpecies to return both.
      // for (const name of result.unknown_teammate_names) {
      //   summary.unknown_teammate_names.push({ species: species_id, teammate: name });
      // }

    } catch (e) {
      if (e instanceof PikalyticsNotFoundError) {
        summary.species_404s.push(species_id);
        continue;
      }
      if (e instanceof PikalyticsParseError) {
        summary.parse_failures.push({ species: species_id, message: (e as Error).message });
        continue;
      }
      if (e instanceof PikalyticsNetworkError) {
        summary.network_failures.push({
          species: species_id,
          status:  e.status,
          message: (e as Error).message,
        });
        continue;
      }
      // PikalyticsTeraLeakError + everything else: fail loud.
      console.error(`[ingest-pikalytics] FATAL for ${species_id}:`, e);
      throw e;
    }
  }

  console.log(JSON.stringify({ ok: true, ...summary }));
  return 0;
}
```

### Argv handling

- `--db <path>` — DB file path (default: same default as labmaus / pokepaste).
- `--no-network` — forces cache-only; used by tests and dry runs.
- `--species <roster-id>` — debug single-species mode; bypasses the full-roster loop.
- `PIKALYTICS_CACHE_DIR` env var — overrides cache directory (matches the post-Stage 6 pokepaste convention per `pokepaste-sets.md` §13).

### Parallelism

Serial. The 1 rps throttle is the natural bottleneck; 286 species × 1.0 s ≈ 5 min cold-start total — well under the 10-minute budget from flow §1 acceptance. Parallelism inside the loop wouldn't help (the bucket caps wall-clock anyway) and complicates error attribution.

### Exit codes

- `0` — clean run, including runs with bounded `species_404s` / `parse_failures` / `network_failures` / `unknown_teammate_names`.
- `1` — `PikalyticsTeraLeakError` (programmer bug) or DB error.
- `2` — escalation gate (post-MVP): if `network_failures.length > 5%` of attempted species, exit 2 so cron alerting fires. v1 stays at `0/1` only.

### Observability

Single JSON-line summary on stdout at the end; per-species progress to stderr. The run summary fields per flow §6 Q8:

```json
{
  "ok": true,
  "total_snapshots": 219,
  "skipped_existing": 14,
  "species_404s": ["arbok", "ditto", "..."],
  "parse_failures": [],
  "network_failures": [],
  "unknown_teammate_names": []
}
```

---

## 14. Definition of Done mapping (CLAUDE.md §11)

| Box | This slice |
|---|---|
| Flow doc reviewed | YES — `docs/flows/pikalytics.md` Stage 2 approved 2026-05-06. |
| Tech plan approved | THIS DOC — pending. |
| Failing test first (commit history visible) | enforced by Stage 4 ordering in §10; commit `test: red — pikalytics`. |
| `pnpm test` passes | Stage 5 exit gate. |
| `pnpm typecheck` passes | Stage 5 exit gate; strict TS, typed signatures everywhere per §2 module specs. |
| `pnpm lint` passes | Stage 5 exit gate. |
| New external data schema-validated and fixture-backed | `PikalyticsSnapshotSchema` + `TeammateEntrySchema` + `FrequencyEntrySchema` + 6 fixtures (§11). |
| User-facing claim cited | every persisted record carries `source.site = "pikalytics"` + `source_url` (human, citation surface) + `ai_url` + `fetched_at` + `as_of`. The agent's `pikalytics_teammates` and `pikalytics_usage` tool outputs each carry `source_url` + `as_of` per row. |
| Docs touched | `tools/pikalytics/SPEC.md` written first; `.gitignore` updated (`data/cache/pikalytics/`); CLAUDE.md untouched (no new convention). |
| Reviewer subagent ran | Stage 6. |

**Uncovered by this slice (explicitly):** none. Cross-source merging with labmaus + pokepaste is deferred per flow §6 Q4 — surfaced as a follow-up `meta-merger` slice, not as a missing item here.

---

## 15. Rollout / feature-flag

- **Always-on, no flag.** New tools and the new table don't affect existing surfaces; the agent's tool catalog gains three tools (`pikalytics_fetch_species`, `pikalytics_teammates`, `pikalytics_usage`), all inert until invoked. Empty `pikalytics_snapshots` table → tools return empty arrays / null, which is the correct empty-state.
- **Migration ordering vs. upstream slices.** The Drizzle schema additions reference `species.id` (already present from the roster slice). No FK to `tournament_teams` or `team_sets` — pikalytics is independent of labmaus / pokepaste. Migration `00XX_*.sql` (next free integer; currently 0005) lands additively; drizzle-kit handles ordering.
- **Hard dependency on the roster.** `species` must be populated before any pikalytics ingest runs. The ingest script's pre-flight check asserts `SELECT COUNT(*) FROM species WHERE format = 'RegM-A'` returns 286.
- **No hard dependency on labmaus or pokepaste.** Pikalytics ingest can run independently; the `meta-merger` follow-up slice that joins across sources will be additive.
- **Cron cadence.** Weekly per flow §6 Q2. Recommended `pnpm ingest:pikalytics` cron entry; `package.json` `scripts` block extended (Stage 5).
- **Backfill cadence.** Pikalytics doesn't expose historical `as_of` values (no `?as_of=2026-04-01` query param per flow §2.10); we capture forward in time only. First weekly run after ship is the start of our pikalytics history.

---

## 16. Risks + mitigations

1. **Upstream Markdown format change (regex-fragile parser).** Pikalytics could rename `## Common Teammates` → `## Most-Common Teammates` or move `> Data as of …` to a different line. **Mitigation:** PIKA-T7–PIKA-T12 lock the parser's current behavior against committed real fixtures; PIKA-T51 (live contract test) gates on `RUN_CONTRACT_TESTS=1` and runs weekly under a CI cron — drift surfaces loudly. The parser is intentionally pure and isolated from the transform so a regex tweak doesn't require touching transform / repo / ingest. SPEC.md documents the section-header contract verbatim.
2. **Pikalytics Cloudflare blocks us if we crank the throttle.** A future change "we have a coding sprint, let's set rps=10" would risk a soft-ban. **Mitigation:** the 1 rps default is hard-coded in `ingest-pikalytics.ts` (not exposed as an argv flag); changing it requires editing the script + a code-review pass. SPEC.md documents the politeness rationale. If we hit 429s in PIKA-T23/24 territory in production, we *lower* the rps, never raise.
3. **Teammate names drift away from roster display names.** A new species enters Champions and Pikalytics emits a name our roster doesn't yet alias (e.g. a not-yet-imported regional form). **Mitigation:** unresolved teammates accumulate into `unknown_teammate_names[]`; the operator runbook (in SPEC.md) prescribes "extend `data/reg-m-a/aliases.json`, rebuild the roster, re-run ingest." The cache means re-runs are network-free. Recurring entries across multiple species (e.g. ten species all unable to resolve `Some-New-Mon`) flag a real gap; the JSON summary is grep-friendly.
4. **`as_of` regression.** Pikalytics republishes the same `as_of` later or moves it backwards. **Mitigation:** the unique constraint on `(species, as_of)` makes regressions a no-op (DO NOTHING); the ingest logs a warning if it sees an `as_of` older than the latest in DB so the operator notices. Forward-only history per flow §2.10.
5. **Single-snapshot retention vs. historical data.** v1 stores every `as_of` ever seen — no GC. Over time the table grows ~286 rows/week ≈ 14k rows/year. Negligible; SQLite handles it. Not flagged as a risk.

---

## 17. Open questions for plan review

1. **`fetchSpecies` return shape: snapshot only, or `{snapshot, unknown_teammate_names}`?** The transform produces both, but `PikalyticsSnapshot` itself doesn't carry `unknown_teammate_names`. Two options: (a) extend the tool's return type to `{ snapshot: PikalyticsSnapshot; warnings: { unknown_teammate_names: string[] } }`; (b) keep `fetchSpecies` returning `PikalyticsSnapshot` and let the transform call an injectable `onWarning` callback that the ingest hooks into. **Proposal:** (a) — explicit return shape over side-channel callback; the agent-facing tool description simply documents the snapshot-only field while the ingest script reads both. Reviewer to confirm before Stage 4 writes PIKA-T29.
Answer: Extend the return type to include `unknown_teammate_names` (option a). The shape is still simple and explicit; the ingest script can read both fields from the return value without needing to set up a callback. The agent-facing tool description can clarify that `unknown_teammate_names` is for internal use and may be empty in normal operation. This approach keeps the data flow straightforward and testable. Reviewer to confirm.

2. **Skip-existing heuristic at ingest time.** §13 sketches "skip iff DB has a snapshot from the current calendar week." But Pikalytics's upstream cadence is "monthly or as-tournament-data-arrives" (per flow §6 Q2), so a stricter check ("skip iff `latest.as_of >= today − 7d`") could refetch when upstream truly has new data. The trade-off: current-calendar-week is cheap and wrong-by-≤6 days; date-math is precise but adds one DB read per species. **Proposal:** start with calendar-week (simpler, deterministic, cheap); revisit if cron observability shows we're refetching wastefully. Reviewer to confirm.
Answer: Start with the calendar-week heuristic for simplicity and performance.

3. **`pikalytics_fetch_species` registration scope.** Per flow §6 Q3 we register `pikalyticsTeammatesTool` + `pikalyticsUsageTool`. This plan additionally registers `pikalyticsFetchSpeciesTool` (debug / parsing-without-persistence), making three. Pokepaste's Stage 6 review found that `pokepaste_fetch_paste` has narrow agent-side use (it's mostly the ingest's tool) but no harm registering. **Proposal:** register all three; the JSON-Schema descriptions disambiguate enough that the model picks correctly. If the reviewer thinks three is too many, drop `pikalytics_fetch_species` from `ROSTER_TOOL_DEFINITIONS` (keep the function exported for the ingest script).
Answer: Register all three tools in `ROSTER_TOOL_DEFINITIONS`. The clear JSON schemas and tool descriptions should guide the model to use the correct tool for each context. Having `pikalytics_fetch_species` available can be useful for debugging and testing, even if it's primarily used by the ingest script. If we find that it's causing confusion or being misused, we can revisit this decision in a future iteration.

**Flow-doc gap uncovered:** flow §2.7 says "Skip-existing semantics match the labmaus + pokepaste pattern" — but pokepaste's skip is on `(tournament_team_id, slot)` (input keys we know up front) while pikalytics's `as_of` is upstream-controlled and **only known after the fetch**. The flow doc doesn't explicitly resolve "do we refetch every week to discover whether `as_of` advanced, or do we skip if a recent enough row exists in DB?" The plan picks the latter (§13, "current calendar week" heuristic) to keep weekly refresh under the 60-second budget from flow §1 acceptance, but this is a subtle deviation from the strict labmaus/pokepaste pattern and deserves explicit confirmation. Calling out for Stage 2.5 review before Stage 5 lands.
Answer: The plan's approach to skip-existing semantics for pikalytics is a pragmatic solution to the challenge of the `as_of` value being controlled by the upstream and only known after fetching. By using a heuristic based on the current calendar week, we can avoid unnecessary fetches while still ensuring that we capture new data in a timely manner.

---

## 19. Stage 6 outcomes (2026-05-06)

### 19.1 Review summary

Full review report at [`docs/reviews/pikalytics.md`](../reviews/pikalytics.md). Verdict: ship-after-fixes (no blockers — tool registration was preempted on day one). Seven majors, four minors/nits surfaced as worth fixing in the Stage 6 batch, five deferrals. Eleven plan-vs-impl deviations (a–k) are reconciled inline at their natural sections (§3 schema, §4.1 fetchSpecies surface, §6.1 repo, §13 ingest); deferrals annotated inline with `// TODO(stage6-deferred):` and tabulated below in 19.3.

### 19.2 Applied fixes (commit `refactor: apply review — pikalytics`)

1. **`_tera_leak_marker_` sentinel removed from `scripts/data/ingest-pikalytics.ts`.** Replaced with proper dependency injection: `main(argv, deps)` accepts a `fetchSpecies` injection slot. PIKA-T48 rewritten to inject a transform-mock `fetchSpecies` that throws `PikalyticsTeraLeakError`, exercising the same propagation path the production tera-leak would hit. No magic strings in production.
2. **`usage(dimension="species")` returns latest-per-species.** SQL now filters via `(species_roster_id, as_of) IN (SELECT species_roster_id, MAX(as_of) ... GROUP BY species_roster_id)` per §6.1 row 3. Regression guard PIKA-T39b seeds two `as_of` rows for `garchomp` and asserts only the latest appears.
3. **`summary.input_errors[]` added to `RunSummary`.** `PikalyticsInputError` (unknown roster id / structurally-invalid input) routes to the new bucket instead of being mis-routed to `species_404s`. The ingest run summary now distinguishes "site doesn't cover this species yet" from "we asked for an id we don't recognize."
4. **Dead `as_of_hint` parameter removed from `client.ts`.** Per review item 4: the parameter was never threaded from `fetchSpecies` and the calendar-week skip-existing heuristic doesn't need a per-`as_of` cache key today. Cache key simplified to `<species_slug>`. (Re-introduce if the heuristic moves to true `as_of` skip-check.)
5. **Plan §19 added** (this section); deviations a–k patched into their natural sections (§3 schema `usage_percent` nullable, §4.1 cache-key + slug derivation, §6.1 row 3 SQL, §13 input_errors + skip-existing heuristic).
6. **`SPEC.md` authored** per plan §4.4 nine sections — Tools registered, Endpoint, Inputs, Outputs, Edge cases, Citation rules, Error matrix, Reg M-A hygiene, Cache + throttle, Out-of-scope, plus the Parser contract that was already in place.
7. **Orphan `pikalyticsFetchSpeciesToolDefinition` removed** from `src/tools/pikalytics/fetch-species.ts`. The Anthropic SDK tool definition lives canonically in `src/db/tool-definitions.ts` (alongside every other agent-callable tool), mirroring the labmaus + pokepaste convention.
8. **`extractSection` regex fixed.** Old form used `\Z` (Perl/Python end-of-string) which JavaScript's `RegExp` does NOT support — the section body extraction relied on the next `##` heading or fall-through to "match until next ##." Now uses `(?=^##\s|$(?![\s\S]))` with the `m` flag. Regression guard PIKA-T12b asserts a synthetic fixture with bullets in a trailing `## Random Notes` section does NOT pollute `## Common Moves`.
9. **Cause chain on the second `PikalyticsInputError` site.** `fetch-species.ts` now passes a structured cause `{ kind: "roster_lookup_miss", format, species_roster_id }` so debugging stack traces carry context for the lookup-miss path, not just a bare message.
10. **`--no-network` cache-miss fails loud.** Pre-flight check on `main()`: if `--no-network` and the cache directory is empty/missing, exit 1 with a clear "no cache to replay" message rather than silently 404ing every species. Test fixtures pre-seed a tmp cache placeholder so existing tests still pass.

### 19.3 Deferrals (annotated as inline `// TODO(stage6-deferred):` comments)

| # | Concern | Inline anchor | Belongs in |
|---|---|---|---|
| 1 | Cache envelope `fetchedAt` flow-through (today the timestamp is freshly minted at `fetchSpecies` time even on cache hits — same defer as pokepaste) | `src/tools/pikalytics/fetch-species.ts` (the `fetched_at:` line in the `source` block) | Cache-hardening slice when the next `_shared/file-cache.ts` consumer arrives (memory: `labmaus_pokepaste_deferred_todos.md`) |
| 2 | Validate-on-read overhead in `teammates` / `usage` (the agent loop pays a full `PikalyticsSnapshotSchema.parse` per call even when the caller only needs `teammates_json`) | `src/db/pikalytics.ts` `teammates(...)` and `usage(...)` non-species branch (the `get(db, ...)` calls) | When the agent loop's hot path actually exercises this; revisit alongside pokepaste's `rowToTeamSet` finding |
| 3 | Real fixture-driven `--no-network` integration test (today's PIKA-T44/T46/T47/T49 short-circuit on the unseeded `:memory:` roster) | `scripts/data/ingest-pikalytics.ts` near the no-network branch (`fakeFetch404`) | Cross-cutting `ingest-fixture-replay` slice (same bucket as labmaus + pokepaste reviewers' equivalent) |
| 4 | `labmaus-fixtures.ts` rename to `db-test-fixtures.ts` (file now seeds for three slices) | `tests/db/labmaus-fixtures.ts:1` | When a fourth consumer arrives or a test-fixture-hygiene slice |
| 5 | FK enforcement on `teammates_json[*].roster_id` (today validated by `roster.has` at transform time but not by the DB schema) | `src/schemas/pikalytics.ts` `TeammateEntrySchema` | `meta-merger` slice when cross-source roster_id integrity becomes load-bearing |

