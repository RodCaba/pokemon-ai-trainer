/**
 * USR-T23..T24 — `parsePokepasteToTeam` adapter. Stage-4 red.
 *
 * USR-T23: round-trip on a known-good fixture (clean Showdown export).
 * USR-T24: malformed text returns parse_failed (does NOT throw — auto-persist).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePokepasteToTeam } from "../../src/data/user-teams/parse-pokepaste";
import type { ParseDeps } from "../../src/data/user-teams/parse-pokepaste";
import type { Db } from "../../src/db/open";

function fakeDeps(): ParseDeps {
  const has = (set: Set<string>) => (_d: Db, n: string, _f: "RegM-A") => set.has(n);
  const knownSpecies = new Set([
    "Charizard-Mega-Y",
    "Clefable",
    "Kingambit",
    "Sneasler",
    "Garchomp",
  ]);
  const knownItems = new Set([
    "Charizardite Y",
    "Sitrus Berry",
    "Black Glasses",
    "White Herb",
    "Choice Scarf",
  ]);
  const knownAbilities = new Set([
    "Blaze",
    "Unaware",
    "Defiant",
    "Unburden",
    "Rough Skin",
  ]);
  const knownMoves = new Set([
    "Heat Wave",
    "Weather Ball",
    "Solar Beam",
    "Protect",
    "Moonblast",
    "Icy Wind",
    "Follow Me",
    "Sucker Punch",
    "Kowtow Cleave",
    "Swords Dance",
    "Fake Out",
    "Close Combat",
    "Gunk Shot",
    "Earthquake",
    "Dragon Claw",
    "Stone Edge",
  ]);
  const db = {} as Db;
  return {
    db,
    transform: {
      db,
      rosterRepo: {
        has: has(knownSpecies),
        get: (_d, n) => (knownSpecies.has(n) ? { id: n.toLowerCase().replace(/-/g, "") } : null),
      },
      itemsRepo: { has: has(knownItems) },
      abilitiesRepo: { has: has(knownAbilities) },
      movesRepo: { has: has(knownMoves) },
    },
  };
}

describe("parsePokepasteToTeam (USR-T23..T24)", () => {
  it("USR-T23. round-trips a known-good fixture into a partial UserTeam", () => {
    const fx = readFileSync(
      join(__dirname, "../../fixtures/pokepaste/2026-05-04__7205bf28f85d1e79.txt"),
      "utf8",
    );
    const r = parsePokepasteToTeam(fx, fakeDeps());
    // Per the fixture, 6 sets are present (Charizard, Clefable, Kingambit,
    // Sneasler, Garchomp, ...); all six slots populated with non-null
    // species_id.
    expect(r.parse_errors).toEqual([]);
    expect(r.team.sets).toHaveLength(6);
    const filled = r.team.sets.filter((s) => s.species_id !== null);
    expect(filled.length).toBeGreaterThanOrEqual(5);
    // Origin must be 'paste' and origin_payload must capture the raw text
    // verbatim per flow §2.1.
    expect(r.team.origin).toBe("paste");
    expect(r.team.origin_payload).toBe(fx);
  });

  it("USR-T24. malformed text returns parse_failed (does NOT throw — auto-persist)", () => {
    const r = parsePokepasteToTeam("garbage text not a pokepaste", fakeDeps());
    expect(r.parse_errors.length).toBeGreaterThanOrEqual(1);
    expect(r.parse_errors[0]?.code).toBe("parse_failed");
    // The team is still returned (six empty slots) so the repo can persist
    // it as a draft.
    expect(r.team.sets).toHaveLength(6);
    expect(r.team.origin).toBe("paste");
  });
});
