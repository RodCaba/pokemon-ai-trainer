# Tech Plan — Pokemon Roster DB (Reg M-A)

**Slug:** `pokemon-roster-db`
**Stage:** 3 (Tech plan) — **feature complete (Stages 4–6 closed 2026-05-04)**
**Status:** Shipped — all 14 build slices green, Stage 6 review applied (`docs/reviews/pokemon-roster-db.md`).
**Approved-by:** Rodrigo Caballero (2026-05-04)
**Author:** Tech Lead subagent
**Date:** 2026-05-04
**Implements flow doc:** `/Users/rodrigo/src/pokemon-ai-trainer/docs/flows/pokemon-roster-db.md` (Stage 2 approved 2026-05-04 by Rodrigo Caballero)
**Memory citations:**
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/regulation_m_a_no_tera.md`
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/regulation_m_a_stat_rules.md`
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/regulation_m_a_roster.md`
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/smogon_calc_champions_source.md`
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/data_layer_two_tier_db.md`

---

## 1. Architecture overview

A small, file-backed, read-mostly DB. Resist over-engineering: one writer (the build script), many readers (the agent and tools). Patterns are picked to keep the boundary between Smogon's data shapes and our domain shapes crisp and the build deterministic.

| Pattern | Why (1 line) | Without it |
|---|---|---|
| **Repository pattern** (one module per table family: `roster.ts`, `items.ts`, `abilities.ts`, `moves.ts`, `insights.ts`) | One narrow seam per concern; prepared statements + zod parsing live in one place. | Raw SQL leaks into agent code, prepared statements get re-compiled per call, validation drifts. |
| **Schema-first (zod)** for both runtime validation and TS types via `z.infer` | One source of truth; `Pokemon`/`SampleSet` round-trip with the same checks at every layer. | Type drift between persisted rows and TS types; agent ingests records that violate invariants. |
| **Anti-corruption layer** in `scripts/data/fetchers/smogon-champions-*.ts` between `@smogon/calc` Champions slices and our domain shapes | Engine API uses `evs`; our domain uses `sps`. Translation is one line in one file. | `sps`↔`evs` confusion bleeds across the codebase; a refactor anywhere risks a numeric regression. |
| **Build pipeline as a pure function** (snapshots + pinned engine SHA → `db.sqlite`) | Deterministic, reproducible, diff-able PRs on the binary artifact. | Mystery diffs on the SQLite file; no way to attribute changes to source vs. engine. |
| **Migration files** under `src/db/migrations/` (no `ALTER` from the build script) | Schema evolution is auditable; the build script is a pure data writer, not a schema mutator. | Schema changes hide inside build code; running an older build against a newer file silently corrupts. |
| **Read-only DB at runtime** (the build script writes; the app opens with `readonly: true`) | Eliminates a whole class of "the agent corrupted the DB" bugs. | Agent code could accidentally mutate canonical data; we'd need locks and recovery. |
| **Stub-then-fill** for the vector tier (`insights.ts` ships an interface that throws `NotImplementedError`) | Locks the v2 ingest shape now without taking on `sqlite-vec` install risk. | First Insight ingest milestone redesigns the interface and forces churn through every caller. |
| **Trust-boundary typing** (`fn(input: Domain)` + `(raw as unknown as Domain)` at the call site) | Carry-over from `damage-calc` per CLAUDE.md §10; in-process callers get autocomplete, untrusted callers cast through `unknown`. | Either everything is `unknown` (no DX) or everything trusts `any` (no safety). |

**Considered and rejected**

- **ORM (Prisma/Drizzle).** Rejected: small fixed schema, single writer, deterministic build matters more than developer ergonomics. ORMs add migration tooling we don't need and can change file bytes.
- **JSON files as the queryable runtime DB.** Rejected by user direction 2026-05-04 (flow §2.4) and by `data_layer_two_tier_db.md` memory.
- **Knex/Umzug migration runner.** Rejected for v1: ship plain `.sql` files applied in numeric order by `open.ts`. We may revisit when migrations exceed ~10 files.
- **Repository class hierarchy.** Rejected: each repo is a flat module of pure functions taking the `Database` handle as their first arg; no inheritance.
- **Result types instead of throwing.** Rejected: matches `damage-calc` convention (throw, with a typed error class hierarchy).
- **Branded types for `SpeciesId`/`MoveName`.** Rejected for v1: zod string + DB existence check is sufficient.

---

## 2. Module decomposition

All paths absolute under `/Users/rodrigo/src/pokemon-ai-trainer/`.

### Schemas (`src/schemas/`)

We **split per entity** (one file each) rather than one consolidated file. Reason: each schema has its own provenance shape and its own `forbidIllegalKeys`-style rules; one mega-file would be hard to grep and hard to test slice-by-slice.

#### `src/schemas/pokemon.ts`
- **Responsibility:** zod schemas + types for `Pokemon`, `RosterEntry`, `SearchHit`, plus `SpeciesIdSchema`, `TypeSchema`, `BaseStatsSchema`, `AbilitySlotsSchema`.
- **Exports:** `PokemonSchema`, `RosterEntrySchema`, `SearchHitSchema`, `SpeciesIdSchema`, `TypeSchema`, `BaseStatsSchema`, `AbilitySlotsSchema`, `type Pokemon`, `type RosterEntry`, `type SearchHit`, `type SpeciesId`, `type PokeType`, `type BaseStats`, `type AbilitySlots`.
- **Depends on:** `zod`, `./common-source` (provenance helper).

#### `src/schemas/sampleSet.ts`
- **Responsibility:** zod for `SampleSet`. Reuses `SpsSpreadSchema` from `src/schemas/sps.ts` (already in repo). Critically: rejects an `evs` key with the same Champions-specific message used in `src/schemas/calc.ts`.
- **Exports:** `SampleSetSchema`, `type SampleSet`.
- **Depends on:** `zod`, `./sps`, `./common-source`, `./calc` (re-uses the `forbidIllegalKeys` helper — see Reuse Audit §16).

#### `src/schemas/item.ts`
- **Responsibility:** zod for `Item` (id, display_name, category, source).
- **Exports:** `ItemSchema`, `ItemCategorySchema`, `type Item`, `type ItemCategory`.
- **Depends on:** `zod`, `./common-source`.

#### `src/schemas/ability.ts`
- **Responsibility:** zod for `Ability` (id, display_name, source). Abilities are opaque strings (per flow Q4) — no enum.
- **Exports:** `AbilitySchema`, `type Ability`.
- **Depends on:** `zod`, `./common-source`.

#### `src/schemas/move.ts`
- **Responsibility:** zod for `Move` (id, display_name, type, category, base_power, accuracy, source).
- **Exports:** `MoveSchema`, `MoveCategorySchema`, `type Move`, `type MoveCategory`.
- **Depends on:** `zod`, `./common-source`, `./pokemon` (for `TypeSchema`).

#### `src/schemas/insight.ts`
- **Responsibility:** zod for the `Insight` shape per CLAUDE.md §6 — full shape, even though the v1 vector tier only stubs `add`/`search`. Locking the shape now prevents v2 churn.
- **Exports:** `InsightSchema`, `ClaimTypeSchema`, `ConfidenceSchema`, `StanceSchema`, `InsightSourceSchema`, `type Insight`.
- **Depends on:** `zod`, `./common-source`.

#### `src/schemas/common-source.ts`
- **Responsibility:** the shared `RecordSourceSchema` (engine_sha, source URLs, fetched_at) used by `Pokemon`/`Item`/`Ability`/`Move`/`SampleSet`.
- **Exports:** `RecordSourceSchema`, `type RecordSource`.
- **Depends on:** `zod`.

#### `src/schemas/errors.ts` (extend the existing file)
- **Responsibility:** add `RosterError` family alongside `CalcError`. Same hierarchy pattern.
- **Exports (new):** `RosterError`, `RosterNotFoundError`, `RosterDataError`, `RosterDbError`.
- **Depends on:** none.

### DB layer (`src/db/`)

#### `src/db/open.ts`
- **Responsibility:** lazy-singleton `Database` factory. Two entry points: `openReadonly(path)` for runtime, `openReadwrite(path)` for the build script. Applies pragmas (`journal_mode=DELETE`, `foreign_keys=ON`, `synchronous=NORMAL`). Applies migrations in order on `openReadwrite` (no-op if up-to-date).
- **Exports:** `openReadonly(path: string): Database`, `openReadwrite(path: string): Database`, `applyMigrations(db: Database): void`, `DEFAULT_DB_PATH` constant.
- **Depends on:** `better-sqlite3`, `node:fs`, `node:path`, `node:url`.

#### `src/db/schema.sql`
- **Responsibility:** the **canonical, full-current** schema (used by `:memory:` test harness; production goes through migration files). Mirrors the union of all migrations.
- **Exports:** N/A (raw SQL).

#### `src/db/migrations/0001_initial.sql`
- **Responsibility:** initial schema — every table from §5 below.

#### `src/db/roster.ts`
- **Responsibility:** species repo. Prepared statements cached per-DB-handle in a WeakMap. Handles case-insensitive lookups (lowercases input, matches against `id` which is the Showdown id) and alias resolution.
- **Exports:** `list(db, format): RosterEntry[]`, `get(db, name, format): Pokemon | null`, `search(db, query, format): SearchHit[]`, `has(db, name, format): boolean`, `sets(db, name, format): SampleSet[]`.
- **Depends on:** `better-sqlite3`, `../schemas/pokemon`, `../schemas/sampleSet`, `../schemas/errors`.

#### `src/db/items.ts`, `src/db/abilities.ts`, `src/db/moves.ts`
- **Responsibility:** parallel repos for the reference tables.
- **Exports each:** `list(db, format)`, `get(db, name, format)`, `has(db, name, format)`.
- **Depends on:** `better-sqlite3`, the matching schema, `../schemas/errors`.

#### `src/db/insights.ts`
- **Responsibility:** the v1 stub vector repo. Defines `InsightStore` interface; exports a `StubInsightStore` that throws `NotImplementedError` from `add`/`search` but exposes a structurally correct shape.
- **Exports:** `interface InsightStore`, `class NotImplementedError extends Error`, `class StubInsightStore implements InsightStore`, `createInsightStore(): InsightStore` factory.
- **Depends on:** `../schemas/insight`, `../schemas/errors`.

### Build / fetch scripts (`scripts/data/`)

#### `scripts/data/build-reg-m-a.ts`
- **Responsibility:** entry point for `pnpm data:build:reg-m-a`. Reads pinned `@smogon/calc`, reads `data/reg-m-a/raw-sets.smogon.json`, opens `data/reg-m-a/db.sqlite` **in place** (non-destructive, see `docs/plans/labmaus-tournaments.md` §19), and rewrites only the category A reference tables (Champions roster + items/abilities/moves + sample sets) inside one transaction. Labmaus tables (`tournaments`, `tournament_teams`, `tournament_team_species`, `team_sets`) are never touched.
- **Exports:** `buildRegMA(opts: { snapshotPath: string; outPath: string }): Promise<BuildReport>`, `main()`.
- **Depends on:** `@smogon/calc`, `./fetchers/smogon-champions-data`, `./fetchers/smogon-champions-sets`, `../../src/db/open`, `node:fs`, `node:crypto`.

#### `scripts/data/refresh-reg-m-a.ts`
- **Responsibility:** entry point for `pnpm data:refresh:reg-m-a`. Fetches the live `champions.js` from `https://calc.pokemonshowdown.com/js/data/sets/champions.js`, parses it, writes to `data/reg-m-a/raw-sets.smogon.json`. Prints a unified diff against the existing snapshot.
- **Exports:** `refreshSnapshot(opts): Promise<RefreshReport>`, `main()`.
- **Depends on:** `node:fs`, `node:https`, `./fetchers/smogon-champions-sets`.

