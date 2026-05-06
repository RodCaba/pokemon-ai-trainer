/**
 * Tests T29–T35 for the bespoke `sets` repo.
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

function seedTournamentRow(db: Db, id: string, date: string): void {
  db.insert(tournamentsTable)
    .values({
      id,
      externalId: Number(id.split(":")[1]),
      tournamentCode: null,
      name: "T",
      organizer: null,
      format: "RegM-A",
      division: "Masters",
      status: "unofficial",
      date,
      numPlayers: 1,
      numPhase2: null,
      sourceSite: "labmaus",
      sourceSiteSource: null,
      sourceUrl: `https://labmaus.net/tournaments/${id.split(":")[1]}`,
      fetchedAt: FETCHED_AT,
    })
    .run();
}

function seedTeamRow(db: Db, tournamentId: string, teamId: string, placement: number | null): void {
  db.insert(tournamentTeams)
    .values({
      id: teamId,
      tournamentId,
      externalTeamId: Number(teamId.split(":")[2]),
      player: "p",
      playerKey: "p",
      country: null,
      placement,
      record: "1-0-0",
      teamUrl: "https://pokepast.es/abc",
      fetchedAt: FETCHED_AT,
    })
    .run();
}

function teamSet(args: {
  team_id: string;
  slot: number;
  rosterId: string;
  item: string | null;
  ability: string | null;
  moves: string[];
}): TeamSet {
  return {
    schema_version: 1,
    id: `${args.team_id}:${args.slot}`,
    tournament_team_id: args.team_id,
    slot: args.slot,
    species_roster_id: args.rosterId,
    item: args.item,
    ability: args.ability,
    level: 50,
    moves: args.moves,
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
  } as TeamSet;
}

describe("sets repo", () => {
  let db: Db;
  beforeEach(() => {
    db = seedLabmausDb();
  });
  afterEach(() => {
    closeIfOpen(db);
  });

  it("T29. upsertTeamSets inserts up to 6 rows in a transaction", () => {
    seedTournamentRow(db, "labmaus:56757", "2026-05-01");
    seedTeamRow(db, "labmaus:56757", "labmaus:56757:1", 1);
    const teamId = "labmaus:56757:1";
    const all: TeamSet[] = [];
    for (let i = 0; i < 6; i++) {
      all.push(teamSet({ team_id: teamId, slot: i, rosterId: "sneasler", item: "Focus Sash", ability: "Unburden", moves: ["Close Combat", "Dire Claw", "Fake Out", "Protect"] }));
    }
    sets.upsertTeamSets(db, all);
    const rows = sets.list(db, { tournament_team_id: teamId });
    expect(rows.length).toBe(6);
  });

  it("T30. upsertTeamSets is idempotent", () => {
    seedTournamentRow(db, "labmaus:56757", "2026-05-01");
    seedTeamRow(db, "labmaus:56757", "labmaus:56757:1", 1);
    const teamId = "labmaus:56757:1";
    const all: TeamSet[] = [];
    for (let i = 0; i < 6; i++) {
      all.push(teamSet({ team_id: teamId, slot: i, rosterId: "sneasler", item: "Focus Sash", ability: "Unburden", moves: ["Close Combat"] }));
    }
    sets.upsertTeamSets(db, all);
    sets.upsertTeamSets(db, all);
    expect(sets.list(db, { tournament_team_id: teamId }).length).toBe(6);
  });

  it("T31. list filters by tournament_id, tournament_team_id, species_roster_id", () => {
    seedTournamentRow(db, "labmaus:56757", "2026-05-01");
    seedTeamRow(db, "labmaus:56757", "labmaus:56757:1", 1);
    seedTeamRow(db, "labmaus:56757", "labmaus:56757:2", 2);
    sets.upsertTeamSets(db, [
      teamSet({ team_id: "labmaus:56757:1", slot: 0, rosterId: "sneasler", item: "Focus Sash", ability: "Unburden", moves: ["Close Combat"] }),
      teamSet({ team_id: "labmaus:56757:2", slot: 0, rosterId: "garchomp", item: "Choice Scarf", ability: "Rough Skin", moves: ["Earthquake"] }),
    ]);
    expect(sets.list(db, { tournament_id: "labmaus:56757" }).length).toBe(2);
    expect(sets.list(db, { tournament_team_id: "labmaus:56757:1" }).length).toBe(1);
    expect(sets.list(db, { species_roster_id: "garchomp" }).length).toBe(1);
  });

  it("T32. get returns null on miss", () => {
    expect(sets.get(db, "labmaus:56757:999", 0)).toBeNull();
  });

  it("T33. usage(species, dimension='item') ranks items with usage_percent", () => {
    seedTournamentRow(db, "labmaus:56757", "2026-05-01");
    for (let i = 1; i <= 4; i++) {
      seedTeamRow(db, "labmaus:56757", `labmaus:56757:${i}`, i);
      sets.upsertTeamSets(db, [
        teamSet({ team_id: `labmaus:56757:${i}`, slot: 0, rosterId: "sneasler", item: "Focus Sash", ability: "Unburden", moves: ["Close Combat"] }),
      ]);
    }
    const rows = sets.usage(db, {
      species: "sneasler",
      format: "RegM-A",
      lookback_days: 365,
      dimension: "item",
    });
    expect(rows.length).toBeGreaterThan(0);
    const sash = rows.find((r) => r.key === "Focus Sash");
    expect(sash?.appearances).toBe(4);
    expect(sash?.usage_percent).toBeCloseTo(100, 0);
    expect(sash?.citations.length).toBeGreaterThan(0);
  });

  it("T34. usage(species, dimension='move') expands moves_json correctly", () => {
    seedTournamentRow(db, "labmaus:56757", "2026-05-01");
    seedTeamRow(db, "labmaus:56757", "labmaus:56757:1", 1);
    sets.upsertTeamSets(db, [
      teamSet({ team_id: "labmaus:56757:1", slot: 0, rosterId: "sneasler", item: "Focus Sash", ability: "Unburden", moves: ["Close Combat", "Dire Claw", "Fake Out", "Protect"] }),
    ]);
    const rows = sets.usage(db, {
      species: "sneasler",
      format: "RegM-A",
      lookback_days: 365,
      dimension: "move",
    });
    const direClaw = rows.find((r) => r.key === "Dire Claw");
    expect(direClaw?.appearances).toBe(1);
  });

  it("T35. usage respects lookback_days via tournament join", () => {
    seedTournamentRow(db, "labmaus:56757", "2026-05-01");
    seedTournamentRow(db, "labmaus:9999", "2024-01-01");
    seedTeamRow(db, "labmaus:56757", "labmaus:56757:1", 1);
    seedTeamRow(db, "labmaus:9999", "labmaus:9999:1", 1);
    sets.upsertTeamSets(db, [
      teamSet({ team_id: "labmaus:56757:1", slot: 0, rosterId: "sneasler", item: "Focus Sash", ability: "Unburden", moves: ["Close Combat"] }),
      teamSet({ team_id: "labmaus:9999:1", slot: 0, rosterId: "sneasler", item: "Black Glasses", ability: "Unburden", moves: ["Close Combat"] }),
    ]);
    const rows = sets.usage(db, {
      species: "sneasler",
      format: "RegM-A",
      lookback_days: 30,
      dimension: "item",
    });
    // The 2024 tournament is outside the 30-day window — only Focus Sash survives.
    expect(rows.find((r) => r.key === "Black Glasses")).toBeUndefined();
  });
});
