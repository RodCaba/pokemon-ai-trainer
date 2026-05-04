import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database, { type Database as SqliteDatabase } from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { RosterDbError } from "../schemas/errors";
import * as schema from "./drizzle-schema";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, "migrations");

/**
 * The application-facing database handle: a Drizzle wrapper around
 * `better-sqlite3` with the full schema attached for type-safe queries.
 *
 * The underlying `better-sqlite3` connection is exposed by Drizzle as `$client`
 * — use it as the escape hatch for the build pipeline (`db.$client.transaction(...)`,
 * `db.$client.exec(...)`) and for `db.$client.close()`.
 */
export type Db = BetterSQLite3Database<typeof schema> & { $client: SqliteDatabase };

/**
 * Open a SQLite handle, apply all migrations idempotently, and return a Drizzle DB.
 *
 * **When to use it:** for production reads, pass a real file path
 * (`open("/path/to/db.sqlite")`). For tests and the build pipeline, pass `":memory:"`
 * to get a fresh in-memory DB.
 *
 * Migrations are read from `src/db/migrations/*.sql` in lexicographic order. Idempotent:
 * if `schema_migrations` already records a version, that migration is skipped. The raw
 * `better-sqlite3` handle is exposed as `db._raw` for the rare case where Drizzle's
 * builder doesn't cover a query (escape hatch — prefer the typed builder).
 *
 * @param dbPath — A file path on disk, or the literal `":memory:"` for an in-memory DB.
 * @param opts — Optional flags. `readonly: true` opens the DB read-only (production mode).
 * @returns A Drizzle DB handle bound to our `schema` namespace.
 * @throws {RosterDbError} If migrations fail to apply or the file can't be opened.
 */
export function open(dbPath: string, opts?: { readonly?: boolean }): Db {
  let raw: SqliteDatabase;
  try {
    raw = new Database(dbPath, { readonly: opts?.readonly ?? false });
  } catch (e) {
    throw new RosterDbError(`failed to open SQLite at ${dbPath}`, { cause: e, query: dbPath });
  }
  raw.pragma("foreign_keys = ON");

  if (!opts?.readonly) {
    applyMigrations(raw);
  }

  return drizzle(raw, { schema }) as Db;
}

function applyMigrations(raw: SqliteDatabase): void {
  raw.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00Z'
  );`);

  const applied = new Set<number>(
    raw
      .prepare("SELECT version FROM schema_migrations")
      .all()
      .map((r) => (r as { version: number }).version),
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();

  for (const file of files) {
    const version = Number.parseInt(file.slice(0, 4), 10);
    if (applied.has(version)) continue;
    const sqlText = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    try {
      raw.transaction(() => {
        raw.exec(sqlText);
        // Plain INSERT (not OR IGNORE): a duplicate version means two migrations
        // share a numeric prefix, which is a build bug worth surfacing loudly.
        raw
          .prepare("INSERT INTO schema_migrations (version, name) VALUES (?, ?)")
          .run(version, file);
      })();
    } catch (e) {
      throw new RosterDbError(`migration ${file} failed`, { cause: e, query: file });
    }
  }
}