#### `scripts/data/fetchers/smogon-champions-data.ts`
- **Responsibility:** anti-corruption layer over `@smogon/calc`. Iterates `Generations.get(0).species` and projects each entry into the domain `Pokemon` shape (translating `baseStats` field names where needed; deriving `is_mega` from name suffix `"-Mega"`/`"-Mega-X"`/`"-Mega-Y"`; preserving `aliases`).
- **Exports:** `extractSpeciesRecords(): Pokemon[]`, `extractAbilityRecords(): Ability[]`, `extractMoveRecords(): Move[]`, `extractItemRecords(): Item[]`, `ENGINE_SHA: string`.
- **Depends on:** `@smogon/calc`, `../../../src/schemas/{pokemon,item,ability,move}`.

#### `scripts/data/fetchers/smogon-champions-sets.ts`
- **Responsibility:** parses the committed `raw-sets.smogon.json` into typed `SampleSet[]`. Translates Smogon's `sps` field passthrough (no rename needed) and asserts no `evs` key appears (would be a Champions terminology violation).
- **Exports:** `parseChampionsSets(raw: unknown): Map<SpeciesId, SampleSet[]>`.
- **Depends on:** `../../../src/schemas/sampleSet`.

### Data files (`data/reg-m-a/`)

#### `data/reg-m-a/raw-sets.smogon.json`
- **How it gets there:** `pnpm data:refresh:reg-m-a` fetches `https://calc.pokemonshowdown.com/js/data/sets/champions.js`, evaluates it in a sandboxed `vm.Script` to extract `SETDEX_CHAMPIONS`, JSON-stringifies sorted-key, writes the file. PR is created with the diff.
- **Committed:** yes.

#### `data/reg-m-a/db.sqlite`
- **Committed:** **yes** — the built artifact ships with the repo so consumers don't run the build to use the agent. Determinism (§6) makes PR diffs meaningful (a one-line schema change should not produce a multi-MB binary diff). If determinism becomes flaky, fall back to "build artifact, gitignored, regenerated on `postinstall`."
- **Why commit:** matches `damage-calc` fixture commit policy and CLAUDE.md §5 ("ships in the repo or beside it").

### CLI (`src/cli/`)

#### `src/cli/tool-roster.ts`
- **Responsibility:** entry point for `pnpm tool:roster <species> [--json]`. Opens `db.sqlite` readonly, calls `roster.get`, prints either pretty or JSON.
- **Exports:** `main()`.
- **Depends on:** `../db/open`, `../db/roster`, `node:util`.

### Tests (`tests/`)

Per flow §2.8:
```
tests/data/schema.test.ts
tests/data/roster.test.ts
tests/data/items.test.ts
tests/data/abilities.test.ts
tests/data/moves.test.ts
tests/data/insights.test.ts          (vector stub interface)
tests/data/coverage.test.ts          (against real built db.sqlite)
tests/data/integrity.test.ts         (against real built db.sqlite)
tests/data/sps-evs-translation.test.ts
tests/data/determinism.test.ts
tests/data/tool-definitions.test.ts
tests/cli/tool-roster.test.ts
tests/contract/upstream-calc.test.ts (weekly; flow §2.6)
tests/data/fixtures.ts               (in-memory SQLite seed helper)
```

---

## 3. Data schemas (zod, TypeScript)

Bindings for Stage 4. Reg M-A invariants enforced at schema layer.

```ts
// src/schemas/common-source.ts
import { z } from "zod";
export const RecordSourceSchema = z.object({
  origin: z.enum(["@smogon/calc", "calc.pokemonshowdown.com/js/data/sets/champions.js"]),
  engine_sha: z.string().regex(/^[0-9a-f]{40}$/).nullable(),
  source_url: z.string().url(),
  fetched_at: z.string().datetime({ offset: false }),
}).strict();
export type RecordSource = z.infer<typeof RecordSourceSchema>;
```

