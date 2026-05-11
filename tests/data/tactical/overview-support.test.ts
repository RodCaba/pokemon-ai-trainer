/**
 * Stage 4 — RED tests for the overview-level support pillar wiring (OV1–OV3).
 * OV1 (regression: existing overview tests stay green) is enforced by NOT
 * editing `overview.test.ts`. OV2 + OV3 here.
 *
 * Module under test: `src/data/tactical/overview.ts` — `buildOverview` now
 * calls a single role-classifier pass (Q6 binding: build once in pillars/
 * orchestrator, thread through), wires `pillars.support`, and bumps
 * `schema_version` to 2.
 */

import { describe, expect, it } from "vitest";
import { buildOverview } from "../../../src/data/tactical/overview";
import { open } from "../../../src/db/open";

// Reuse the seed pattern from the existing overview test.
function makeDeps(db: ReturnType<typeof open>): Parameters<typeof buildOverview>[1] {
  return {
    db,
    calc: { calc: () => ({}) },
    speed: {},
    synergy: { db },
    now: () => new Date("2026-05-09T00:00:00Z"),
  };
}

function seedSavedTeam(db: ReturnType<typeof open>, id: string): void {
  db.$client
    .prepare(
      `INSERT INTO user_teams (id, name, description, win_condition, status, origin,
       origin_payload, source_tournament_team_id, validation_errors, validation_warnings,
       schema_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(id, "T", "", "", "saved", "builder", null, null, "[]", "[]",
      "2026-05-09T00:00:00Z", "2026-05-09T00:00:00Z");
}

describe("buildOverview support pillar wiring (OV2..OV3)", () => {
  it("OV2. output pillars.support is present + valid PillarScore; schema_version=3 post-Stage-B", () => {
    const db = open(":memory:");
    try {
      // Reuse the synthetic-team fixture id from overview.ts — it skips
      // the 6-set seeding and exercises the `syntheticTeam` defensive path
      // (which buildRoleAssignments also handles).
      const out = buildOverview("01H000000000000000000000T0", makeDeps(db));
      expect(out.schema_version).toBe(4);
      expect(out.pillars.support).toBeDefined();
      expect(out.pillars.support.pillar).toBe("support");
      expect(typeof out.pillars.support.score).toBe("number");
      expect(["Weak", "OK", "Good", "Strong"]).toContain(out.pillars.support.tier);
    } finally {
      db.$client.close();
    }
  });

  it("OV3. at least one scenario reports support_lift !== 0 on the ArchaEye-shape fixture", () => {
    // Build a 6-set team where the role chain triggers support_lift.
    const db = open(":memory:");
    try {
      const id = "01H000000000000000000000AE";
      seedSavedTeam(db, id);
      // Insert sets that trigger setter+payoff role chain.
      const insertSet = (slot: number, species: string, item: string | null, ability: string | null, moves: string[]): void => {
        db.$client
          .prepare(
            `INSERT INTO user_team_sets (user_team_id, slot, species_id, nickname, item_id, ability_id,
             nature, hp_sps, atk_sps, def_sps, spa_sps, spd_sps, spe_sps,
             move_1_id, move_2_id, move_3_id, move_4_id, notes)
             VALUES (?, ?, ?, NULL, ?, ?, NULL, 0, 0, 0, 0, 0, 0, ?, ?, ?, ?, NULL)`,
          )
          .run(id, slot, species, item, ability,
            moves[0] ?? null, moves[1] ?? null, moves[2] ?? null, moves[3] ?? null);
      };
      insertSet(0, "sableye", "Roseli Berry", "Prankster",
        ["Reflect", "Light Screen", "Quash", "Rain Dance"]);
      insertSet(1, "archaludon", "Leftovers", "Stamina",
        ["Electro Shot", "Dragon Pulse", "Flash Cannon", "Protect"]);
      insertSet(2, "basculegion", "Choice Scarf", "Adaptability",
        ["Wave Crash", "Flip Turn", "Aqua Jet", "Last Respects"]);
      insertSet(3, "pelipper", "Sitrus Berry", "Drizzle",
        ["Wide Guard", "Weather Ball", "Hurricane", "Tailwind"]);
      insertSet(4, "sinistcha", "Sitrus Berry", "Hospitality",
        ["Matcha Gotcha", "Life Dew", "Trick Room", "Rage Powder"]);
      insertSet(5, "dragonite", "Dragoninite", "Inner Focus",
        ["Draco Meteor", "Flamethrower", "Hurricane", "Tailwind"]);

      const out = buildOverview(id, makeDeps(db));
      // Stage B (Q9 §17): support_lift moved from the scenario level to
      // the lead-phase level. Look for the lift on `phases[0]`.
      const anyLift = out.scenarios.some((s) => {
        const lead = (s as { phases?: Array<{ support_lift?: number }> }).phases?.[0];
        return typeof lead?.support_lift === "number" && lead.support_lift !== 0;
      });
      expect(anyLift).toBe(true);
    } finally {
      db.$client.close();
    }
  });
});
