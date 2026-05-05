/**
 * Tests T10–T13 for `labmausIdToRosterId` / `labmausIdToRosterIdOrThrow`.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  labmausIdToRosterId,
  labmausIdToRosterIdOrThrow,
  type SpeciesMapDeps,
} from "../../../src/tools/labmaus/species-map";
import * as aliasRepo from "../../../src/db/species-alias-labmaus";
import { LabmausUnknownSpeciesError } from "../../../src/schemas/errors";
import type { Db } from "../../../src/db/open";
import {
  ALIAS_SEED,
  closeIfOpen,
  seedLabmausDb,
} from "../../db/labmaus-fixtures";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "..", "..", "..", "fixtures", "labmaus");

function deps(db: Db): SpeciesMapDeps {
  return { db, aliasRepo };
}

let db: Db;
afterEach(() => {
  closeIfOpen(db);
});

describe("species-map", () => {
  it("T10. labmausIdToRosterId returns null for unknown id", () => {
    db = seedLabmausDb({ seedAliases: false });
    expect(labmausIdToRosterId("038-z", null, deps(db))).toBeNull();
  });

  it("T11. labmausIdToRosterIdOrThrow throws LabmausUnknownSpeciesError with offending id", () => {
    db = seedLabmausDb({ seedAliases: false });
    let thrown: unknown;
    try {
      labmausIdToRosterIdOrThrow("038-z", null, deps(db));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(LabmausUnknownSpeciesError);
    const err = thrown as LabmausUnknownSpeciesError;
    expect(err.message).toContain("038-z");
  });

  it("T12. every labmaus_id in fixtures resolves with the seeded alias table", () => {
    db = seedLabmausDb(); // full ALIAS_SEED
    // Read fixture 56757; collect unique ids; assert each maps in the seeded subset.
    const raw = JSON.parse(
      readFileSync(join(FIX, "2026-05-04__tournament_56757.json"), "utf8"),
    ) as { teams: Array<{ team: string[] }> };
    const seedIds = new Set(ALIAS_SEED.map((a) => a.labmausId));
    // For Stage 4 we limit the assertion to the subset of fixture ids that exist
    // in our small ALIAS_SEED — Stage 5 wires the full data/labmaus/species-alias-seed.json.
    let resolved = 0;
    for (const t of raw.teams) {
      for (const id of t.team) {
        if (!seedIds.has(id)) continue;
        const r = labmausIdToRosterId(id, null, deps(db));
        expect(r).not.toBeNull();
        resolved++;
      }
    }
    expect(resolved).toBeGreaterThan(0);
  });

  it("T13. Basculegion ♂ literal (dex 902) maps to basculegionm", () => {
    db = seedLabmausDb();
    expect(labmausIdToRosterId("902", "Basculegion ♂", deps(db))).toBe("basculegionm");
  });

  it("T13a. displayName fallback resolves when alias-id lookup misses", () => {
    // Seed roster but skip aliases. Display-name path should still resolve via roster.get.
    db = seedLabmausDb({ seedAliases: false });
    // Garchomp has roster_id "garchomp" and display "Garchomp" in the seed.
    const out = labmausIdToRosterId("zzz-unknown", "Garchomp", deps(db));
    expect(out).toBe("garchomp");
  });
});