```ts
// src/schemas/pokemon.ts
import { z } from "zod";
import { RecordSourceSchema } from "./common-source";

export const SpeciesIdSchema = z.string().regex(/^[a-z0-9]+$/, "Showdown id: lowercase alphanumeric only");
export const TypeSchema = z.enum([
  "Normal","Fire","Water","Electric","Grass","Ice","Fighting","Poison","Ground","Flying",
  "Psychic","Bug","Rock","Ghost","Dragon","Dark","Steel","Fairy",
]);
export const BaseStatsSchema = z.object({
  hp: z.number().int().positive(),
  atk: z.number().int().positive(),
  def: z.number().int().positive(),
  spa: z.number().int().positive(),
  spd: z.number().int().positive(),
  spe: z.number().int().positive(),
}).strict();
export const AbilitySlotsSchema = z.object({
  "0": z.string().min(1),
  "1": z.string().min(1).nullable(),
  "h": z.string().min(1).nullable(),
}).strict();

export const PokemonSourceSchema = z.object({
  stats_source: z.string(),
  movepool_source: z.string(),
  abilities_source: z.string(),
  fetched_at: z.string().datetime({ offset: false }),
  engine_sha: z.string().regex(/^[0-9a-f]{40}$/),
}).strict();

export const PokemonSchema = z.object({
  schema_version: z.literal(1),
  id: SpeciesIdSchema,
  display_name: z.string().min(1),
  aliases: z.array(z.string().min(1)).default([]),
  dex_no: z.number().int().positive(),
  form_id: z.string().min(1).nullable(),
  is_mega: z.boolean(),
  types: z.array(TypeSchema).min(1).max(2),
  base_stats: BaseStatsSchema,
  abilities: AbilitySlotsSchema,
  movepool: z.array(z.string().min(1)).min(1),
  weight_kg: z.number().positive(),
  height_m: z.number().positive(),
  source: PokemonSourceSchema,
}).strict();

export const RosterEntrySchema = z.object({
  id: SpeciesIdSchema,
  display_name: z.string().min(1),
  is_mega: z.boolean(),
  format: z.literal("RegM-A"),
}).strict();

export const SearchHitSchema = z.object({
  id: SpeciesIdSchema,
  display_name: z.string().min(1),
  score: z.number().min(0).max(1),
  matched_on: z.enum(["id", "display_name", "alias"]),
}).strict();

export type Pokemon = z.infer<typeof PokemonSchema>;
export type RosterEntry = z.infer<typeof RosterEntrySchema>;
export type SearchHit = z.infer<typeof SearchHitSchema>;
export type SpeciesId = z.infer<typeof SpeciesIdSchema>;
export type PokeType = z.infer<typeof TypeSchema>;
export type BaseStats = z.infer<typeof BaseStatsSchema>;
export type AbilitySlots = z.infer<typeof AbilitySlotsSchema>;
```

```ts
// src/schemas/sampleSet.ts
import { z } from "zod";
import { SpsSpreadSchema } from "./sps";
import { NatureSchema } from "./calc";  // reuse
// SampleSet rejects 'evs' the same way CalcInput does. We construct a small local
// guard instead of re-exporting calc.ts's helper — coupling these two trust
// boundaries together is the point.
const FORBIDDEN = ["evs", "ev", "ivs", "iv"] as const;

const SampleSetSourceSchema = z.object({
  set_source: z.string().url(),
  fetched_at: z.string().datetime({ offset: false }),
}).strict();

export const SampleSetSchema = z.object({
  set_name: z.string().min(1),
  ability: z.string().min(1),
  item: z.string().min(1).nullable(),
  nature: NatureSchema,
  moves: z.array(z.string().min(1)).length(4),
  sps: SpsSpreadSchema,
  source: SampleSetSourceSchema,
}).passthrough().superRefine((v, ctx) => {
  for (const k of FORBIDDEN) {
    if (k in (v as Record<string, unknown>)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [k],
        message: k.startsWith("ev")
          ? "EVs are renamed to SPS (Stat Points) in Champions Reg M-A — use 'sps' instead"
          : "IVs are not configurable in Reg M-A",
      });
    }
  }
  const allowed = new Set(["set_name","ability","item","nature","moves","sps","source"]);
  for (const k of Object.keys(v as object)) {
    if (!allowed.has(k) && !(FORBIDDEN as readonly string[]).includes(k)) {
      ctx.addIssue({ code: z.ZodIssueCode.unrecognized_keys, keys: [k], message: `Unrecognized key '${k}'` });
    }
  }
});
export type SampleSet = z.infer<typeof SampleSetSchema>;
```

```ts
// src/schemas/item.ts
import { z } from "zod";
import { RecordSourceSchema } from "./common-source";
export const ItemCategorySchema = z.enum([
  "berry","mega-stone","held","choice","plate","memory","seed","gem","weather-rock","terrain-extender","other",
]);
export const ItemSchema = z.object({
  schema_version: z.literal(1),
  id: z.string().regex(/^[a-z0-9]+$/),
  display_name: z.string().min(1),
  category: ItemCategorySchema,
  source: RecordSourceSchema,
}).strict();
export type Item = z.infer<typeof ItemSchema>;
export type ItemCategory = z.infer<typeof ItemCategorySchema>;
```

```ts
// src/schemas/ability.ts
import { z } from "zod";
import { RecordSourceSchema } from "./common-source";
export const AbilitySchema = z.object({
  schema_version: z.literal(1),
  id: z.string().regex(/^[a-z0-9]+$/),
  display_name: z.string().min(1),
  source: RecordSourceSchema,
}).strict();
export type Ability = z.infer<typeof AbilitySchema>;
```

```ts
// src/schemas/move.ts
import { z } from "zod";
import { RecordSourceSchema } from "./common-source";
import { TypeSchema } from "./pokemon";
export const MoveCategorySchema = z.enum(["Physical","Special","Status"]);
export const MoveSchema = z.object({
  schema_version: z.literal(1),
  id: z.string().regex(/^[a-z0-9]+$/),
  display_name: z.string().min(1),
  type: TypeSchema,
  category: MoveCategorySchema,
  base_power: z.number().int().nonnegative(),     // 0 for status moves
  accuracy: z.number().int().min(0).max(100).nullable(), // null = always hits
  source: RecordSourceSchema,
}).strict();
export type Move = z.infer<typeof MoveSchema>;
export type MoveCategory = z.infer<typeof MoveCategorySchema>;
```

```ts
// src/schemas/insight.ts (v1 stub shape — full v2 contract per CLAUDE.md §6)
import { z } from "zod";
export const ClaimTypeSchema = z.enum(["matchup","set","lead","meta_trend","tech","counter"]);
export const ConfidenceSchema = z.enum(["low","medium","high"]);
export const StanceSchema = z.enum(["supports","refutes","neutral"]);
export const InsightSourceSchema = z.object({
  type: z.enum(["youtube","article","tournament","replay","user_note"]),
  url: z.string().url(),
  author: z.string().min(1).optional(),
  published_at: z.string().datetime({ offset: false }).optional(),
  excerpt: z.string().max(500),
  timestamp_seconds: z.number().int().nonnegative().optional(),
}).strict();
export const InsightSchema = z.object({
  id: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, "ulid"),
  schema_version: z.literal(1),
  claim: z.string().min(1).max(280),
  claim_type: ClaimTypeSchema,
  subjects: z.object({
    pokemon: z.array(z.string().regex(/^[a-z0-9]+$/)).min(1),
    moves: z.array(z.string()).optional(),
    items: z.array(z.string()).optional(),
    archetypes: z.array(z.string()).optional(),
    formats: z.tuple([z.literal("RegM-A")]),
  }).strict(),
  confidence: ConfidenceSchema,
  stance: StanceSchema,
  source: InsightSourceSchema,
  extracted_by: z.object({
    model: z.string(),
    prompt_version: z.string(),
    extracted_at: z.string().datetime({ offset: false }),
  }).strict(),
  embedding_ref: z.string().min(1),
}).strict();
export type Insight = z.infer<typeof InsightSchema>;
```

```ts
// src/schemas/errors.ts (additions)
export class RosterError extends Error {
  override readonly cause?: unknown;
  readonly query?: unknown;
  constructor(msg: string, opts?: { cause?: unknown; query?: unknown }) {
    super(msg); this.name = this.constructor.name;
    this.cause = opts?.cause; this.query = opts?.query;
  }
}
export class RosterNotFoundError extends RosterError {}   // get() called for unknown species; thrown only when caller opts in via getOrThrow()
export class RosterDataError extends RosterError {}       // build-time integrity violation
export class RosterDbError extends RosterError {}         // sqlite I/O failure
```

