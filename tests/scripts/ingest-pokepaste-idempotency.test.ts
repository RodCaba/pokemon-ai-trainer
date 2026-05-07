/**
 * Test T41 — running the pokepaste hook twice for the same team
 * produces zero `team_sets` deltas.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  processTeamPokepaste,
  type PokepasteRunSummary,
} from "../../scripts/data/pokepaste-hook";
import * as sets from "../../src/db/sets";
import {
  tournaments as tournamentsTable,
  tournamentTeams,
} from "../../src/db/drizzle-schema";
import type { Db } from "../../src/db/open";
import type { PokepasteClient } from "../../src/tools/pokepaste/client";
import type { TransformDeps } from "../../src/tools/pokepaste/transform";
import { closeIfOpen, seedLabmausDb } from "../db/labmaus-fixtures";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "..", "..", "fixtures", "pokepaste");
const FETCHED_AT = "2026-05-04T19:32:11.000Z";

function permissiveTransformDeps(db: Db): TransformDeps {
  return {
    db,
    rosterRepo: {
      has: (): boolean => true,
      get: (_d, name): { id: string } => ({ id: name.toLowerCase().replace(/[^a-z0-9-]/g, "") }),
    },
    itemsRepo: { has: (): boolean => true },
    abilitiesRepo: { has: (): boolean => true },
    movesRepo: { has: (): boolean => true },
  };
}

describe("pokepaste ingest idempotency", () => {
  let db: Db;
  beforeEach(() => {
    db = seedLabmausDb();
  });
  afterEach(() => {
    closeIfOpen(db);
  });

  it("T41. running the hook twice produces zero team_sets deltas", async () => {
    db.insert(tournamentsTable)
      .values({
        id: "labmaus:56757",
        externalId: 56757,
        tournamentCode: null,
        name: "T",
        organizer: null,
        format: "RegM-A",
        division: "Masters",
        status: "unofficial",
        date: "2026-05-01",
        numPlayers: 1,
        numPhase2: null,
        sourceSite: "labmaus",
        sourceSiteSource: null,
        sourceUrl: "https://labmaus.net/tournaments/56757",
        fetchedAt: FETCHED_AT,
      })
      .run();
    db.insert(tournamentTeams)
      .values({
        id: "labmaus:56757:1",
        tournamentId: "labmaus:56757",
        externalTeamId: 1,
        player: "p",
        playerKey: "p",
        country: null,
        placement: 1,
        record: "1-0-0",
        teamUrl: "https://pokepast.es/7205bf28f85d1e79",
        fetchedAt: FETCHED_AT,
      })
      .run();
    const raw = readFileSync(join(FIX, "2026-05-04__7205bf28f85d1e79.txt"), "utf8");
    const client: PokepasteClient = { fetchRaw: vi.fn(async () => raw) };
    const summary: PokepasteRunSummary = {
      team_sets: 0,
      pokepaste_404s: [],
      pokepaste_failures: [],
      ref_validation_failures: [],
      unknown_species: [],
    };
    const args = {
      db,
      client,
      transform: permissiveTransformDeps(db),
      team_id: "labmaus:56757:1",
      team_url: "https://pokepast.es/7205bf28f85d1e79",
      summary,
    };
    await processTeamPokepaste(args);
    const before = sets.list(db, { tournament_team_id: "labmaus:56757:1" });
    await processTeamPokepaste(args);
    const after = sets.list(db, { tournament_team_id: "labmaus:56757:1" });
    expect(after.length).toBe(before.length);
  });
});
