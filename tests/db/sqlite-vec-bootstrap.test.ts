/**
 * VGC-T36, VGC-T37 — sqlite-vec bootstrap.
 * VGC-T36 passes today (open() already loads sqlite-vec; the migration
 * `0007_knowledge_vec0.sql` creates the virtual table). It's the smoke
 * test that the wire-up is alive.
 *
 * VGC-T37 fails at Stage 4 because there's no injection seam to swap a
 * fake `loadExtension` into `loadSqliteVec`. The Stage 5 implementation
 * adds that seam.
 */

import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { open } from "../../src/db/open";
import { loadSqliteVec } from "../../src/db/sqlite-vec";
import { KnowledgeStorageError } from "../../src/schemas/errors";

describe("sqlite-vec bootstrap (VGC-T36, VGC-T37)", () => {
  it("VGC-T36. open() loads sqlite-vec extension and creates vec0 virtual table", () => {
    const db = open(":memory:");
    try {
      const row = db.$client
        .prepare(
          "SELECT name FROM sqlite_master WHERE name = 'knowledge_chunk_embeddings' LIMIT 1",
        )
        .get();
      expect(row).toBeDefined();
    } finally {
      db.$client.close();
    }
  });

  it("VGC-T37. loadSqliteVec throws KnowledgeStorageError when extension load fails", () => {
    // Stage 5 will plumb an injection seam (e.g. an alternate loader fn) so
    // tests can simulate an unloadable extension. Today the call below has
    // no seam — this test is expected to fail at assertion time.
    const raw = new Database(":memory:");
    try {
      // The fake-load-failure injection lands in Stage 5. For now we attempt
      // a direct call against a mutated handle whose `loadExtension` is
      // replaced; the production loader is expected to surface this as a
      // KnowledgeStorageError.
      const orig = raw.loadExtension.bind(raw);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (raw as unknown as { loadExtension: (...a: unknown[]) => unknown }).loadExtension =
        () => {
          throw new Error("fake extension failure");
        };
      let thrown: unknown;
      try {
        loadSqliteVec(raw);
      } catch (e) {
        thrown = e;
      }
      // Restore for cleanup.
      (raw as unknown as { loadExtension: typeof orig }).loadExtension = orig;
      expect(thrown).toBeInstanceOf(KnowledgeStorageError);
    } finally {
      raw.close();
    }
  });
});