(`get()` itself returns `null` per flow §3, matching the flow doc. `RosterNotFoundError` is reserved for an opt-in `getOrThrow()` helper — kept as a class because the build pipeline throws it at integrity-check time.)

---

## 4. Relational schema (SQL)

`src/db/schema.sql` (mirrors the union of all migrations; `0001_initial.sql` is the same content for the initial migration).

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00Z'  -- frozen for determinism
);

CREATE TABLE species (
  id            TEXT PRIMARY KEY,                      -- Showdown id, lowercase alphanumeric
  display_name  TEXT NOT NULL,
  dex_no        INTEGER NOT NULL CHECK (dex_no > 0),
  form_id       TEXT,                                  -- NULL for base form
  is_mega       INTEGER NOT NULL CHECK (is_mega IN (0,1)),
  types         TEXT NOT NULL,                         -- JSON array of 1–2 type strings
  weight_kg     REAL NOT NULL CHECK (weight_kg > 0),
  height_m      REAL NOT NULL CHECK (height_m > 0),
  aliases       TEXT NOT NULL DEFAULT '[]',            -- JSON array of strings
  source_json   TEXT NOT NULL                          -- JSON of Pokemon.source
);
CREATE INDEX idx_species_display_name_nocase ON species (display_name COLLATE NOCASE);
CREATE INDEX idx_species_dex_no              ON species (dex_no);

CREATE TABLE species_stats (
  species_id  TEXT PRIMARY KEY REFERENCES species(id) ON DELETE CASCADE,
  hp  INTEGER NOT NULL CHECK (hp  > 0),
  atk INTEGER NOT NULL CHECK (atk > 0),
  def INTEGER NOT NULL CHECK (def > 0),
  spa INTEGER NOT NULL CHECK (spa > 0),
  spd INTEGER NOT NULL CHECK (spd > 0),
  spe INTEGER NOT NULL CHECK (spe > 0),
  bst INTEGER NOT NULL GENERATED ALWAYS AS (hp+atk+def+spa+spd+spe) VIRTUAL CHECK (bst > 0)
);

CREATE TABLE species_abilities (
  species_id   TEXT NOT NULL REFERENCES species(id) ON DELETE CASCADE,
  slot         TEXT NOT NULL CHECK (slot IN ('0','1','h')),
  ability_name TEXT NOT NULL,
  PRIMARY KEY (species_id, slot)
);
CREATE INDEX idx_species_abilities_ability_name ON species_abilities (ability_name COLLATE NOCASE);

CREATE TABLE species_movepool (
  species_id TEXT NOT NULL REFERENCES species(id) ON DELETE CASCADE,
  move_name  TEXT NOT NULL,
  PRIMARY KEY (species_id, move_name)
);
CREATE INDEX idx_species_movepool_move_name ON species_movepool (move_name COLLATE NOCASE);

CREATE TABLE sample_sets (
  rowid       INTEGER PRIMARY KEY,
  species_id  TEXT NOT NULL REFERENCES species(id) ON DELETE CASCADE,
  set_name    TEXT NOT NULL,
  ability     TEXT NOT NULL,
  item        TEXT,
  nature      TEXT NOT NULL,
  moves_json  TEXT NOT NULL,                           -- JSON array length 4
  sps_json    TEXT NOT NULL,                           -- JSON {hp,atk,def,spa,spd,spe}
  source_json TEXT NOT NULL,
  CHECK (json_array_length(moves_json) = 4),
  CHECK (
    (json_extract(sps_json,'$.hp')+json_extract(sps_json,'$.atk')+json_extract(sps_json,'$.def')
    +json_extract(sps_json,'$.spa')+json_extract(sps_json,'$.spd')+json_extract(sps_json,'$.spe')) <= 66
  ),
  UNIQUE (species_id, set_name)
);

CREATE TABLE roster_membership (
  species_id TEXT NOT NULL REFERENCES species(id) ON DELETE CASCADE,
  format     TEXT NOT NULL CHECK (format = 'RegM-A'),
  is_legal   INTEGER NOT NULL CHECK (is_legal IN (0,1)),
  is_mega    INTEGER NOT NULL CHECK (is_mega IN (0,1)),
  notes      TEXT,
  PRIMARY KEY (species_id, format)
);
CREATE INDEX idx_roster_membership_format_legal ON roster_membership (format, is_legal);

CREATE TABLE items (
  id           TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  category     TEXT NOT NULL CHECK (category IN
    ('berry','mega-stone','held','choice','plate','memory','seed','gem','weather-rock','terrain-extender','other')),
  source_json  TEXT NOT NULL
);
CREATE INDEX idx_items_display_name_nocase ON items (display_name COLLATE NOCASE);

CREATE TABLE abilities (
  id           TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  source_json  TEXT NOT NULL
);
CREATE INDEX idx_abilities_display_name_nocase ON abilities (display_name COLLATE NOCASE);

CREATE TABLE moves (
  id           TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  type         TEXT NOT NULL,
  category     TEXT NOT NULL CHECK (category IN ('Physical','Special','Status')),
  base_power   INTEGER NOT NULL CHECK (base_power >= 0),
  accuracy     INTEGER CHECK (accuracy IS NULL OR (accuracy >= 0 AND accuracy <= 100)),
  source_json  TEXT NOT NULL
);
CREATE INDEX idx_moves_display_name_nocase ON moves (display_name COLLATE NOCASE);
CREATE INDEX idx_moves_type                 ON moves (type);
CREATE INDEX idx_moves_category             ON moves (category);
```

**Storage notes:**
- Arrays (`types`, `aliases`, `moves`, `sps`, `source` blocks) are stored as JSON-in-TEXT. SQLite's JSON1 functions (`json_extract`, `json_array_length`) provide indexable access where needed; for now we use them only inside CHECK constraints.
- `applied_at` in `schema_migrations` is **frozen at the literal '1970-01-01T00:00:00Z'** to keep the SQLite file deterministic across builds.
- All `display_name` indexes use `COLLATE NOCASE` to power case-insensitive lookups without per-query `LOWER()`.

---

## 5. Build pipeline contract

```ts
// scripts/data/build-reg-m-a.ts
export interface BuildOptions {
  snapshotPath: string;   // absolute path to raw-sets.smogon.json
  outPath: string;        // absolute path to the output db.sqlite
  enginePin: string;      // resolved @smogon/calc package commit SHA
}
export interface BuildReport {
  speciesCount: number;
  itemsCount: number;
  abilitiesCount: number;
  movesCount: number;
  sampleSetsCount: number;
  bytes: number;
  sha256: string;         // of the final db.sqlite
}
export async function buildRegMA(opts: BuildOptions): Promise<BuildReport>;
```

**Step-by-step:**

1. `import { Generations } from "@smogon/calc"` and capture `gen0 = Generations.get(0)` (the Champions slice).
2. `parseChampionsSets(JSON.parse(readFileSync(opts.snapshotPath)))` → `Map<SpeciesId, SampleSet[]>`.
3. Open `opts.outPath + ".tmp"` for read-write via `openReadwrite`. Apply migrations (numeric order). Begin a single transaction wrapping the entire data write.
4. **Deterministic insertion order:**
   - Insert species sorted by `id` ascending.
   - For each species: insert `species_stats`, then `species_abilities` ordered by slot (`0`, `1`, `h`), then `species_movepool` ordered alphabetically by move name.
   - Insert `roster_membership` rows in the same species order.
   - Insert `items` sorted by `id`. Same for `abilities`, `moves`.
   - Insert `sample_sets` sorted by `(species_id, set_name)`.
5. `COMMIT`.
6. Run finishing sequence: `PRAGMA journal_mode = DELETE; VACUUM; PRAGMA optimize;`.
7. Close the DB handle.
8. `fsync` the temp file. Atomic-rename `db.sqlite.tmp` → `db.sqlite` via `node:fs.renameSync`.
9. Compute SHA-256 of the final file; return the `BuildReport`.

**SPS-from-Smogon translation:**
- `SETDEX_CHAMPIONS` already keys spreads as `sps` (per memory `smogon_calc_champions_source.md` and flow Q3). The fetcher passes them through unchanged into our `SampleSet.sps`.
- `Generations.get(0).species.<id>.baseStats` carries species *base stats*, not EVs/SPS — translation is just JSON-key passthrough into `species_stats`.
- The only `sps → evs` translation in the codebase remains the runtime damage-calc mapping layer (`src/tools/damage-calc/mapping.ts`). The build pipeline never converts.

**Determinism guarantees:**
- Single writer, single transaction, ordered inserts.
- `applied_at` in `schema_migrations` frozen.
- No timestamps in any inserted row sourced from `Date.now()` — every `fetched_at` value is the snapshot's literal value (which is a date string committed in the snapshot).
- `journal_mode = DELETE` ensures no `-wal` / `-shm` file lingers.
- `VACUUM` rewrites the file with predictable page layout.
- Same `better-sqlite3` version produces same byte layout (see Risk #1).

---

## 6. Snapshot protocol

### Fetch URL

`https://calc.pokemonshowdown.com/js/data/sets/champions.js` — a plain JS file declaring `var SETDEX_CHAMPIONS = {...};` at module scope.

