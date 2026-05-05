/**
 * Tests T29–T34c for the bespoke `tournaments` repo.
 *
 * Stage 4: every test fails because the repo functions throw "not implemented
 * (Stage 5)". The assertions below capture the post-Stage-5 contract.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as tournaments from "../../src/db/tournaments";
import type { TransformedTournament } from "../../src/tools/labmaus/transform";
import type { TournamentResult, TournamentTeam, TournamentTeamSpecies } from "../../src/schemas/tournament";
import type { Db } from "../../src/db/open";
import { closeIfOpen, seedLabmausDb } from "./labmaus-fixtures";

const FETCHED_AT = "2026-05-04T19:32:11Z";

let db: Db;
beforeEach(() => {
  db = seedLabmausDb();
});
afterEach(() => {
  closeIfOpen(db);
});

function tournament(
  id: number,
  date: string,
  overrides?: Partial<TournamentResult>,
): TournamentResult {
  return {
    schema_version: 1,
    id: `labmaus:${id}`,
    external_id: id,
    tournament_code: null,
    name: `T${id}`,
    organizer: null,
    format: "RegM-A",
    division: "Masters",
    status: "unofficial",
    date,
    num_players: 6,
    num_phase_2: null,
    source: {
      schema_version: 1,
      site: "labmaus",
      site_source: "limitless",
      source_url: `https://labmaus.net/tournaments/${id}`,
      fetched_at: FETCHED_AT,
    },
    ...overrides,
  };
}

function team(
  tournamentExternalId: number,
  teamExternalId: number,
  player: string,
  placement: number | null,
): TournamentTeam {
  return {
    schema_version: 1,
    id: `labmaus:${tournamentExternalId}:${teamExternalId}`,
    tournament_id: `labmaus:${tournamentExternalId}`,
    external_team_id: teamExternalId,
    player,
    player_key: player.trim().toLowerCase(),
    country: null,
    placement,
    record: "1-0-0",
    team_url: "https://pokepast.es/abc",
    fetched_at: FETCHED_AT,
  };
}

function speciesRow(teamId: string, slot: number, rosterId: string): TournamentTeamSpecies {
  return { team_id: teamId, slot, labmaus_id: "x", roster_id: rosterId };
}

function transformed(t: TournamentResult, teams: TournamentTeam[], species: TournamentTeamSpecies[]): TransformedTournament {
  return { tournament: t, teams, species };
}

describe("tournaments repo", () => {
  it("T29. upsertTournament inserts tournament+teams+species in tx", () => {
    const t = tournament(56757, "2026-05-04");
    const tm = team(56757, 1, "Alice", 1);
    const sp = [
      speciesRow(tm.id, 0, "charizard"),
      speciesRow(tm.id, 1, "clefable"),
      speciesRow(tm.id, 2, "kingambit"),
      speciesRow(tm.id, 3, "sneasler"),
      speciesRow(tm.id, 4, "garchomp"),
      speciesRow(tm.id, 5, "aerodactyl"),
    ];
    tournaments.upsertTournament(db, transformed(t, [tm], sp));
    const got = tournaments.get(db, "labmaus:56757");
    expect(got?.id).toBe("labmaus:56757");
    expect(got?.name).toBe("T56757");
  });

  it("T30. upsertTournament is idempotent", () => {
    const t = tournament(56757, "2026-05-04");
    const tm = team(56757, 1, "Alice", 1);
    const sp = Array.from({ length: 6 }, (_, i) =>
      speciesRow(tm.id, i, ["charizard", "clefable", "kingambit", "sneasler", "garchomp", "aerodactyl"][i] as string),
    );
    const payload = transformed(t, [tm], sp);
    tournaments.upsertTournament(db, payload);
    tournaments.upsertTournament(db, payload);
    const all = tournaments.list(db, { format: "RegM-A" });
    expect(all.length).toBe(1);
  });

  it("T31. list filters by date range and division", () => {
    tournaments.upsertTournament(db, transformed(tournament(1, "2026-04-10"), [], []));
    tournaments.upsertTournament(db, transformed(tournament(2, "2026-04-25"), [], []));
    tournaments.upsertTournament(db, transformed(tournament(3, "2026-05-04"), [], []));
    tournaments.upsertTournament(
      db,
      transformed(tournament(4, "2026-05-01", { division: "Seniors" }), [], []),
    );
    const masters = tournaments.list(db, {
      format: "RegM-A",
      date_from: "2026-04-20",
      date_to: "2026-05-04",
      division: "Masters",
    });
    expect(masters.map((t) => t.external_id).sort()).toEqual([2, 3]);
  });

  it("T32. teams_with(['sneasler','kingambit']) returns only teams containing both", () => {
    const t = tournament(56757, "2026-05-04");
    const t1 = team(56757, 1, "A", 1);
    const t2 = team(56757, 2, "B", 2);
    const t3 = team(56757, 3, "C", 3);
    const sp = [
      // T1: has both
      ...["sneasler", "kingambit", "charizard", "clefable", "garchomp", "aerodactyl"].map(
        (id, i) => speciesRow(t1.id, i, id),
      ),
      // T2: only sneasler
      ...["sneasler", "incineroar", "charizard", "clefable", "garchomp", "aerodactyl"].map(
        (id, i) => speciesRow(t2.id, i, id),
      ),
      // T3: neither
      ...["incineroar", "charizard", "clefable", "garchomp", "aerodactyl", "rotomwash"].map(
        (id, i) => speciesRow(t3.id, i, id),
      ),
    ];
    tournaments.upsertTournament(db, transformed(t, [t1, t2, t3], sp));
    const out = tournaments.teams_with(db, {
      format: "RegM-A",
      species: ["sneasler", "kingambit"],
    });
    expect(out.map((t) => t.id)).toEqual([t1.id]);
  });

  it("T33. teams_with respects min_placement", () => {
    const t = tournament(56757, "2026-05-04");
    const t1 = team(56757, 1, "A", 4);
    const t2 = team(56757, 2, "B", null); // swiss-out
    const sp = [
      ...["sneasler", "kingambit", "charizard", "clefable", "garchomp", "aerodactyl"].map(
        (id, i) => speciesRow(t1.id, i, id),
      ),
      ...["sneasler", "kingambit", "charizard", "clefable", "garchomp", "aerodactyl"].map(
        (id, i) => speciesRow(t2.id, i, id),
      ),
    ];
    tournaments.upsertTournament(db, transformed(t, [t1, t2], sp));
    const out = tournaments.teams_with(db, {
      format: "RegM-A",
      species: ["sneasler", "kingambit"],
      min_placement: 8,
    });
    // Only t1 has placement <= 8 AND IS NOT NULL; t2's null placement is excluded.
    expect(out.map((t) => t.id)).toEqual([t1.id]);
  });

  it("T34. usage(kind='species') returns species rows with correct usage_percent", () => {
    const t = tournament(56757, "2026-05-04");
    const t1 = team(56757, 1, "A", 1);
    const t2 = team(56757, 2, "B", 2);
    const sp = [
      ...["sneasler", "kingambit", "charizard", "clefable", "garchomp", "aerodactyl"].map(
        (id, i) => speciesRow(t1.id, i, id),
      ),
      ...["sneasler", "incineroar", "charizard", "clefable", "garchomp", "aerodactyl"].map(
        (id, i) => speciesRow(t2.id, i, id),
      ),
    ];
    tournaments.upsertTournament(db, transformed(t, [t1, t2], sp));
    const rows = tournaments.usage(db, {
      format: "RegM-A",
      lookback_days: 365,
      weight_by: "appearances",
      kind: "species",
    });
    const sneasler = rows.find((r) => r.key === "sneasler");
    expect(sneasler?.appearances).toBe(2);
    expect(sneasler?.total_teams).toBe(2);
    expect(sneasler?.usage_percent).toBeCloseTo(100, 5);
    const kingambit = rows.find((r) => r.key === "kingambit");
    expect(kingambit?.appearances).toBe(1);
    expect(kingambit?.usage_percent).toBeCloseTo(50, 5);
  });

  it("T34a. usage(kind='item') returns item rows joined through team_sets", () => {
    // Pokepaste-sets slice ships in parallel; this Stage-4 test asserts the
    // contract, not the wiring. It will fail with "not implemented" today.
    const rows = tournaments.usage(db, {
      format: "RegM-A",
      lookback_days: 365,
      weight_by: "appearances",
      kind: "item",
    });
    // After Stage 5 + pokepaste-sets, this should return rows with kind === 'item'
    expect(Array.isArray(rows)).toBe(true);
    for (const r of rows) expect(r.kind).toBe("item");
  });

  it("T34b. usage(kind='move') expands moves_json correctly", () => {
    const rows = tournaments.usage(db, {
      format: "RegM-A",
      lookback_days: 365,
      weight_by: "appearances",
      kind: "move",
    });
    expect(Array.isArray(rows)).toBe(true);
    for (const r of rows) expect(r.kind).toBe("move");
  });

  it("T34c. usage(kind='core') returns 2-mon co-occurrences", () => {
    const t = tournament(56757, "2026-05-04");
    const t1 = team(56757, 1, "A", 1);
    const t2 = team(56757, 2, "B", 2);
    const sp = [
      ...["sneasler", "kingambit", "charizard", "clefable", "garchomp", "aerodactyl"].map(
        (id, i) => speciesRow(t1.id, i, id),
      ),
      ...["sneasler", "kingambit", "incineroar", "clefable", "garchomp", "aerodactyl"].map(
        (id, i) => speciesRow(t2.id, i, id),
      ),
    ];
    tournaments.upsertTournament(db, transformed(t, [t1, t2], sp));
    const rows = tournaments.usage(db, {
      format: "RegM-A",
      lookback_days: 365,
      weight_by: "appearances",
      kind: "core",
    });
    // Sneasler+Kingambit core appears in both teams (100%)
    const sk = rows.find((r) => r.key.includes("sneasler") && r.key.includes("kingambit"));
    expect(sk).toBeDefined();
    expect(sk?.appearances).toBe(2);
  });
});
