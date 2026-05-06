/**
 * Tests T37–T40 — per-team pokepaste ingest hook behavior.
 *
 * Stage 4: every test fails because `processTeamPokepaste` throws "not
 * implemented (Stage 5)". Assertions capture the post-Stage-5 contract.
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
import {
  PokepasteNotFoundError,
  PokepasteUnknownSpeciesError,
} from "../../src/schemas/errors";
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

function emptySummary(): PokepasteRunSummary {
  return {
    team_sets: 0,
    pokepaste_404s: [],
    pokepaste_failures: [],
    ref_validation_failures: [],
  };
}

function seedLabmausTeam(db: Db, teamId: string, tournamentId: string): void {
  db.insert(tournamentsTable)
    .values({
      id: tournamentId,
      externalId: Number(tournamentId.split(":")[1]),
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
      sourceUrl: `https://labmaus.net/tournaments/${tournamentId.split(":")[1]}`,
      fetchedAt: FETCHED_AT,
    })
    .run();
  db.insert(tournamentTeams)
    .values({
      id: teamId,
      tournamentId,
      externalTeamId: Number(teamId.split(":")[2]),
      player: "p",
      playerKey: "p",
      country: null,
      placement: 1,
      record: "1-0-0",
      teamUrl: "https://pokepast.es/7205bf28f85d1e79",
      fetchedAt: FETCHED_AT,
    })
    .run();
}

describe("pokepaste ingest hook", () => {
  let db: Db;
  beforeEach(() => {
    db = seedLabmausDb();
  });
  afterEach(() => {
    closeIfOpen(db);
  });

  it("T37. happy path persists 6 team_sets per labmaus team", async () => {
    seedLabmausTeam(db, "labmaus:56757:1", "labmaus:56757");
    const raw = readFileSync(join(FIX, "2026-05-04__7205bf28f85d1e79.txt"), "utf8");
    const client: PokepasteClient = { fetchRaw: vi.fn(async () => raw) };
    const summary = emptySummary();
    await processTeamPokepaste({
      db,
      client,
      transform: permissiveTransformDeps(db),
      team_id: "labmaus:56757:1",
      team_url: "https://pokepast.es/7205bf28f85d1e79",
      summary,
    });
    expect(sets.list(db, { tournament_team_id: "labmaus:56757:1" }).length).toBe(6);
    expect(summary.team_sets).toBe(6);
  });

  it("T38. PokepasteRefValidationError → log warning, skip team, continue", async () => {
    seedLabmausTeam(db, "labmaus:56757:1", "labmaus:56757");
    const raw = readFileSync(join(FIX, "2026-05-04__7205bf28f85d1e79.txt"), "utf8")
      .replace("Charizardite Y", "Bogus Item");
    const client: PokepasteClient = { fetchRaw: vi.fn(async () => raw) };
    const summary = emptySummary();
    await processTeamPokepaste({
      db,
      client,
      transform: {
        ...permissiveTransformDeps(db),
        itemsRepo: { has: (_d, name): boolean => name !== "Bogus Item" },
      },
      team_id: "labmaus:56757:1",
      team_url: "https://pokepast.es/7205bf28f85d1e79",
      summary,
    });
    expect(sets.list(db, { tournament_team_id: "labmaus:56757:1" }).length).toBe(0);
    expect(summary.ref_validation_failures.length).toBe(1);
    expect(summary.ref_validation_failures[0]?.kind).toBe("item");
    expect(summary.ref_validation_failures[0]?.value).toBe("Bogus Item");
  });

  it("T39. 404 → log warning, skip team, continue (labmaus row preserved)", async () => {
    seedLabmausTeam(db, "labmaus:56757:1", "labmaus:56757");
    const client: PokepasteClient = {
      fetchRaw: vi.fn(async () => {
        throw new PokepasteNotFoundError("404", { paste_id: "7205bf28f85d1e79" });
      }),
    };
    const summary = emptySummary();
    await processTeamPokepaste({
      db,
      client,
      transform: permissiveTransformDeps(db),
      team_id: "labmaus:56757:1",
      team_url: "https://pokepast.es/7205bf28f85d1e79",
      summary,
    });
    expect(sets.list(db, { tournament_team_id: "labmaus:56757:1" }).length).toBe(0);
    expect(summary.pokepaste_404s.length).toBe(1);
    // Labmaus tournament_teams row stays.
    const tt = db.$client
      .prepare("SELECT id FROM tournament_teams WHERE id = ?")
      .get("labmaus:56757:1");
    expect(tt).toBeDefined();
  });

  it("T40. PokepasteUnknownSpeciesError fails loud (re-raised)", async () => {
    seedLabmausTeam(db, "labmaus:56757:1", "labmaus:56757");
    const raw = readFileSync(join(FIX, "2026-05-04__7205bf28f85d1e79.txt"), "utf8");
    const client: PokepasteClient = { fetchRaw: vi.fn(async () => raw) };
    const summary = emptySummary();
    let thrown: unknown;
    try {
      await processTeamPokepaste({
        db,
        client,
        transform: {
          ...permissiveTransformDeps(db),
          rosterRepo: {
            has: (): boolean => false,
            get: (): { id: string } | null => null,
          },
        },
        team_id: "labmaus:56757:1",
        team_url: "https://pokepast.es/7205bf28f85d1e79",
        summary,
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(PokepasteUnknownSpeciesError);
  });
});