### Refresh procedure

`pnpm data:refresh:reg-m-a` runs `scripts/data/refresh-reg-m-a.ts`:

1. HTTPS GET the URL, follow redirects, fail on non-200.
2. Evaluate the JS in a `vm.Script` sandbox to extract the `SETDEX_CHAMPIONS` global.
3. JSON-stringify with **sorted keys** (recursively) and 2-space indent.
4. Compare against current `data/reg-m-a/raw-sets.smogon.json`. If equal: print "no changes" and exit 0. Else write to `<path>.next`, atomic-rename, print a unified diff.
5. Print a recommended PR title: `data: refresh raw-sets.smogon.json (<short hash>)`.

### Sample output

```
$ pnpm data:refresh:reg-m-a
Fetching https://calc.pokemonshowdown.com/js/data/sets/champions.js ...
Parsed SETDEX_CHAMPIONS: 286 species, 412 sample sets.
Diff vs current snapshot:
  garchomp/Choice Scarf:
  -  spe: 30
  +  spe: 32
  tyranitar/+ added new set "Trick Room"
Updated data/reg-m-a/raw-sets.smogon.json (412 → 413 sets, +218 bytes).
Open a PR titled: data: refresh raw-sets.smogon.json (a4f9c2e)
Next: pnpm data:build:reg-m-a && git add data/reg-m-a/db.sqlite
```

---

## 7. Repository contracts

All repos take the `Database` handle as their first argument so test code can pass `:memory:` instances. Prepared statements are cached per-handle in a `WeakMap<Database, PreparedStatementsBundle>`.

### `src/db/roster.ts`

```ts
/**
 * Lists every species legal in the given format, ordered by canonical id.
 *
 * **When to use it:** populating a roster picker, computing coverage stats,
 * iterating over the entire format for batch validation. For "is X legal?" use
 * `has()` (single-row indexed lookup) instead.
 *
 * @param db    Open `better-sqlite3` Database handle (readonly is fine).
 * @param format Format literal — only `"RegM-A"` is supported in v1.
 * @returns      Array of `RosterEntry`. Empty array if no rows match (never `null`).
 * @throws       `RosterDbError` on any underlying SQLite I/O failure.
 * @example
 *   const db = openReadonly(DEFAULT_DB_PATH);
 *   const all = list(db, "RegM-A");           // RosterEntry[]
 *   console.log(`${all.length} legal species`);
 */
export function list(db: Database, format: "RegM-A"): RosterEntry[];

/**
 * Looks up a species by Showdown id, display name, or alias. Case-insensitive.
 *
 * **When to use it:** the team builder resolves user input to a canonical Pokemon
 * record. For fuzzy / typo-tolerant matches use `search()`. For a boolean-only
 * check use `has()`.
 *
 * @param db      Open Database handle.
 * @param name    Any of: Showdown id ("garchomp"), display name ("Garchomp"),
 *                or a registered alias. Whitespace is trimmed; case is ignored.
 * @param format  `"RegM-A"`.
 * @returns       The full `Pokemon` record (zod-validated), or `null` if no match.
 * @throws        `RosterDbError` on SQLite I/O failure;
 *                `RosterDataError` if a stored row fails schema validation
 *                (indicates DB corruption, not caller error).
 * @example
 *   const p = get(db, "Garchomp", "RegM-A");
 *   if (!p) throw new Error("not in Reg M-A");
 *   console.log(p.base_stats.spe);          // 102
 */
export function get(db: Database, name: string, format: "RegM-A"): Pokemon | null;

/**
 * Fuzzy search by partial id / display name / alias. Returns ranked hits.
 * @param db
 * @param query   Partial string; min length 1; whitespace trimmed.
 * @param format  `"RegM-A"`.
 * @returns       Up to 10 `SearchHit`s sorted by descending score
 *                (1.0 = exact match). Empty array if no candidate ≥ 0.3.
 * @throws        `RosterDbError`.
 * @example       search(db, "garcha", "RegM-A") // → [{id:"garchomp", score:0.83, ...}]
 */
export function search(db: Database, query: string, format: "RegM-A"): SearchHit[];

/**
 * Boolean legality check.
 * @param db
 * @param name    Same lookup rules as `get()`.
 * @param format  `"RegM-A"`.
 * @returns       `true` iff the species exists in `roster_membership` with `is_legal = 1`.
 * @throws        `RosterDbError`.
 * @example       has(db, "Mewtwo", "RegM-A") // → false
 */
export function has(db: Database, name: string, format: "RegM-A"): boolean;

/**
 * Returns Smogon-curated sample sets for a species (may be empty).
 * @param db
 * @param name    Same lookup rules as `get()`.
 * @param format  `"RegM-A"`.
 * @returns       Array of `SampleSet` (zod-validated). Empty array if the species
 *                exists but has no sample sets in `SETDEX_CHAMPIONS`.
 * @throws        `RosterDataError` if the species itself is unknown (caller likely
 *                meant to call `has()` first); `RosterDbError` on I/O failure.
 * @example       sets(db, "Garchomp", "RegM-A").map(s => s.set_name)
 */
export function sets(db: Database, name: string, format: "RegM-A"): SampleSet[];
```

`items.ts`, `abilities.ts`, `moves.ts` mirror this with `list/get/has`. Each uses the same `WeakMap` prepared-statement cache pattern.

**Search ranking algorithm (v1):** lowercase normalize; exact id match → score 1.0; exact display_name match → 0.95; alias exact → 0.9; prefix on id → 0.7 + length/inputLen * 0.1; substring → 0.5 + length/inputLen * 0.1; else Damerau-Levenshtein normalized to `[0, 0.5)` and filter ≥ 0.3. Limit 10. Implementation lives entirely in TS over a `SELECT id, display_name, aliases FROM species` (286 rows; faster than SQLite FTS5 for this size).

**Case-insensitivity rules:** input is trimmed and lowercased before lookup. The `id` column is already lowercase. `display_name` and `aliases` are matched via `COLLATE NOCASE` indexes.

---

## 8. Vector tier stub

```ts
// src/db/insights.ts
import type { Insight } from "../schemas/insight";

export class NotImplementedError extends Error {
  constructor(feature: string) { super(`${feature} not implemented in v1 stub`); this.name = "NotImplementedError"; }
}

export interface InsightSearchOptions {
  pokemon?: string[];
  claim_type?: Insight["claim_type"];
  format?: "RegM-A";
  limit?: number;
}
export interface InsightSearchHit {
  insight: Insight;
  score: number;
}
export interface InsightStore {
  add(insight: Insight): Promise<void>;
  search(query: string, opts?: InsightSearchOptions): Promise<InsightSearchHit[]>;
}

/**
 * v1 stub. Throws on every operation. Exists so the `InsightStore` interface
 * locks the v2 contract and downstream code (lead planner, YouTube ingest) can
 * compile against the shape without an embedding store.
 *
 * **When to use it:** in tests that want to assert "the future ingest tool would
 * call .add()". Production callers should not use this directly.
 */
export class StubInsightStore implements InsightStore {
  async add(_i: Insight): Promise<void> { throw new NotImplementedError("InsightStore.add"); }
  async search(_q: string, _o?: InsightSearchOptions): Promise<InsightSearchHit[]> {
    throw new NotImplementedError("InsightStore.search");
  }
}

/** Factory; v2 returns a real `sqlite-vec`-backed store. */
export function createInsightStore(): InsightStore { return new StubInsightStore(); }
```

