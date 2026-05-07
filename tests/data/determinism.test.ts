import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, unlinkSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRegMA } from "../../scripts/data/build-reg-m-a";
import { open } from "../../src/db/open";

// Two builds with identical inputs MUST produce byte-identical SQLite files
// **when starting from an empty file** (the from-scratch contract). The build
// pipeline guarantees this via:
//   1. Sorted insertion order (species/items/abilities/moves all sort by id).
//   2. Frozen `applied_at` literal in `schema_migrations` (no wall-clock timestamps).
//   3. PRAGMA journal_mode=DELETE + VACUUM to compact pages and remove the WAL.
//   4. Fixed `FETCHED_AT` constant in the source provenance JSON.
//
// Post-refactor (see docs/plans/labmaus-tournaments.md §17), the build is
// non-destructive: it opens an existing DB and rewrites only category A
// tables. When labmaus rows are present, page-layout interleaving means raw
// bytes can shift between rebuilds even though every category A row is
// identical — the determinism contract is now "byte-identical over category A
// (logical content)" rather than "byte-identical at the page level". The
// fresh-path tests below still cover the from-scratch byte-identity case;
// the second describe block covers preservation + logical determinism over
// an existing labmaus-rich DB.

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

describe("non-destructive rebuild — labmaus rows survive, category A is logically identical", () => {
  const CATEGORY_A_TABLES = [
    "species",
    "species_stats",
    "species_abilities",
    "items",
    "abilities",
    "moves",
    "sample_sets",
    "roster_membership",
  ] as const;

  let workDir: string;
  let dbPath: string;

  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), "regma-nondestructive-"));
    dbPath = join(workDir, "build.sqlite");
    // First build: bootstrap the DB.
    await buildRegMA(dbPath, { verbose: false });
  }, BUILD_TIMEOUT_MS);

  afterAll(() => {
    if (existsSync(dbPath)) {
      try { unlinkSync(dbPath); } catch { /* ignore */ }
    }
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  it("5. labmaus rows seeded after the first build survive a rebuild", async () => {
    // Seed a synthetic labmaus tournament + team into the existing DB. We use
    // raw SQL so the test doesn't depend on the labmaus repo's signature.
    const seed = open(dbPath);
    try {
      seed.$client.exec(`
        INSERT INTO tournaments (id, external_id, name, format, division, status, date,
          num_players, source_site, source_url, fetched_at)
        VALUES ('labmaus:99999', 99999, 'Synthetic', 'RegM-A', 'Masters', 'unofficial',
          '2026-05-04', 1, 'labmaus', 'https://labmaus.net/tournaments/99999',
          '2026-05-04T00:00:00Z');
        INSERT INTO tournament_teams (id, tournament_id, external_team_id, player, player_key,
          placement, record, team_url, fetched_at)
        VALUES ('labmaus:99999:1', 'labmaus:99999', 1, 'p', 'p', 1, '0-0-0',
          'https://pokepast.es/abc', '2026-05-04T00:00:00Z');
      `);
    } finally {
      seed.$client.close();
    }

    // Rebuild — must NOT wipe the labmaus rows.
    await buildRegMA(dbPath, { verbose: false });

    const after = open(dbPath, { readonly: true });
    try {
      const t = after.$client
        .prepare("SELECT count(*) AS n FROM tournaments WHERE id = 'labmaus:99999'")
        .get() as { n: number };
      const tt = after.$client
        .prepare("SELECT count(*) AS n FROM tournament_teams WHERE id = 'labmaus:99999:1'")
        .get() as { n: number };
      expect(t.n).toBe(1);
      expect(tt.n).toBe(1);
    } finally {
      after.$client.close();
    }
  }, BUILD_TIMEOUT_MS);

  it("6. category A row content is identical across consecutive rebuilds", async () => {
    // Snapshot category A logical content, rebuild, snapshot again, compare.
    const snapshot = (): Record<string, unknown[]> => {
      const db = open(dbPath, { readonly: true });
      try {
        const out: Record<string, unknown[]> = {};
        for (const t of CATEGORY_A_TABLES) {
          // Stable ordering: SQLite has no canonical row order, so order by
          // every column lexically. Good enough for "logical equality".
          const cols = (db.$client.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>)
            .map((c) => c.name);
          const orderBy = cols.map((c) => `"${c}"`).join(", ");
          out[t] = db.$client.prepare(`SELECT * FROM "${t}" ORDER BY ${orderBy}`).all();
        }
        return out;
      } finally {
        db.$client.close();
      }
    };

    const before = snapshot();
    await buildRegMA(dbPath, { verbose: false });
    const after = snapshot();
    expect(after).toEqual(before);
  }, BUILD_TIMEOUT_MS);
});
