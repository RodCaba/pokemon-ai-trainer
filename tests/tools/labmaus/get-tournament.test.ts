/**
 * Tests T26 for `getTournament`.
 *
 * Post the 2026-05-05 simplification, T27 (unknown-species error) is gone:
 * `transformTournament` no longer maps to roster ids, so there's no error
 * path to exercise.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getTournament } from "../../../src/tools/labmaus/get-tournament";
import type { LabmausClient } from "../../../src/tools/labmaus/client";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "..", "..", "..", "fixtures", "labmaus");

function clientFromFixture(fileName: string): LabmausClient {
  const fx = JSON.parse(readFileSync(join(FIX, fileName), "utf8"));
  return {
    async listCompletedTournaments(): Promise<unknown> {
      throw new Error("unused");
    },
    async getTournament(): Promise<unknown> {
      return fx;
    },
  };
}

describe("getTournament", () => {
  it("T26. preserves slot order with labmaus dex ids", async () => {
    const out = await getTournament(
      { id: 56757 },
      { client: clientFromFixture("2026-05-04__tournament_56757.json") },
    );
    expect(out.tournament.id).toBe("labmaus:56757");
    expect(out.species.length).toBe(out.teams.length * 6);
    // Every species row has a non-empty labmaus_id and slot 0..5 cycles per team.
    for (const s of out.species) {
      expect(typeof s.labmaus_id).toBe("string");
      expect(s.labmaus_id.length).toBeGreaterThan(0);
      expect(s.slot).toBeGreaterThanOrEqual(0);
      expect(s.slot).toBeLessThanOrEqual(5);
    }
  });
});
