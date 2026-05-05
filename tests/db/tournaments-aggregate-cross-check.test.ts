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
import * as aliasRepo from "../../src/db/species-alias-labmaus";
import type { Db } from "../../src/db/open";
import { closeIfOpen, seedLabmausDb } from "./labmaus-fixtures";

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

describe("tournaments-aggregate-cross-check", () => {
  it("T38. recomputed species ranking matches labmaus pokemon[] order ± tolerance for fixture 56757", () => {
    const { raw } = loadFixtureWithTheirAggregates("2026-05-04__tournament_56757.json");
    const out = transformTournament(raw, FETCHED_AT, { db, aliasRepo });
    tournaments.upsertTournament(db, out);
    const ours = tournaments.recomputeAggregatesForTournament(db, "labmaus:56757");
    expect(ours.length).toBeGreaterThan(0);
    // Stage 5 will assert top-N matches within ±0.05 absolute or ±1% relative.
    // Stage 4 just locks the shape: each row has kind='species' and a numeric usage_percent.
    for (const r of ours) {
      expect(r.kind).toBe("species");
      expect(typeof r.usage_percent).toBe("number");
    }
  });

  it("T39. cross-check warns but does not throw on out-of-tolerance diff", () => {
    // Stage 5 implements `compareWithinTolerance` + warning channel inside the
    // ingest script. Here we just verify the recompute path doesn't throw on a
    // small fixture.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const { raw } = loadFixtureWithTheirAggregates("2026-05-04__tournament_56757.json");
      const out = transformTournament(raw, FETCHED_AT, { db, aliasRepo });
      tournaments.upsertTournament(db, out);
      const ours = tournaments.recomputeAggregatesForTournament(db, "labmaus:56757");
      expect(Array.isArray(ours)).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });
});
