/**
 * Tests T38–T39 for the aggregate cross-check.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as tournaments from "../../src/db/tournaments";
import { transformTournament } from "../../src/tools/labmaus/transform";
import { LabmausRawTournamentSchema } from "../../src/schemas/tournament";
import { teamSets } from "../../src/db/drizzle-schema";
import type { Db } from "../../src/db/open";
import { closeIfOpen, seedLabmausDb } from "./labmaus-fixtures";
import { compareWithinTolerance } from "../../scripts/data/ingest-labmaus";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "..", "..", "fixtures", "labmaus");
const FETCHED_AT = "2026-05-04T19:32:11Z";

let db: Db;
beforeEach(() => {
  db = seedLabmausDb();
});
afterEach(() => {
  closeIfOpen(db);
});

interface TheirRow { id?: string; name?: string; usage?: number; usage_percent?: number }

function loadFixtureWithTheirAggregates(file: string): { raw: ReturnType<typeof LabmausRawTournamentSchema.parse>; theirs: TheirRow[] } {
  const j = JSON.parse(readFileSync(join(FIX, file), "utf8")) as { pokemon?: TheirRow[] };
  const raw = LabmausRawTournamentSchema.parse(j);
  return { raw, theirs: j.pokemon ?? [] };
}

/**
 * Seed minimal `team_sets` rows from the per-team labmaus dex ids, mapping
 * each to a roster id via the fixture's `team_names` (with the same
 * normalization the dropped alias seed used). This recreates a believable
 * post-pokepaste-ingest state so `recomputeAggregatesForTournament` has
 * something to read.
 */
function seedTeamSetsFromRaw(
  db: Db,
  raw: ReturnType<typeof LabmausRawTournamentSchema.parse>,
  fetchedAt: string,
): void {
  function nameToRosterId(name: string): string {
    return name
      .replace(/♂/g, "m")
      .replace(/♀/g, "f")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }
  for (const rt of raw.teams) {
    const teamId = `labmaus:${raw.overview.id}:${rt.id}`;
    const names = rt.team_names.split(",").map((s) => s.trim());
    for (let slot = 0; slot < 6; slot++) {
      const rosterId = nameToRosterId(names[slot] ?? "");
      if (!rosterId) continue;
      db.insert(teamSets)
        .values({
          tournamentTeamId: teamId,
          slot,
          speciesRosterId: rosterId,
          item: null,
          ability: null,
          level: 50,
          movesJson: JSON.stringify(["tackle"]),
          spsJson: null,
          ivsJson: null,
          nature: null,
          completeness: "skeleton",
          sourceSite: "pokepaste",
          sourcePasteId: "fixture",
          sourceUrl: "https://pokepast.es/fixture",
          fetchedAt,
        })
        .run();
    }
  }
}

describe("tournaments-aggregate-cross-check", () => {
  it("T38. recomputed species ranking is non-empty once team_sets is seeded for fixture 56757", () => {
    const { raw } = loadFixtureWithTheirAggregates("2026-05-04__tournament_56757.json");
    const out = transformTournament(raw, FETCHED_AT);
    tournaments.upsertTournament(db, out);

    // Without team_sets, recompute returns []: canonical attribution lives on
    // team_sets (post-simplification).
    expect(tournaments.recomputeAggregatesForTournament(db, "labmaus:56757")).toEqual([]);

    seedTeamSetsFromRaw(db, raw, FETCHED_AT);
    const ours = tournaments.recomputeAggregatesForTournament(db, "labmaus:56757");
    expect(ours.length).toBeGreaterThan(0);
    for (const r of ours) {
      expect(r.kind).toBe("species");
      expect(typeof r.usage_percent).toBe("number");
    }
  });

  it("T38a. compareWithinTolerance returns empty when all keys are within tolerance", () => {
    const ours = [{ key: "sneasler", usage_percent: 50.0 }, { key: "kingambit", usage_percent: 25.0 }];
    const theirs = [{ key: "sneasler", usage_percent: 50.04 }, { key: "kingambit", usage_percent: 25.0 }];
    expect(compareWithinTolerance(ours, theirs)).toEqual([]);
  });

  it("T39a. compareWithinTolerance flags out-of-tolerance diffs", () => {
    const ours = [{ key: "sneasler", usage_percent: 50.0 }];
    const theirs = [{ key: "sneasler", usage_percent: 60.0 }];
    const diffs = compareWithinTolerance(ours, theirs);
    expect(diffs.length).toBe(1);
    expect(diffs[0]?.key).toBe("sneasler");
    expect(diffs[0]?.delta).toBeGreaterThan(0.05);
  });

  it("T39. cross-check recompute path doesn't throw on a small fixture", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const { raw } = loadFixtureWithTheirAggregates("2026-05-04__tournament_56757.json");
      const out = transformTournament(raw, FETCHED_AT);
      tournaments.upsertTournament(db, out);
      seedTeamSetsFromRaw(db, raw, FETCHED_AT);
      const ours = tournaments.recomputeAggregatesForTournament(db, "labmaus:56757");
      expect(Array.isArray(ours)).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });
});
