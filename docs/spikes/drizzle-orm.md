# Spike — Drizzle ORM for the roster DB

**Date:** 2026-05-04
**Trigger:** Spawned during `pokemon-roster-db` Stage 4 slice 2 (fixture helper). User pushed back on raw SQL: "why aren't we using an ORM?". Architectural decision needed before more code lands.

## Outcome

**Adopt Drizzle ORM.** Single source of truth (`src/db/drizzle-schema.ts`), drizzle-kit generates migrations, type-safe queries via the builder, escape hatch for raw SQL via `db.$client`. Determinism preserved (byte-identical SQLite output across runs). 84 tests still green, typecheck clean.

## What was tested in the spike

1. **Install + native build.** `pnpm add drizzle-orm` + `pnpm add -D drizzle-kit`. No native deps, no build step. Re-installed `better-sqlite3` natively (already in repo).
2. **Schema port.** Hand-translated the SQL from plan §4 into `src/db/drizzle-schema.ts` using `sqliteTable`, `check`, `index`, `uniqueIndex`, `primaryKey`. All 9 tables. CHECK constraints (SPS≤66 sum, ability slot enum, etc.) declared via Drizzle's `check()` helper.
3. **Migration generation.** `pnpm drizzle-kit generate` reads `drizzle-schema.ts` and emits `src/db/migrations/0000_sticky_firebird.sql` plus a `meta/` journal directory. The generated SQL preserves all CHECKs and indexes — byte-faithful to what we'd hand-write.
4. **Migration runner.** `src/db/open.ts` bootstraps `schema_migrations` (kept manual — it's runner metadata, not app data, and including it in Drizzle caused a CREATE TABLE conflict), then iterates `migrations/*.sql` in lexicographic order, applying any not in `schema_migrations`. Idempotent.
5. **Type-safe queries.** Verified via `scripts/spikes/drizzle-spike.ts`:
   - `db.select().from(species).where(eq(species.id, "garchomp")).get()` — typed result with camelCase columns (`displayName`, `dexNo`).
   - `db.select(...).from(species).innerJoin(speciesStats, eq(species.id, speciesStats.speciesId)).get()` — typed join result.
   - Case-insensitive lookup via `sql\`${species.displayName} = 'tyranitar' COLLATE NOCASE\`` — Drizzle's `sql` template lets us drop into raw SQL when needed.
6. **CHECK constraints fire.** Inserting a `sample_sets` row with SPS total 67 throws `SqliteError` from the engine — invariant enforced at the storage layer.
7. **Determinism.** `scripts/spikes/drizzle-determinism.ts` builds two on-disk DBs, hashes each, asserts equal. Both an empty (migrations-only) DB and a fully-seeded DB are byte-identical across runs. Drizzle does not add any nondeterministic output (no timestamps, no UUIDs in default migration scaffolding).
8. **`$client` escape hatch.** Drizzle exposes the raw `better-sqlite3` handle as `db.$client`. Used for `db.$client.transaction(...)` (drizzle's transaction wrapper is async; we want sync), `db.$client.exec(rawSql)` for the migration runner, and `db.$client.close()`. The `Db` type is `BetterSQLite3Database<typeof schema> & { $client: SqliteDatabase }` to surface this in TypeScript.

## Friction encountered (and resolved)

- **Drizzle re-emitted `schema_migrations`.** Fix: removed it from `drizzle-schema.ts`. It's bootstrapped manually in `open.ts`. (Drizzle should not own runner metadata.)
- **`bst` GENERATED ALWAYS column conflict.** SQL had `bst INTEGER GENERATED ALWAYS AS (...) VIRTUAL`; Drizzle treated it as a regular insertable column. Fix: simplified to a regular `integer` column with a CHECK enforcing `bst = hp+atk+def+spa+spd+spe`. Caller computes `bst` at insert. Same integrity guarantee, simpler schema.
- **No GENERATED column support in drizzle-kit.** drizzle-kit does not yet emit `GENERATED ALWAYS AS ... VIRTUAL`. Workaround above.
- **Migration runner regex.** `/^\d{4}_.*\.sql$/` correctly skips Drizzle's `meta/` journal directory because directories don't end in `.sql`.

## Files added

- `src/db/drizzle-schema.ts` — canonical schema definitions (9 tables).
- `src/db/migrations/0000_sticky_firebird.sql` — auto-generated; **do not hand-edit**.
- `src/db/migrations/meta/` — drizzle-kit journal (commit it).
- `drizzle.config.ts` — `pnpm drizzle-kit generate` configuration.
- `scripts/spikes/drizzle-spike.ts` — smoke test (kept for regression).
- `scripts/spikes/drizzle-determinism.ts` — byte-equality check (kept for regression).

## Files removed

- `src/db/schema.sql` — was the hand-written canonical schema. Replaced by `drizzle-schema.ts`.
- `src/db/migrations/0001_initial.sql` — was the hand-written initial migration. Replaced by drizzle-kit output.

## Files updated

- `src/db/open.ts` — returns a Drizzle DB handle (`Db = BetterSQLite3Database<typeof schema> & { $client: SqliteDatabase }`).
- `tests/data/fixtures.ts` — uses `db.insert(table).values({...}).run()` instead of `db.prepare(rawSql).run()`. Type-safe inserts catch column-name typos at compile time.

## What changes for the tech plan

The `pokemon-roster-db.md` tech plan should be updated:
- **§1 Architecture overview:** add Drizzle ORM as a chosen pattern (was a rejected pattern — flip it).
- **§2 Module decomposition:** add `src/db/drizzle-schema.ts` as the canonical schema. Note `src/db/schema.sql` removed.
- **§4 Relational schema (SQL):** keep as documentation of the *intent*, but call out that the runtime source is `drizzle-schema.ts`. The SQL block in §4 is now derived (illustrative).
- **§5 Build pipeline contract:** insertion ordering note can mention type-safe inserts via Drizzle.
- **§7 Repository contracts:** specify that all queries go through Drizzle's builder; `db.$client` is the escape hatch only.
- **§14 Dependencies & versioning:** add `drizzle-orm@^0.45`, `drizzle-kit@^0.31` (devDep).
- **§15 Reuse audit:** Drizzle is now the query layer for all future tables (insights, replays, lead plans).
- **§17 Stage 4 hand-off:** test slices unchanged.
- **§19 Decisions made:** mark "raw SQL via better-sqlite3" as superseded by this spike.

## Recommendation

Adopt. The schema-drift problem is solved (single source of truth in TS), type-safe queries catch errors at compile time, and determinism is preserved. The friction (~20 min spike including the two conflicts above) is dramatically less than the recurring drift cost we'd pay over the project's lifetime.

**Cleanup:** retain `scripts/spikes/drizzle-{spike,determinism}.ts` as smoke regression tests; consider promoting them to `tests/data/determinism.test.ts` (slice 13 in the plan) once the build pipeline lands.
