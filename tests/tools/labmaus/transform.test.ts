/**
 * Tests T14–T18 for `transformTournament`.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { transformTournament } from "../../../src/tools/labmaus/transform";
import { LabmausRawTournamentSchema } from "../../../src/schemas/tournament";
import type { SpeciesMapDeps } from "../../../src/tools/labmaus/species-map";
import * as aliasRepo from "../../../src/db/species-alias-labmaus";
import type { Db } from "../../../src/db/open";
import { closeIfOpen, seedLabmausDb } from "../../db/labmaus-fixtures";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "..", "..", "..", "fixtures", "labmaus");
const FETCHED_AT = "2026-05-04T19:32:11Z";

let db: Db;
beforeEach(() => {
  db = seedLabmausDb();
});
afterEach(() => {
  closeIfOpen(db);
});

function deps(d: Db): SpeciesMapDeps {
  return { db: d, aliasRepo };
}

function loadRaw(file: string): ReturnType<typeof LabmausRawTournamentSchema.parse> {
  const raw = JSON.parse(readFileSync(join(FIX, file), "utf8"));
  return LabmausRawTournamentSchema.parse(raw);
}

describe("transformTournament", () => {
  it("T14. happy path on fixture 56757", () => {
    const raw = loadRaw("2026-05-04__tournament_56757.json");
    const out = transformTournament(raw, FETCHED_AT, deps(db));
    expect(out.tournament.id).toBe("labmaus:56757");
    expect(out.tournament.external_id).toBe(56757);
    expect(out.tournament.format).toBe("RegM-A");
    expect(out.tournament.source.fetched_at).toBe(FETCHED_AT);
    expect(out.teams.length).toBe(raw.teams.length);
    expect(out.species.length).toBe(raw.teams.length * 6);
  });

  it("T15. transform strips any tera-named field defense-in-depth", () => {
    const raw = loadRaw("2026-05-04__tournament_56757.json");
    const out = transformTournament(raw, FETCHED_AT, deps(db));
    // Walk every produced object and assert no key contains "tera"
    const objects: unknown[] = [out.tournament, ...out.teams, ...out.species];
    for (const o of objects) {
      if (o && typeof o === "object") {
        for (const k of Object.keys(o)) {
          expect(/tera/i.test(k)).toBe(false);
        }
      }
    }
  });

  it("T16. transform preserves placement: null for swiss-out rows", () => {
    const raw = loadRaw("2026-05-04__tournament_56588.json");
    const out = transformTournament(raw, FETCHED_AT, deps(db));
    const nullPlacements = out.teams.filter((t) => t.placement === null).length;
    expect(nullPlacements).toBeGreaterThan(0);
  });

  it("T17. transform generates player_key = trim(lower(player))", () => {
    const raw = loadRaw("2026-05-04__tournament_56757.json");
    const out = transformTournament(raw, FETCHED_AT, deps(db));
    for (const t of out.teams) {
      expect(t.player_key).toBe(t.player.trim().toLowerCase());
    }
  });

  it("T18. transform produces 6 species rows per team in slot order", () => {
    const raw = loadRaw("2026-05-04__tournament_56757.json");
    const out = transformTournament(raw, FETCHED_AT, deps(db));
    // group species by team_id, assert slot 0..5 present in order
    const grouped = new Map<string, number[]>();
    for (const s of out.species) {
      const arr = grouped.get(s.team_id) ?? [];
      arr.push(s.slot);
      grouped.set(s.team_id, arr);
    }
    expect(grouped.size).toBe(out.teams.length);
    for (const slots of grouped.values()) {
      expect(slots).toEqual([0, 1, 2, 3, 4, 5]);
    }
  });
});
