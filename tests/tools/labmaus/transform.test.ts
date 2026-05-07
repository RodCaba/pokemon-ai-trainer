/**
 * Tests T14–T18 for `transformTournament`.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { transformTournament } from "../../../src/tools/labmaus/transform";
import { LabmausRawTournamentSchema } from "../../../src/schemas/tournament";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "..", "..", "..", "fixtures", "labmaus");
const FETCHED_AT = "2026-05-04T19:32:11Z";

function loadRaw(file: string): ReturnType<typeof LabmausRawTournamentSchema.parse> {
  const raw = JSON.parse(readFileSync(join(FIX, file), "utf8"));
  return LabmausRawTournamentSchema.parse(raw);
}

describe("transformTournament", () => {
  it("T14. happy path on fixture 56757", () => {
    const raw = loadRaw("2026-05-04__tournament_56757.json");
    const out = transformTournament(raw, FETCHED_AT);
    expect(out.tournament.id).toBe("labmaus:56757");
    expect(out.tournament.external_id).toBe(56757);
    expect(out.tournament.format).toBe("RegM-A");
    expect(out.tournament.source.fetched_at).toBe(FETCHED_AT);
    expect(out.teams.length).toBe(raw.teams.length);
    expect(out.species.length).toBe(raw.teams.length * 6);
  });

  it("T15. transform strips any tera-named field defense-in-depth", () => {
    const raw = loadRaw("2026-05-04__tournament_56757.json");
    const out = transformTournament(raw, FETCHED_AT);
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
    const out = transformTournament(raw, FETCHED_AT);
    const nullPlacements = out.teams.filter((t) => t.placement === null).length;
    expect(nullPlacements).toBeGreaterThan(0);
  });

  it("T17. transform generates player_key = trim(lower(player))", () => {
    const raw = loadRaw("2026-05-04__tournament_56757.json");
    const out = transformTournament(raw, FETCHED_AT);
    for (const t of out.teams) {
      expect(t.player_key).toBe(t.player.trim().toLowerCase());
    }
  });

  it("T18. transform produces 6 species rows per team in slot order with labmaus dex ids", () => {
    const raw = loadRaw("2026-05-04__tournament_56757.json");
    const out = transformTournament(raw, FETCHED_AT);
    // group species by team_id, assert slot 0..5 present in order, and each
    // row carries a non-empty labmaus_id.
    const grouped = new Map<string, number[]>();
    for (const s of out.species) {
      const arr = grouped.get(s.team_id) ?? [];
      arr.push(s.slot);
      grouped.set(s.team_id, arr);
      expect(typeof s.labmaus_id).toBe("string");
      expect(s.labmaus_id.length).toBeGreaterThan(0);
    }
    expect(grouped.size).toBe(out.teams.length);
    for (const slots of grouped.values()) {
      expect(slots).toEqual([0, 1, 2, 3, 4, 5]);
    }
  });
});
