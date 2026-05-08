/**
 * USR-T7..T9 — migration 0009 creates `user_teams`, `user_team_sets`,
 * `user_team_revisions`. Idempotent across two opens. FK SET NULL on
 * source_tournament_team_id; CASCADE on user_teams delete.
 *
 * Stage-4 red. Per `docs/plans/user-teams.md` §5 / §15.
 * Memory `single_db_non_destructive_build.md` is binding — migration is
 * additive and does not touch existing tables.
 */

import { mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { open, type Db } from "../../src/db/open";

let tmpRoot: string;
beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "user-teams-mig-"));
});
afterEach(() => {
  try {
    rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* noop */
  }
});

function tableExists(db: Db, name: string): boolean {
  const row = db.$client
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(name) as { name?: string } | undefined;
  return !!row?.name;
}

describe("user-teams migration 0009 (USR-T7..T9)", () => {
  it("USR-T7. migration 0009 creates the three tables idempotently across two opens", () => {
    const path = join(tmpRoot, "u-t7.sqlite");
    const a = open(path);
    try {
      expect(tableExists(a, "user_teams")).toBe(true);
      expect(tableExists(a, "user_team_sets")).toBe(true);
      expect(tableExists(a, "user_team_revisions")).toBe(true);
      const versions = (
        a.$client
          .prepare("SELECT version FROM schema_migrations ORDER BY version")
          .all() as Array<{ version: number }>
      ).map((r) => r.version);
      expect(versions).toContain(9);
    } finally {
      a.$client.close();
    }
    // Re-open: must succeed without re-running.
    const b = open(path);
    try {
      expect(tableExists(b, "user_teams")).toBe(true);
      const versions = (
        b.$client
          .prepare("SELECT version FROM schema_migrations ORDER BY version")
          .all() as Array<{ version: number }>
      ).map((r) => r.version);
      expect(versions.filter((v) => v === 9)).toHaveLength(1);
    } finally {
      b.$client.close();
    }
    try { unlinkSync(path); } catch { /* noop */ }
  });

  it("USR-T8. FK source_tournament_team_id → tournament_teams.id ON DELETE SET NULL preserves the user team", () => {
    const db = open(":memory:");
    try {
      // Seed minimal tournament + tournament_team to satisfy FK target.
      db.$client
        .prepare(
          `INSERT INTO tournaments
             (id, external_id, tournament_code, name, organizer, format, division,
              status, date, num_players, num_phase_2, source_site, source_site_source,
              source_url, fetched_at)
           VALUES ('labmaus:1', 1, NULL, 'T1', NULL, 'RegM-A', 'Masters',
                   'unofficial', '2026-04-10', 6, NULL, 'labmaus', NULL,
                   'https://labmaus.net/tournaments/1', '2026-05-04T00:00:00Z')`,
        )
        .run();
      db.$client
        .prepare(
          `INSERT INTO tournament_teams
             (id, tournament_id, external_team_id, player, player_key, country,
              placement, record, team_url, fetched_at)
           VALUES ('labmaus:1:1', 'labmaus:1', 1, 'P', 'p', NULL, 1, '1-0-0',
                   'https://pokepast.es/abc', '2026-05-04T00:00:00Z')`,
        )
        .run();
      // Create a user team referencing it.
      db.$client
        .prepare(
          `INSERT INTO user_teams
             (id, name, description, win_condition, status, origin,
              origin_payload, source_tournament_team_id, validation_errors,
              validation_warnings, schema_version, created_at, updated_at)
           VALUES ('01HUSER000000000000000001', 'dup-team', NULL, NULL, 'draft',
                   'duplicated_from_tournament', NULL, 'labmaus:1:1', '[]', '[]',
                   1, '2026-05-08T00:00:00Z', '2026-05-08T00:00:00Z')`,
        )
        .run();

      // Delete the parent tournament_team.
      db.$client
        .prepare("DELETE FROM tournament_teams WHERE id = ?")
        .run("labmaus:1:1");

      // The user team must still exist with FK NULLed.
      const after = db.$client
        .prepare(
          "SELECT source_tournament_team_id FROM user_teams WHERE id = ?",
        )
        .get("01HUSER000000000000000001") as
        | { source_tournament_team_id: string | null }
        | undefined;
      // The CHECK on origin_tournament_consistency: origin =
      // 'duplicated_from_tournament' iff source FK is NOT NULL.
      // SET NULL here would violate that CHECK — surface as a documented
      // tension. We assert that EITHER (a) the row survives with FK NULL
      // (CHECK ignored on UPDATE-via-FK) or (b) the row was nulled out
      // and CHECK rejected — Stage 5 picks the lane.
      // For Stage 4 the test fails because tables don't exist yet.
      expect(after).toBeDefined();
      expect(after?.source_tournament_team_id).toBeNull();
    } finally {
      db.$client.close();
    }
  });

  it("USR-T9. CASCADE on user_teams delete removes user_team_sets and user_team_revisions", () => {
    const db = open(":memory:");
    try {
      db.$client
        .prepare(
          `INSERT INTO user_teams
             (id, name, description, win_condition, status, origin,
              origin_payload, source_tournament_team_id, validation_errors,
              validation_warnings, schema_version, created_at, updated_at)
           VALUES ('01HUSER000000000000000002', 'cascade-team', NULL, NULL, 'draft',
                   'builder', NULL, NULL, '[]', '[]',
                   1, '2026-05-08T00:00:00Z', '2026-05-08T00:00:00Z')`,
        )
        .run();
      // Two slot rows (other slot columns nullable).
      db.$client
        .prepare(
          `INSERT INTO user_team_sets (user_team_id, slot) VALUES (?, ?)`,
        )
        .run("01HUSER000000000000000002", 0);
      db.$client
        .prepare(
          `INSERT INTO user_team_sets (user_team_id, slot) VALUES (?, ?)`,
        )
        .run("01HUSER000000000000000002", 1);
      // One revision row.
      db.$client
        .prepare(
          `INSERT INTO user_team_revisions
             (user_team_id, revision_number, label, snapshot_json, created_at)
           VALUES (?, ?, NULL, '{}', '2026-05-08T00:00:00Z')`,
        )
        .run("01HUSER000000000000000002", 1);

      const setsBefore = db.$client
        .prepare("SELECT COUNT(*) AS c FROM user_team_sets WHERE user_team_id = ?")
        .get("01HUSER000000000000000002") as { c: number };
      expect(setsBefore.c).toBe(2);
      const revsBefore = db.$client
        .prepare("SELECT COUNT(*) AS c FROM user_team_revisions WHERE user_team_id = ?")
        .get("01HUSER000000000000000002") as { c: number };
      expect(revsBefore.c).toBe(1);

      db.$client
        .prepare("DELETE FROM user_teams WHERE id = ?")
        .run("01HUSER000000000000000002");

      const setsAfter = db.$client
        .prepare("SELECT COUNT(*) AS c FROM user_team_sets WHERE user_team_id = ?")
        .get("01HUSER000000000000000002") as { c: number };
      expect(setsAfter.c).toBe(0);
      const revsAfter = db.$client
        .prepare("SELECT COUNT(*) AS c FROM user_team_revisions WHERE user_team_id = ?")
        .get("01HUSER000000000000000002") as { c: number };
      expect(revsAfter.c).toBe(0);
    } finally {
      db.$client.close();
    }
  });
});