**v2 (`sqlite-vec`) integration will need:**
- A new migration (`0002_insights_vector.sql`) creating `insights` (relational columns from `Insight` minus `embedding_ref`, plus `claim_normalized` for FTS) and a virtual `insights_vec` table via `sqlite-vec`.
- `add()` zod-parses the input, computes the embedding (via Anthropic or local model), inserts both rows in a transaction, returns the `embedding_ref`.
- `search()` runs a hybrid query: structural filter on `subjects.pokemon` and `claim_type`, vector kNN on the embedding, recombine.
- Loading the `sqlite-vec` extension in `open.ts` behind a flag.

---

## 9. Error model

```
RosterError                          (base — never thrown directly)
├── RosterNotFoundError              (caller asked for something that doesn't exist via *OrThrow helper or build-time check)
├── RosterDataError                  (build-time integrity violation OR stored row failed runtime schema validation)
└── RosterDbError                    (SQLite I/O failure)
```

Same instantiation pattern as `CalcError`:

```ts
new RosterDataError("species 'garchomp' has 0 abilities (need ≥ 1 in slot 0)", { query: { id: "garchomp" } });
new RosterDbError("could not open db.sqlite", { cause: err, query: { path } });
```

`get()` returns `null` on miss (per flow §3). `RosterNotFoundError` is reserved for the build-time integrity check ("a `SETDEX_CHAMPIONS` set references unknown species") and an optional `getOrThrow()` convenience wrapper.

---

## 10. Tool layer contract for the agent (Anthropic SDK)

Each accessor that the agent can call ships a JSON-Schema tool definition. Generation pattern matches `damageCalcToolDefinition`: zod schema → `zod-to-json-schema(target: "openApi3")` → `{name, description, input_schema}`.

```ts
// src/tools/roster/tool-definitions.ts (greenfield in this slice)
export const rosterGetToolDefinition: Anthropic.Tool = {
  name: "roster_get",
  description:
    "Look up a Pokemon Champions Reg M-A species by Showdown id, display name, " +
    "or alias (case-insensitive). Returns the full record: base stats, types, " +
    "ability slots, Champions movepool, dex number, mega flag. Returns null if " +
    "the species is not legal in Reg M-A. For typo-tolerant matching use " +
    "`roster_search`. For a boolean check use `roster_has`.",
  input_schema: zodToJsonSchema(z.object({
    species: z.string().min(1),
    format: z.literal("RegM-A"),
  }), { name: "RosterGetInput", target: "openApi3", $refStrategy: "none" }),
};
// roster_list, roster_search, roster_has, roster_sets follow the same pattern.
// items_get, items_list, items_has likewise; abilities_*; moves_*.
```

The descriptions are the **source of truth** for the agent's tool selection (CLAUDE.md §10). Each must distinguish itself from sibling tools — e.g., `roster_search` description says "for typo-tolerant fuzzy lookup; for exact lookup use `roster_get`."

Stage 5 will export an aggregate `pokemonRosterToolDefinitions: Anthropic.Tool[]` used to register the toolset with the agent loop in a later milestone.

---

## 11. Test strategy (drives Stage 4)

Order matches flow §2.10: schema → repository (in-memory) → coverage + integrity (real db.sqlite) → determinism → contract.

### `tests/data/schema.test.ts`
Per CLAUDE.md §3 "pure data definitions" exemption — these schemas are largely cohesive zod objects, so per-field red-first cycles buy little. The Stage 4 commit message must call this out (`test: red — schemas (data-definition exemption invoked)`). Cases:

1. `PokemonSchema` accepts a minimal valid record.
2. rejects empty `types` array.
3. rejects `types` length > 2.
4. rejects unknown type string.
5. rejects non-positive `base_stats.hp` (== 0).
6. rejects floating `base_stats.atk`.
7. rejects `id` containing uppercase.
8. rejects `id` containing space/hyphen.
9. accepts `aliases` empty default.
10. rejects malformed `engine_sha`.
11. `SampleSetSchema` accepts a minimal valid set.
12. rejects payload with `evs` key (Champions terminology).
13. error message for `evs` key contains "SPS (Stat Points)".
14. rejects payload with `ivs` key.
15. rejects `moves.length != 4`.
16. rejects `sps` total of 67 (cap 66).
17. rejects per-stat `sps` of 33 (cap 32).
18. accepts `sps` total of exactly 66.
19. `ItemSchema` accepts minimal record; `ItemCategorySchema` rejects unknown category.
20. `AbilitySchema` accepts minimal record.
21. `MoveSchema` accepts minimal record.
22. `MoveSchema` rejects `base_power < 0`.
23. `MoveSchema` accepts `accuracy === null` (always-hit moves).
24. `InsightSchema` accepts the example from CLAUDE.md §6.
25. `InsightSchema` rejects `claim` > 280 chars.
26. `InsightSchema` rejects empty `subjects.pokemon`.
27. `RosterEntrySchema` rejects `format != "RegM-A"`.
28. `SearchHitSchema` rejects `score > 1`.

### `tests/data/fixtures.ts` (helper, not a test file)
Exports `seedTinyDb(): Database` returning an in-memory `:memory:` SQLite seeded with 3 species (Garchomp, Tyranitar, Rotom-Wash with a form_id), a Mega (Mega-Garchomp), 4 sample sets, ~10 items/abilities/moves. Used by all repo tests.

### `tests/data/roster.test.ts` (strict per-test red-first)
Each `it(...)` written as red before the corresponding repo function is implemented:

1. `list(db, "RegM-A")` returns rows in canonical id order.
2. `list` returns only legal entries (sets up an illegal row, asserts excluded).
3. `get(db, "Garchomp", "RegM-A")` returns the Garchomp record.
4. `get` is case-insensitive — `get(db, "garchomp", ...)` returns same record.
5. `get` accepts an alias and resolves to canonical id.
6. `get(db, "Mewtwo", "RegM-A")` returns `null`.
7. `get` returns a Pokemon whose `movepool` array is non-empty.
8. `get` for a Mega form sets `is_mega === true`.
9. ambiguous-form handling: `get(db, "Slowbro", ...)` returns the base form, never a Galarian/regional form (when both exist in fixture).
10. `has(db, "Garchomp", "RegM-A")` returns true.
11. `has(db, "Mewtwo", "RegM-A")` returns false.
12. `has` is case-insensitive.
13. `search(db, "garcha", "RegM-A")` ranks Garchomp first.
14. `search` returns ≤ 10 hits.
15. `search` returns empty array on a query matching nothing above 0.3.
16. `search` distinguishes `matched_on` (id vs display_name vs alias).
17. `sets(db, "Garchomp", "RegM-A")` returns ≥ 1 SampleSet.
18. `sets` returns empty array for a species with no sample sets but throws `RosterDataError` for an unknown species.
19. prepared statements cached: `get` called 100x runs without re-preparing (assert via spy).
20. closing the DB and re-calling throws `RosterDbError` (not a generic SQLITE error).

### `tests/data/items.test.ts`, `tests/data/abilities.test.ts`, `tests/data/moves.test.ts`
Each: `list` returns sorted; `get` case-insensitive; `get` returns `null` on miss; `has` boolean; `RosterDbError` on closed DB. ~5 cases per file.

### `tests/data/insights.test.ts` (vector stub)
1. `createInsightStore()` returns an object satisfying the `InsightStore` interface (structural type test via `satisfies`).
2. `.add(validInsight)` throws `NotImplementedError`.
3. `.search("query")` throws `NotImplementedError`.
4. `NotImplementedError.message` mentions "v1 stub".
5. `InsightStore` shape is callable from a hypothetical future ingest tool (compiles when handed `StubInsightStore`).

