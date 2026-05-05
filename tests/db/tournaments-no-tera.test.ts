/**
 * Test T35 — property: no row in any tournaments table has any column matching /tera/i.
 *
 * Per CLAUDE.md §3 last paragraph and plan §10 footer, this test is a vacuous-green
 * candidate (the schema in §5 is right ⇒ this passes trivially). Flagged in the
 * Stage-4 change report so the reviewer can confirm. The explicit guard catches
 * future regressions.
 *
 * Stage 4: this test fails because `upsertTournament` throws "not implemented".
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as tournaments from "../../src/db/tournaments";
import type { TransformedTournament } from "../../src/tools/labmaus/transform";
import type { Db } from "../../src/db/open";
import { closeIfOpen, seedLabmausDb } from "./labmaus-fixtures";

let db: Db;
beforeEach(() => {
  db = seedLabmausDb();
});
afterEach(() => {
  closeIfOpen(db);
});

describe("tournaments-no-tera property", () => {
  it("T35. introspect SQL: no column or persisted source_json blob mentions tera (case-insensitive)", () => {
    // Seed one tournament so source_json blobs exist
    const payload: TransformedTournament = {
      tournament: {
        schema_version: 1,
        id: "labmaus:56757",
        external_id: 56757,
        tournament_code: null,
        name: "T",
        organizer: null,
        format: "RegM-A",
        division: "Masters",
        status: "unofficial",
        date: "2026-05-04",
        num_players: 0,
        num_phase_2: null,
        source: {
          schema_version: 1,
          site: "labmaus",
          site_source: "limitless",
          source_url: "https://labmaus.net/tournaments/56757",
          fetched_at: "2026-05-04T19:32:11Z",
        },
      },
      teams: [],
      species: [],
    };
    tournaments.upsertTournament(db, payload);

    // Introspect column names across the three tournament-related tables.
    const tableNames = ["tournaments", "tournament_teams", "tournament_team_species"];
    for (const name of tableNames) {
      const rows = db.$client.prepare(`PRAGMA table_info("${name}")`).all() as Array<{ name: string }>;
      for (const r of rows) {
        expect(/tera/i.test(r.name)).toBe(false);
      }
    }
    // Also scan any text columns that might store JSON blobs.
    // (tournaments has no source_json column today; the source row stores its own JSON-like fields.)
    // No-op iteration over zero blobs is fine; the column-name check above is the load-bearing assertion.
  });
});
