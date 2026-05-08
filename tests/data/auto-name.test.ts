/**
 * USR-T28..T30 — `autoGenerateName`. Stage-4 red.
 *
 * USR-T28: 1 / 4 / 6 species patterns; "Untitled team" for empty (Q7).
 * USR-T29: date-prefix on collision regardless of archived status (Q6).
 * USR-T30: user-provided override (skipped — covered at repo layer); we
 *   assert that the autogen function alone is deterministic.
 */

import { describe, expect, it, afterEach } from "vitest";
import { autoGenerateName } from "../../src/data/user-teams/auto-name";
import { open, type Db } from "../../src/db/open";
import type { UserSet, UserTeam } from "../../src/schemas/user-teams";

function emptySet(slot: number): UserSet {
  return {
    slot,
    species_id: null,
    nickname: null,
    item_id: null,
    ability_id: null,
    nature: null,
    hp_sps: 0, atk_sps: 0, def_sps: 0, spa_sps: 0, spd_sps: 0, spe_sps: 0,
    move_1_id: null, move_2_id: null, move_3_id: null, move_4_id: null,
    notes: null,
  };
}

function teamWithSpecies(ids: Array<string | null>): Pick<UserTeam, "sets"> {
  const sets: UserSet[] = [];
  for (let s = 0; s < 6; s++) {
    sets.push({ ...emptySet(s), species_id: ids[s] ?? null });
  }
  return { sets: sets as UserTeam["sets"] };
}

function seedSpeciesRows(db: Db): void {
  const rows = [
    ["sneasler", "Sneasler"],
    ["garchomp", "Garchomp"],
    ["clefable", "Clefable"],
    ["aerodactyl", "Aerodactyl"],
    ["incineroar", "Incineroar"],
    ["kingambit", "Kingambit"],
  ];
  for (const [id, display] of rows) {
    db.$client
      .prepare(
        `INSERT INTO species (id, display_name, form_id, is_mega, types, weight_kg, aliases, movepool, source_json)
           VALUES (?, ?, NULL, 0, '["Normal"]', 50.0, '[]', '[]', '{}')`,
      )
      .run(id, display);
  }
}

let opened: Db | null = null;
afterEach(() => {
  if (opened) { try { opened.$client.close(); } catch { /* noop */ } opened = null; }
});

describe("autoGenerateName (USR-T28..T30)", () => {
  it("USR-T28. joins 1/4/6 species correctly; empty → 'Untitled team'", () => {
    const db = open(":memory:"); opened = db;
    seedSpeciesRows(db);
    const today = (): string => "2026-05-08";

    expect(autoGenerateName(teamWithSpecies(["sneasler"]), db, today)).toBe(
      "Sneasler",
    );

    expect(
      autoGenerateName(
        teamWithSpecies(["sneasler", "garchomp", "clefable", "aerodactyl"]),
        db,
        today,
      ),
    ).toBe("Sneasler-Garchomp-Clefable-Aerodactyl");

    expect(
      autoGenerateName(
        teamWithSpecies([
          "sneasler",
          "garchomp",
          "clefable",
          "aerodactyl",
          "incineroar",
          "kingambit",
        ]),
        db,
        today,
      ),
    ).toBe("Sneasler-Garchomp-Clefable-Aerodactyl + 2");

    // Empty team → "Untitled team" (Stage-2 Q7).
    expect(autoGenerateName(teamWithSpecies([]), db, today)).toBe("Untitled team");
  });

  it("USR-T29. prefixes date on collision regardless of archived status (Q6)", () => {
    const db = open(":memory:"); opened = db;
    seedSpeciesRows(db);
    const today = (): string => "2026-05-08";

    // Pre-seed an existing user_team row with the auto-name, status=archived.
    db.$client
      .prepare(
        `INSERT INTO user_teams
           (id, name, description, win_condition, status, origin,
            origin_payload, source_tournament_team_id, validation_errors,
            validation_warnings, schema_version, created_at, updated_at)
         VALUES ('01HXXXXXXXXXXXXXXXXXXXXXX1', 'Sneasler', NULL, NULL,
                 'archived', 'builder', NULL, NULL, '[]', '[]', 1,
                 '2026-04-01T00:00:00Z', '2026-04-01T00:00:00Z')`,
      )
      .run();

    // Even though the previous team is archived, the date-prefix must apply (Q6).
    const name = autoGenerateName(teamWithSpecies(["sneasler"]), db, today);
    expect(name).toBe("2026-05-08 Sneasler");
  });

  it("USR-T30. is deterministic and does NOT mutate the input team", () => {
    const db = open(":memory:"); opened = db;
    seedSpeciesRows(db);
    const today = (): string => "2026-05-08";
    const t = teamWithSpecies(["sneasler", "garchomp"]);
    const before = JSON.stringify(t);
    const a = autoGenerateName(t, db, today);
    const b = autoGenerateName(t, db, today);
    expect(a).toBe(b);
    expect(JSON.stringify(t)).toBe(before);
  });
});
