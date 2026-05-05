/**
 * Tests T26–T27 for `getTournament`.
 */

import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getTournament } from "../../../src/tools/labmaus/get-tournament";
import type { LabmausClient } from "../../../src/tools/labmaus/client";
import type { SpeciesMapDeps } from "../../../src/tools/labmaus/species-map";
import * as aliasRepo from "../../../src/db/species-alias-labmaus";
import { LabmausUnknownSpeciesError } from "../../../src/schemas/errors";
import type { Db } from "../../../src/db/open";
import { ALIAS_SEED, closeIfOpen, seedLabmausDb } from "../../db/labmaus-fixtures";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "..", "..", "..", "fixtures", "labmaus");

let db: Db;
afterEach(() => {
  closeIfOpen(db);
});

function clientFromFixture(fileName: string): LabmausClient {
  const fx = JSON.parse(readFileSync(join(FIX, fileName), "utf8"));
  return {
    async listCompletedTournaments(): Promise<unknown> {
      throw new Error("unused");
    },
    async getTournament(): Promise<unknown> {
      return fx;
    },
    nextAllowedAt(): number {
      return 0;
    },
  };
}

describe("getTournament", () => {
  it("T26. returns full TournamentDetail with mapped species", async () => {
    db = seedLabmausDb();
    const speciesMap: SpeciesMapDeps = { db, aliasRepo };
    const out = await getTournament(
      { id: 56757 },
      { client: clientFromFixture("2026-05-04__tournament_56757.json"), speciesMap },
    );
    expect(out.tournament.id).toBe("labmaus:56757");
    expect(out.species.length).toBe(out.teams.length * 6);
    // Every roster_id resolves through our seeded set
    const known = new Set(ALIAS_SEED.map((a) => a.rosterId));
    const seenSomeMapped = out.species.some((s) => known.has(s.roster_id));
    expect(seenSomeMapped).toBe(true);
  });

  it("T27. throws LabmausUnknownSpeciesError when alias is missing", async () => {
    db = seedLabmausDb({ seedAliases: false });
    const speciesMap: SpeciesMapDeps = { db, aliasRepo };
    let thrown: unknown;
    try {
      await getTournament(
        { id: 56757 },
        { client: clientFromFixture("2026-05-04__tournament_56757.json"), speciesMap },
      );
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(LabmausUnknownSpeciesError);
  });
});
