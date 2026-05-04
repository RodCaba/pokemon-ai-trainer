import { asc, eq, placeholder, sql, type AnyColumn } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { ZodSchema } from "zod";
import type { Db } from "./open";
import { RosterDataError, RosterDbError } from "../schemas/errors";

/**
 * The shape every reference-table repo (items, abilities, moves, ...) implements.
 */
export interface SimpleRepo<TEntity> {
  list(db: Db, format: "RegM-A"): TEntity[];
  get(db: Db, name: string, format: "RegM-A"): TEntity | null;
  has(db: Db, name: string, format: "RegM-A"): boolean;
}

/**
 * Configuration for {@link createSimpleRepo}.
 *
 * @typeParam TRow — The raw Drizzle row shape (camelCase columns) returned by
 *   `db.select().from(table)`.
 * @typeParam TEntity — The validated domain type (snake_case fields, with provenance).
 */
export interface RepoOpts<TRow, TEntity> {
  /** Repo name used in error messages (e.g., `"items"`, `"abilities"`). */
  name: string;
  /** The Drizzle table to query. */
  table: SQLiteTable;
  /** The id column of `table`. Used for primary-key lookups. */
  idColumn: AnyColumn;
  /** The display-name column of `table`. Used for case-insensitive lookups. */
  displayNameColumn: AnyColumn;
  /**
   * Translate a raw row into a validated domain entity. Should run zod validation
   * via {@link parseOrThrow} so schema-invalid rows throw `RosterDataError`.
   */
  rowToEntity: (row: TRow) => TEntity;
}

// Drizzle's prepared-statement types are deeply generic and don't compose
// cleanly with our factory; we use `unknown` internally and cast at the
// call sites in the closures. Caller-facing types stay tight via TEntity.
interface Bundle {
  list: { all: () => unknown[] };
  byId: { get: (params: { id: string }) => unknown };
  byDisplayName: { get: (params: { name: string }) => unknown };
}

/**
 * Build a `SimpleRepo<TEntity>` for a reference table with `id` + `display_name` columns.
 *
 * **When to use it:** any read-only Champions reference table (items, abilities, moves,
 * future natures/types/etc.) where lookups are by canonical id or case-insensitive
 * display name. For multi-source lookups (id + display_name + alias) or multi-table
 * assemblies (like `roster.get` joining species + stats + abilities + movepool), write
 * a bespoke repo instead — the factory deliberately doesn't generalize that far.
 *
 * Each instance carries its own per-`Db` `WeakMap` of prepared statements; the cache
 * is dropped when the `Db` handle is GC'd.
 *
 * @param opts — see {@link RepoOpts}.
 * @returns A `SimpleRepo<TEntity>` with `list`, `get`, `has`.
 *
 * @example
 *   const repo = createSimpleRepo<ItemRow, Item>({
 *     name: "items",
 *     table: itemsTable,
 *     idColumn: itemsTable.id,
 *     displayNameColumn: itemsTable.displayName,
 *     rowToEntity: (r) => parseOrThrow(ItemSchema, { ... }, "items", r.id),
 *   });
 *   export const list = (db, format) => repo.list(db, format);
 */
export function createSimpleRepo<TRow, TEntity>(
  opts: RepoOpts<TRow, TEntity>,
): SimpleRepo<TEntity> {
  const cache = new WeakMap<Db, Bundle>();

  const buildBundle = (db: Db): Bundle => ({
    list: db.select().from(opts.table).orderBy(asc(opts.idColumn)).prepare() as Bundle["list"],
    byId: db
      .select()
      .from(opts.table)
      .where(eq(opts.idColumn, placeholder("id")))
      .prepare() as Bundle["byId"],
    byDisplayName: db
      .select()
      .from(opts.table)
      .where(sql`${opts.displayNameColumn} = ${placeholder("name")} COLLATE NOCASE`)
      .prepare() as Bundle["byDisplayName"],
  });

  const bundle = (db: Db): Bundle => {
    let b = cache.get(db);
    if (!b) {
      b = buildBundle(db);
      cache.set(db, b);
    }
    return b;
  };

  return {
    list(db, format) {
      void format;
      try {
        const rows = bundle(db).list.all() as TRow[];
        return rows.map(opts.rowToEntity);
      } catch (e) {
        if (e instanceof RosterDataError) throw e;
        throw new RosterDbError(`${opts.name}.list failed`, { cause: e, query: { format } });
      }
    },

    get(db, name, format) {
      void format;
      const trimmed = name.trim();
      if (trimmed === "") return null;
      try {
        const p = bundle(db);
        const byId = p.byId.get({ id: toCanonicalId(trimmed) }) as TRow | undefined;
        if (byId) return opts.rowToEntity(byId);
        const byName = p.byDisplayName.get({ name: trimmed }) as TRow | undefined;
        return byName ? opts.rowToEntity(byName) : null;
      } catch (e) {
        if (e instanceof RosterDataError) throw e;
        throw new RosterDbError(`${opts.name}.get failed`, { cause: e, query: { name } });
      }
    },

    has(db, name, format) {
      void format;
      const trimmed = name.trim();
      if (trimmed === "") return false;
      try {
        const p = bundle(db);
        if (p.byId.get({ id: toCanonicalId(trimmed) })) return true;
        if (p.byDisplayName.get({ name: trimmed })) return true;
        return false;
      } catch (e) {
        throw new RosterDbError(`${opts.name}.has failed`, { cause: e, query: { name } });
      }
    },
  };
}

/**
 * Lowercase + strip non-alphanumeric to produce a Showdown-style canonical id.
 *
 * **When to use it:** any place we accept user input that should match a Showdown id
 * (`"Choice Scarf"` → `"choicescarf"`, `"Will-O-Wisp"` → `"willowisp"`). Exported so
 * bespoke repos (`roster.ts`) can use the same normalization.
 */
export function toCanonicalId(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Run `schema.safeParse(candidate)` and convert failure to `RosterDataError`.
 *
 * **When to use it:** every `rowToEntity` mapper. A failed parse means the stored row
 * doesn't match our schema — DB corruption, not caller error — so throwing
 * `RosterDataError` (not `RosterDbError`) gives callers the right signal.
 *
 * @param schema — Zod schema to validate against.
 * @param candidate — Object built from a raw DB row.
 * @param repoName — Name of the repo for the error message (e.g., `"items"`).
 * @param rowId — Id of the offending row, attached as `error.query`.
 * @returns The parsed entity.
 * @throws {RosterDataError} On schema validation failure.
 */
export function parseOrThrow<T>(
  schema: ZodSchema<T>,
  candidate: unknown,
  repoName: string,
  rowId: string,
): T {
  const parsed = schema.safeParse(candidate);
  if (!parsed.success) {
    throw new RosterDataError(`${repoName} row ${rowId} failed schema validation`, {
      cause: parsed.error,
      query: rowId,
    });
  }
  return parsed.data;
}
