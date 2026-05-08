/**
 * USR-T25..T27 — `duplicateFromTournament`. Stage-4 red.
 *
 * USR-T25: clones team_sets when present (full set fields populated).
 * USR-T26: falls back to tournament_team_species when team_sets absent.
 * USR-T27: throws UserTeamNotFoundError on bad ttid.
 */

import { describe, expect, it, afterEach } from "vitest";
import { duplicateFromTournament } from "../../src/data/user-teams/duplicate-from-tournament";
import { UserTeamNotFoundError } from "../../src/schemas/errors";
import { open, type Db } from "../../src/db/open";

function seedTournamentAndTeam(db: Db): void {
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
  // Seed species so FKs work for team_sets.
  db.$client
    .prepare(
      `INSERT INTO species (id, display_name, form_id, is_mega, types, weight_kg, aliases, movepool, source_json)
         VALUES ('garchomp','Garchomp',NULL,0,'["Dragon","Ground"]',95.0,'[]','[]','{}')`,
    )
    .run();
}

let opened: Db | null = null;
afterEach(() => {
  if (opened) {
    try { opened.$client.close(); } catch { /* noop */ }
    opened = null;
  }
});

describe("duplicateFromTournament (USR-T25..T27)", () => {
  it("USR-T25. clones team_sets rows when present, populates source FK", () => {
    const db = open(":memory:");
    opened = db;
    seedTournamentAndTeam(db);
    db.$client
      .prepare(
        `INSERT INTO team_sets
           (tournament_team_id, slot, species_roster_id, item, ability, level,
            moves_json, sps_json, ivs_json, nature, completeness,
            source_site, source_paste_id, source_url, fetched_at)
         VALUES ('labmaus:1:1', 0, 'garchomp', 'Choice Scarf', 'Rough Skin', 50,
                 '["Earthquake","Protect"]', NULL, NULL, 'Adamant', 'minimal',
                 'pokepaste', 'abc', 'https://pokepast.es/abc', '2026-05-04T00:00:00Z')`,
      )
      .run();

    const r = duplicateFromTournament(db, "labmaus:1:1");
    expect(r.source_tournament_team_id).toBe("labmaus:1:1");
    expect(r.team.origin).toBe("duplicated_from_tournament");
    expect(r.team.sets).toHaveLength(6);
    const slot0 = r.team.sets[0]!;
    expect(slot0.species_id).toBe("garchomp");
    expect(slot0.item_id).toBe("Choice Scarf");
    expect(slot0.ability_id).toBe("Rough Skin");
    expect(slot0.move_1_id).toBe("Earthquake");
  });

  it("USR-T26. falls back to tournament_team_species when team_sets absent (species_id only)", () => {
    const db = open(":memory:");
    opened = db;
    seedTournamentAndTeam(db);
    // Seed labmaus species map row only — no team_sets.
    db.$client
      .prepare(
        `INSERT INTO tournament_team_species (team_id, slot, labmaus_id) VALUES (?, ?, ?)`,
      )
      .run("labmaus:1:1", 0, "lbm:garchomp");

    const r = duplicateFromTournament(db, "labmaus:1:1");
    const slot0 = r.team.sets[0]!;
    // Falls back to species id only — items/abilities/moves all null.
    expect(slot0.species_id).not.toBeNull();
    expect(slot0.item_id).toBeNull();
    expect(slot0.ability_id).toBeNull();
    expect(slot0.move_1_id).toBeNull();
  });

  it("USR-T27. throws UserTeamNotFoundError when tournament_team_id doesn't exist", () => {
    const db = open(":memory:");
    opened = db;
    expect(() => duplicateFromTournament(db, "labmaus:999:999")).toThrow(
      UserTeamNotFoundError,
    );
  });
});
