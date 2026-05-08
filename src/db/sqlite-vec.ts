/**
 * Loader for the `sqlite-vec` extension. Resolves the platform-specific
 * native binary from the `sqlite-vec` npm package and loads it into the raw
 * `better-sqlite3` handle. Throws `KnowledgeStorageError` with a clear
 * "install sqlite-vec for your platform" message on failure.
 *
 * Build-time escape hatch: when `SKIP_SQLITE_VEC=1` is set, this is a no-op
 * AND `applyMigrations` skips the knowledge migrations. Production never
 * sets this.
 */

import type { Database as SqliteDatabase } from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { KnowledgeStorageError } from "../schemas/errors";

/**
 * Load the `sqlite-vec` extension into a raw better-sqlite3 handle.
 *
 * **When to use it:** called by `open()` once per DB before migrations run,
 * since `0007_knowledge_vec0.sql` references the `vec0` virtual-table module.
 *
 * @param raw — A raw `better-sqlite3` Database handle (from `Database(...)`).
 * @throws {KnowledgeStorageError} If the extension is not loadable on the
 *   current platform (e.g. binary missing, OS not supported).
 */
export function loadSqliteVec(raw: SqliteDatabase): void {
  if (process.env.SKIP_SQLITE_VEC === "1") return;
  try {
    sqliteVec.load(raw);
  } catch (e) {
    throw new KnowledgeStorageError(
      "sqlite-vec extension failed to load — install sqlite-vec for your platform " +
        "(`pnpm add sqlite-vec`) or set SKIP_SQLITE_VEC=1 to skip the vector tier.",
      { cause: e },
    );
  }
}
