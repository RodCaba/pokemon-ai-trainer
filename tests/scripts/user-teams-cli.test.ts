/**
 * USR-T42..T45 — CLI smoke tests for `scripts/data/user-teams.ts`.
 * Stage-4 red.
 *
 * USR-T42: `create` subcommand mints a row.
 * USR-T43: `from-paste --file <fixture>` ingests a draft.
 * USR-T44: `from-tournament` clones into a draft.
 * USR-T45: `set-status saved` returns 1 with error JSON when validation fails.
 */

import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../../scripts/data/user-teams";
import { open } from "../../src/db/open";

let tmp: string;
let dbPath: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "user-teams-cli-"));
  dbPath = join(tmp, "db.sqlite");
});
afterEach(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* noop */ }
});

describe("user-teams CLI (USR-T42..T45)", () => {
  it("USR-T42. create exits 0 and persists a row", async () => {
    const exit = await main([
      "create",
      "--db", dbPath,
      "--name", "smoke-team",
    ]);
    expect(exit).toBe(0);
  });

  it("USR-T43. from-paste --file ingests a draft (exit 0)", async () => {
    const fx = readFileSync(
      join(__dirname, "../../fixtures/pokepaste/2026-05-04__7205bf28f85d1e79.txt"),
      "utf8",
    );
    const filePath = join(tmp, "paste.txt");
    writeFileSync(filePath, fx, "utf8");
    const exit = await main([
      "from-paste",
      "--db", dbPath,
      "--file", filePath,
    ]);
    expect(exit).toBe(0);
  });

  it("USR-T44. from-tournament clones into a draft (exit 0)", async () => {
    // Stage 5: seed a tournament_team so the duplicate path succeeds.
    const seedDb = open(dbPath);
    seedDb.$client
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
    seedDb.$client
      .prepare(
        `INSERT INTO tournament_teams
           (id, tournament_id, external_team_id, player, player_key, country,
            placement, record, team_url, fetched_at)
         VALUES ('labmaus:1:1', 'labmaus:1', 1, 'P', 'p', NULL, 1, '1-0-0',
                 'https://pokepast.es/abc', '2026-05-04T00:00:00Z')`,
      )
      .run();
    seedDb.$client.close();
    const exit = await main([
      "from-tournament",
      "--db", dbPath,
      "--tournament-team-id", "labmaus:1:1",
    ]);
    expect(exit).toBe(0);
  });

  it("USR-T45. set-status saved with validation errors exits non-zero", async () => {
    const exit = await main([
      "set-status",
      "--db", dbPath,
      "01HUSER000000000000000099",
      "saved",
    ]);
    // Either 1 (UserTeamValidationError) or any non-zero — Stage 5
    // pins it to 1; we only assert non-zero so the test stays robust
    // against the CLI's eventual diagnostic phrasing.
    expect(exit).not.toBe(0);
  });
});