### `tests/data/coverage.test.ts` (against real built `db.sqlite`)
1. every species in `Generations.get(0).species` has a `species` row.
2. every species has a `species_stats` row.
3. every species has ≥ 1 `species_abilities` row in slot `0`.
4. every species has ≥ 1 `species_movepool` row.
5. every species has a `roster_membership` row with `format = "RegM-A"`, `is_legal = 1`.
6. every Mega form has `is_mega = 1` (derived from `-Mega` suffix).
7. row counts match expected (286 species, 412-ish sample sets — pin to ±5 with explanation).
8. `items` row count == count of items in `Generations.get(0).items` (target 117).
9. `abilities` row count == count of abilities in `Generations.get(0).abilities`.
10. `moves` row count == count of moves in `Generations.get(0).moves`.

### `tests/data/integrity.test.ts` (against real built `db.sqlite`)
1. every `species_abilities.ability_name` exists in `abilities.display_name`.
2. every `species_movepool.move_name` exists in `moves.display_name`.
3. every `sample_sets.ability` exists in `abilities`.
4. every `sample_sets.item` (when not null) exists in `items`.
5. every `sample_sets.moves[i]` exists in `moves`.
6. every species's recorded `ability_name` is engine-known (`Generations.get(0).abilities.get(...)` returns truthy).
7. every recorded `move_name` is engine-known.
8. every recorded `item_name` is engine-known.
9. no `species_stats` row has any zero stat.
10. every `sample_sets.sps` total ≤ 66 (CHECK constraint asserted at insertion; this test re-asserts at read).
11. every `sample_sets.sps` per-stat ≤ 32.
12. no row in any table references an unknown `species_id`.

### `tests/data/sps-evs-translation.test.ts`
1. parsing a real `SETDEX_CHAMPIONS` snapshot via `parseChampionsSets` produces `SampleSet.sps` whose values match the source `sps` field byte-for-byte.
2. attempting to parse a synthetic snapshot with `evs` key throws `ZodError` with the Champions terminology message.
3. mapping a `SampleSet.sps` through the existing `damage-calc/mapping.ts` path produces engine `evs` with identical values (round-trip identity).

### `tests/data/determinism.test.ts`
1. `buildRegMA` run twice **into fresh empty paths** with the same inputs produces byte-identical `db.sqlite` (the from-scratch contract).
2. SHA-256 of the file matches across runs.
3. file size is identical across runs.
4. `schema_migrations.applied_at` value is the literal `'1970-01-01T00:00:00Z'`.
5. Labmaus rows seeded after a first build survive a second `buildRegMA` call against the same path (non-destructive contract — see `docs/plans/labmaus-tournaments.md` §19).
6. Category A row content (every column of `species` / `species_stats` / `species_abilities` / `items` / `abilities` / `moves` / `sample_sets` / `roster_membership`) is logically identical across consecutive in-place rebuilds. Note: when labmaus rows are present, raw-byte page layout can shift between rebuilds; the contract is byte-identical *over category A row content*, not at the page level.

### `tests/data/tool-definitions.test.ts`
1. each accessor exports a tool definition with `name` matching `roster_*` / `items_*` / `abilities_*` / `moves_*`.
2. each `description` is non-empty and ≥ 60 chars.
3. each `input_schema` is JSON-serializable.
4. each `input_schema` requires `format`.
5. sibling tools' descriptions disambiguate each other (e.g., `roster_get` mentions "exact" or "canonical"; `roster_search` mentions "fuzzy").
6. `roster_get`'s `input_schema` rejects extra keys (matches `.strict()`).

### `tests/cli/tool-roster.test.ts`
1. `pnpm tool:roster Garchomp` exits 0 and prints display name + base stats.
2. `--json` flag emits a JSON-parseable `Pokemon`.
3. exits 1 with `RosterDataError` message when DB is corrupt (mock).
4. exits 2 when species is unknown.
5. case-insensitive: `pnpm tool:roster garchomp` works.

### `tests/contract/upstream-calc.test.ts`
1. weekly: GET `https://registry.npmjs.org/@smogon/calc` → assert no published version > pinned date contains `dist/mechanics/champions.js`. Fail with "switch from GitHub pin to npm release `<X.Y.Z>`."
2. weekly: SHA-1 of `SETDEX_CHAMPIONS` (extracted live) against committed snapshot — fail if drifted, advise running `pnpm data:refresh:reg-m-a`.

---

## 12. Cross-check protocol

We trust Smogon as the canonical source per flow Q6, so no Bulbapedia-vs-Smogon reconciliation. Instead: a **manual spot-check** of 5 species, captured in `data/reg-m-a/spot-check.md` (committed):

| Species | Expected base stats (from Showdown UI) | DB base stats | Verified by | Date |
|---|---|---|---|---|
| Garchomp | 108/130/95/80/85/102 | (pull from db) | RC | 2026-05-XX |
| Tyranitar | … | … | RC | … |
| Rotom-Wash | … | … | RC | … |
| Garchomp-Mega | … | … | RC | … |
| Incineroar | … | … | RC | … |

A test in `coverage.test.ts` asserts `spot-check.md` exists and contains rows for all 5 species (loose: regex match on species id).

---

## 13. CLI / scripts

`package.json` script entries:

```jsonc
{
  "scripts": {
    "data:build:reg-m-a":   "tsx scripts/data/build-reg-m-a.ts",
    "data:refresh:reg-m-a": "tsx scripts/data/refresh-reg-m-a.ts",
    "tool:roster":          "tsx src/cli/tool-roster.ts"
  }
}
```

### `pnpm tool:roster <species>` pretty output

```
Species:  Garchomp (garchomp)
Dex:      #445
Types:    Dragon / Ground
Stats:    HP 108  Atk 130  Def 95  SpA 80  SpD 85  Spe 102  (BST 600)
Abilities: 0=Sand Veil  H=Rough Skin
Movepool: 142 moves (Dragon Claw, Earthquake, Outrage, ...)
Mega:     no
Source:   @smogon/calc#c1f6bc0 (fetched 2026-05-04)
```

### Exit codes

`0` success, `1` `RosterDataError`, `2` species not found, `3` `RosterDbError`, `64` argv usage.

---

## 14. Dependencies & versioning

| Package | Version | Why |
|---|---|---|
| `better-sqlite3` | `^11.0.0` | Sync sqlite for the relational tier; native module. |
| `@types/better-sqlite3` | `^7.6.0` (devDep) | Types for the above. |
| `zod-to-json-schema` | already pinned by damage-calc | Reuse for tool definitions. |
| `@anthropic-ai/sdk` | already in repo | Tool type alignment. |

**Skipped:** `sqlite-vec` (v1 stub only). Defer until first Insight ingest milestone.

No other new runtime deps. `tsx` and `vitest` already present.

---

## 15. Reuse audit

Inherited from `damage-calc`:

1. **Error class hierarchy pattern** (`CalcError` → `CalcInputError`/`CalcEngineError`). Mirrored as `RosterError` → `RosterNotFoundError`/`RosterDataError`/`RosterDbError`.
2. **Schema-first zod conventions** (`*Schema` named export + `type X = z.infer<typeof XSchema>`).
3. **`forbidIllegalKeys`-style helper.** `src/schemas/calc.ts` already has the pattern; `SampleSet` re-implements a small variant locally for the `evs` key rejection (the rejection message and behavior is the same; we deliberately do **not** export the calc helper because the forbidden-key set differs — `SampleSet` has no Tera surface).
4. **Trust-boundary typing pattern** (typed-as-domain at the function signature, `as unknown as Domain` cast at the call site for raw inputs).
5. **TSDoc 6-element block style** on every export.
6. **`zod-to-json-schema` → Anthropic tool definition** flow, mirrored 1:1 from `damageCalcToolDefinition`.
7. **CLI script shape and exit-code conventions** (`tool-calc.ts` → `tool-roster.ts`).
8. **Test directory layout** (`tests/<area>/<file>.test.ts`).
9. **`SpsSpreadSchema`** from `src/schemas/sps.ts` is reused unmodified by `SampleSet`.

