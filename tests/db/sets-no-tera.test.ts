/**
 * Test T36 — no row in `team_sets` carries any column or JSON key
 * matching /tera/i.
 *
 * Per CLAUDE.md §3 last paragraph: this test is **flagged as a
 * vacuous-green slip** in the Stage 4 commit message because the
 * domain schema (`TeamSetSchema.strict()`) already has no tera_*
 * field by design — once Stage 5 wires the upsert path, no row CAN
 * carry a tera key. The test exists as a regression guard against a
 * future code change that loosens the schema or the table; the
 * Stage 6 reviewer is expected to scrutinize whether it asserts
 * anything substantive.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as sets from "../../src/db/sets";
import type { Db } from "../../src/db/open";
import type { TeamSet } from "../../src/schemas/team-set";
import {
  tournaments as tournamentsTable,
  tournamentTeams,
} from "../../src/db/drizzle-schema";
import { closeIfOpen, seedLabmausDb } from "./labmaus-fixtures";

const FETCHED_AT = "2026-05-04T19:32:11.000Z";

describe("team_sets has no tera_* anywhere (T36)", () => {
  let db: Db;
  beforeEach(() => {
    db = seedLabmausDb();
  });
  afterEach(() => {
    closeIfOpen(db);
  });

  it("T36. no team_sets column or JSON blob carries a tera_* key", () => {
    db.insert(tournamentsTable)
      .values({
        id: "labmaus:56757",
        externalId: 56757,
        tournamentCode: null,
        name: "T",
        organizer: null,
        format: "RegM-A",
        division: "Masters",
        status: "unofficial",
        date: "2026-05-01",
        numPlayers: 1,
        numPhase2: null,
        sourceSite: "labmaus",
        sourceSiteSource: null,
        sourceUrl: "https://labmaus.net/tournaments/56757",
        fetchedAt: FETCHED_AT,
      })
      .run();
    db.insert(tournamentTeams)
      .values({
        id: "labmaus:56757:1",
        tournamentId: "labmaus:56757",
        externalTeamId: 1,
        player: "p",
        playerKey: "p",
        country: null,
        placement: 1,
        record: "1-0-0",
        teamUrl: "https://pokepast.es/abc",
        fetchedAt: FETCHED_AT,
      })
      .run();

    const ts: TeamSet = {
      schema_version: 1,
      id: "labmaus:56757:1:0",
      tournament_team_id: "labmaus:56757:1",
      slot: 0,
      species_roster_id: "sneasler",
      item: "Focus Sash",
      ability: "Unburden",
      level: 50,
      moves: ["Close Combat", "Dire Claw", "Fake Out", "Protect"],
      sps: null,
      ivs: null,
      nature: null,
      completeness: "minimal",
      source: {
        schema_version: 1,
        site: "pokepaste",
        paste_id: "abc1234567890def",
        source_url: "https://pokepast.es/abc1234567890def",
        fetched_at: FETCHED_AT,
      },
    };
    sets.upsertTeamSets(db, [ts]);

    // Introspect schema columns.
    const cols = db.$client
      .prepare("PRAGMA table_info(team_sets)")
      .all() as Array<{ name: string }>;
    for (const c of cols) expect(/tera/i.test(c.name)).toBe(false);

    // Scan JSON blobs for any tera_* key.
    const rows = db.$client
      .prepare("SELECT moves_json, sps_json, ivs_json FROM team_sets")
      .all() as Array<{ moves_json: string; sps_json: string | null; ivs_json: string | null }>;
    for (const r of rows) {
      for (const blob of [r.moves_json, r.sps_json, r.ivs_json]) {
        if (blob === null) continue;
        expect(/tera/i.test(blob)).toBe(false);
      }
    }
  });
});
