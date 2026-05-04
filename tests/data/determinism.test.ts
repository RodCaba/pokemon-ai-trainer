import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, unlinkSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRegMA } from "../../scripts/data/build-reg-m-a";
import { open } from "../../src/db/open";

// Two builds with identical inputs MUST produce byte-identical SQLite files.
// The build pipeline guarantees this via:
//   1. Sorted insertion order (species/items/abilities/moves all sort by id).
//   2. Frozen `applied_at` literal in `schema_migrations` (no wall-clock timestamps).
//   3. PRAGMA journal_mode=DELETE + VACUUM to compact pages and remove the WAL.
//   4. Fixed `FETCHED_AT` constant in the source provenance JSON.

const BUILD_TIMEOUT_MS = 30_000;

let workDir: string;
let path1: string;
let path2: string;

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), "regma-determinism-"));
  path1 = join(workDir, "build1.sqlite");
  path2 = join(workDir, "build2.sqlite");
  await buildRegMA(path1, { verbose: false });
  await buildRegMA(path2, { verbose: false });
}, BUILD_TIMEOUT_MS);

afterAll(() => {
  for (const p of [path1, path2, `${path1}.tmp`, `${path2}.tmp`]) {
    if (existsSync(p)) {
      try { unlinkSync(p); } catch { /* ignore */ }
    }
  }
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

describe("determinism — two builds with same inputs", () => {
  it("1. produces byte-identical db.sqlite", () => {
    const bytes1 = readFileSync(path1);
    const bytes2 = readFileSync(path2);
    expect(bytes1.equals(bytes2)).toBe(true);
  });

  it("2. SHA-256 of the file matches across runs", () => {
    expect(sha256(path1)).toBe(sha256(path2));
  });

  it("3. file size is identical across runs", () => {
    expect(statSync(path1).size).toBe(statSync(path2).size);
  });

  it("4. schema_migrations.applied_at is the literal '1970-01-01T00:00:00Z' (frozen)", () => {
    const db = open(path1, { readonly: true });
    try {
      const rows = db.$client
        .prepare("SELECT version, name, applied_at FROM schema_migrations ORDER BY version")
        .all() as Array<{ version: number; name: string; applied_at: string }>;
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        expect(r.applied_at).toBe("1970-01-01T00:00:00Z");
      }
    } finally {
      db.$client.close();
    }
  });
});