---

## 16. Risks & mitigations

| # | Risk | Mitigation |
|---|---|---|
| 1 | **Determinism of SQLite bytes across `better-sqlite3` versions.** Different versions can produce different page layouts, breaking byte-equality tests. | Exact-pin `better-sqlite3` (no `^`). `pnpm-lock.yaml` is the determinism contract. The `determinism.test.ts` will fail loudly on a version bump. Document the bump procedure as "update pin → regenerate db.sqlite → review the binary diff." |
| 2 | **`SETDEX_CHAMPIONS` shape changes between snapshots** (Smogon adds a field, renames `sps`). | The schema's `.passthrough()` + explicit allow-list rejects unknown keys with a clear message. Refresh PRs surface diffs; a contract test alarms on unrecognized shape. Recovery: schema PR + new migration + regenerate. |
| 3 | **Mega-form metadata** (`is_mega` derived from species name suffix `"-Mega"`). Edge cases: `"-Mega-X"`, `"-Mega-Y"`, hypothetical `"-Mega-Foo"`. | Derive via regex `/^-Mega(-[XY])?$/` on the form_id portion of the Showdown id. Coverage test asserts all 60 known Mega forms get `is_mega = 1`. If a new mega form ships with a non-conforming suffix the test fails. |
| 4 | **In-memory SQLite vs. on-disk behavioral differences.** `:memory:` uses identical SQLite engine but skips `journal_mode=DELETE`/`VACUUM`. Repo tests pass on `:memory:` while real DB has subtly different behavior. | Coverage + integrity tests run against the **real built `db.sqlite`** opened readonly, not `:memory:`. Every CHECK constraint exercised on disk at least once. |
| 5 | **`@smogon/calc` master moving** and breaking our movepool/ability extraction path (e.g., `Generations.get(0).species.<id>.learnset` rename). | Fork-pin strategy already in place (flow §2.6). Weekly contract test catches a published Champions release. The `extractSpeciesRecords()` adapter is the single file to update on shape change. |
| 6 | **Build pipeline atomicity:** crash between `db.sqlite.tmp` write and rename leaves stale `db.sqlite` plus orphan `.tmp`. | `fsync` before rename. `build-reg-m-a.ts` cleans up any pre-existing `.tmp` on startup. Atomic rename is POSIX-guaranteed within the same filesystem. |
| 7 | **JSON-in-TEXT columns** (e.g., `types`, `moves_json`) lose typed querying. | Acceptable for v1: `types` is queried only by membership in TS code. If we need indexed queries later, normalize into a join table in a follow-up migration. |

---

## 17. Stage 4 hand-off checklist (test order)

Each commit on `feat/pokemon-roster-db` is `test: red — pokemon-roster-db <slice>`:

1. `tests/data/schema.test.ts` (cases 1–28). **Note CLAUDE.md §3 data-definition exemption in commit message.**
2. `tests/data/fixtures.ts` helper scaffolded (no test cases — just the seed function).
3. `tests/data/roster.test.ts` cases 1–9 (list + get + ambiguous form).
4. `tests/data/roster.test.ts` cases 10–16 (has + search).
5. `tests/data/roster.test.ts` cases 17–20 (sets + caching + closed-handle).
6. `tests/data/items.test.ts`, `tests/data/abilities.test.ts`, `tests/data/moves.test.ts`.
7. `tests/data/insights.test.ts` cases 1–5 (stub).
8. `tests/data/sps-evs-translation.test.ts` cases 1–3.
9. `tests/data/tool-definitions.test.ts` cases 1–6.
10. `tests/cli/tool-roster.test.ts` cases 1–5.
11. `tests/data/coverage.test.ts` cases 1–10 (requires `db.sqlite` to exist; Stage 5 builds it).
12. `tests/data/integrity.test.ts` cases 1–12.
13. `tests/data/determinism.test.ts` cases 1–4.
14. `tests/contract/upstream-calc.test.ts` cases 1–2 (skipped in CI by default; runs via `pnpm test:contract`).

Stage 5 makes them green in this same order.

---

## 18. Out of scope (re-stated from flow §2.10)

- Real vector-store integration (`sqlite-vec` install + embeddings) — stub interface only.
- Item/move legality enforcement at the calc-tool layer.
- UI for browsing the roster.
- Live updates / polling for new Champions patches.
- `team_validate` tool (later milestone; will consume this DB).
- Bulbapedia ingest (removed from pipeline per flow Q6).

---

## 19. Decisions made where flow / CLAUDE.md were silent

1. **Schema files split per entity**, not consolidated. Easier to grep, easier to test slice-by-slice, isolates the `SampleSet` `evs`-rejection logic from `Pokemon`.
2. **`db.sqlite` is committed**, not gitignored. Rationale: matches `damage-calc` fixture commit policy; consumers don't need to run the build to use the agent. Escape hatch documented if determinism becomes flaky.
3. **`schema_migrations.applied_at` frozen at `'1970-01-01T00:00:00Z'`** for byte-determinism.
4. **Search ranking algorithm:** rule-based (exact / prefix / substring / Damerau-Levenshtein) over the 286-row species table in TS, not SQLite FTS5. Simpler, deterministic, easy to test, no extension to load.
5. **`get()` returns `null`** on miss (matches flow §3); `RosterNotFoundError` reserved for build-time integrity violations and an opt-in `getOrThrow()` helper.
6. **Repo-style modules of pure functions** taking `Database` first arg, not classes. Matches `damage-calc/mapping.ts` ergonomics; trivially mockable in tests.
7. **One `:memory:` seed helper** (`tests/data/fixtures.ts`) rather than per-test seeds — keeps repo tests fast and DRY.
8. **CLI exit codes** mirror `tool-calc`: 0/1/2/3/64.
9. **`is_mega` derivation regex** = `/^-Mega(-[XY])?$/` against the form_id suffix.
10. **Anti-corruption fetcher lives under `scripts/data/fetchers/`**, not `src/`, because it's build-time only and should not be importable by runtime code (enforced by directory + future ESLint rule).
11. **JSON-in-TEXT columns** for `types`/`moves`/`source` blocks rather than normalized child tables. v1 simplification; can normalize via migration later.
12. **No FTS5 / no `sqlite-vec` extension loading** in v1. Keeps `better-sqlite3` install path minimal.

---

## 20. Items for user confirmation before Stage 4

1. **Commit `db.sqlite`?** Plan recommends yes. Confirm or flip to gitignored + `postinstall` rebuild.
Answer: commit `db.sqlite`.

2. **Schema files split per entity** (Pokemon/SampleSet/Item/Ability/Move/Insight in separate files) — OK, or prefer one consolidated `roster.ts` schema file?
Answer: split per entity.

3. **`get()` null-on-miss vs. throwing** — flow §3 says `null`; plan keeps that. `RosterNotFoundError` reserved for build-time and `getOrThrow()`. OK?
Answer: `get()` returns `null` on miss.

4. **Search algorithm in TS rather than SQLite FTS5** — OK for v1?
Answer: rule-based in TS is fine for v1.

5. **`schema_migrations.applied_at` frozen literal** for determinism — OK, or prefer omitting the column entirely?
Answer: frozen literal is fine for v1.

6. **`is_mega` regex** = `/^-Mega(-[XY])?$/` — OK, or stricter / looser?
Answer: the proposed regex is fine for v1.

7. **JSON-in-TEXT for `types`/`moves`/`source`** vs. normalized — OK for v1?
Answer: JSON-in-TEXT is fine for v1.

---

### Critical files for implementation

- `/Users/rodrigo/src/pokemon-ai-trainer/src/schemas/pokemon.ts`
- `/Users/rodrigo/src/pokemon-ai-trainer/src/db/roster.ts`
- `/Users/rodrigo/src/pokemon-ai-trainer/src/db/schema.sql`
- `/Users/rodrigo/src/pokemon-ai-trainer/scripts/data/build-reg-m-a.ts`
- `/Users/rodrigo/src/pokemon-ai-trainer/scripts/data/fetchers/smogon-champions-data.ts`

---

_End of plan._