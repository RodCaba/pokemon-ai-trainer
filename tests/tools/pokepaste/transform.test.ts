/**
 * Tests T6, T15, T16, T17 for `transformPaste`.
 *
 * Stage 4: every test fails because `transformPaste` throws "not
 * implemented (Stage 5)". The assertions below capture the
 * post-Stage-5 contract.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { transformPaste, type TransformDeps } from "../../../src/tools/pokepaste/transform";
import { closeIfOpen, seedLabmausDb } from "../../db/labmaus-fixtures";
import type { Db } from "../../../src/db/open";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "..", "..", "..", "fixtures", "pokepaste");
const FETCHED_AT = "2026-05-04T19:32:11.000Z";

function loadRaw(file: string): string {
  return readFileSync(join(FIX, file), "utf8");
}

function permissiveDeps(db: Db): TransformDeps {
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

describe("transformPaste", () => {
  let db: Db;
  beforeEach(() => {
    db = seedLabmausDb();
  });
  afterEach(() => {
    closeIfOpen(db);
  });

  it("T6. happy path on real Charizard fixture (6 sets in slot order)", () => {
    const raw = loadRaw("2026-05-04__7205bf28f85d1e79.txt");
    const out = transformPaste(
      {
        paste_id: "7205bf28f85d1e79",
        raw_text: raw,
        fetched_at: FETCHED_AT,
        tournament_team_id: "labmaus:56757:244471",
      },
      permissiveDeps(db),
    );
    expect(out.paste_id).toBe("7205bf28f85d1e79");
    expect(out.sets.length).toBe(6);
    expect(out.sets[0]?.slot).toBe(0);
    expect(out.sets[5]?.slot).toBe(5);
    // Slot 0 is Charizard in the fixture.
    expect(out.sets[0]?.species_roster_id).toBe("charizard");
    expect(out.sets[0]?.item).toBe("Charizardite Y");
    expect(out.sets[0]?.moves).toEqual(["Heat Wave", "Weather Ball", "Solar Beam", "Protect"]);
    // Real fixture has no SPS/IVs/Nature → minimal.
    expect(out.sets[0]?.completeness).toBe("minimal");
  });

  it("T15. transform handles ♂ symbol in species name", () => {
    const raw = loadRaw("2026-05-04__synthetic-edge-cases.txt");
    const out = transformPaste(
      {
        paste_id: "0000000000000003",
        raw_text: raw,
        fetched_at: FETCHED_AT,
        tournament_team_id: "labmaus:56757:244472",
      },
      permissiveDeps(db),
    );
    // Slot 2 is "Basculegion ♂" — must map to a roster id (canonical id
    // varies per Stage 5 mapping policy; we only assert it resolves).
    const basculegion = out.sets.find((s) => s.slot === 2);
    expect(basculegion).toBeDefined();
    expect(basculegion?.species_roster_id).toMatch(/basculegion/);
  });

  it("T16. transform handles Mega Stones (Charizardite Y, slot 0 species stays charizard)", () => {
    const raw = loadRaw("2026-05-04__7205bf28f85d1e79.txt");
    const out = transformPaste(
      {
        paste_id: "7205bf28f85d1e79",
        raw_text: raw,
        fetched_at: FETCHED_AT,
        tournament_team_id: "labmaus:56757:244471",
      },
      permissiveDeps(db),
    );
    expect(out.sets[0]?.item).toBe("Charizardite Y");
    expect(out.sets[0]?.species_roster_id).toBe("charizard");
  });

  it("T17. transform rejects empty-moves set (drops below minimal completeness)", async () => {
    // The synthetic-empty-moves fixture is a single Kingambit set with zero
    // `- <move>` lines, which drops below `minimal`. Per plan §3 Q4 + flow §6
    // open Q, the transform throws PokepasteParseError (not just any error).
    // (Split out from synthetic-edge-cases.txt during Stage 5 — that fixture's
    // empty-moves slot collided with T15's success path on the same fixture.)
    const { PokepasteParseError } = await import("../../../src/schemas/errors");
    const raw = loadRaw("2026-05-04__synthetic-empty-moves.txt");
    let thrown: unknown;
    try {
      transformPaste(
        {
          paste_id: "0000000000000003",
          raw_text: raw,
          fetched_at: FETCHED_AT,
          tournament_team_id: "labmaus:56757:244472",
        },
        permissiveDeps(db),
      );
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(PokepasteParseError);
  });

  it("T17b. transform rejects no-ability set (drops below minimal completeness)", async () => {
    // Per plan §2.5 + flow §2.5, `minimal = species + item + ability + ≥1
    // move`. A set without an Ability: line drops below minimal and the
    // transform must throw PokepasteParseError. Regression-guard for the
    // Stage 5 silent relaxation that dropped ability from the contract.
    const { PokepasteParseError } = await import("../../../src/schemas/errors");
    const raw = loadRaw("2026-05-04__synthetic-no-ability.txt");
    let thrown: unknown;
    try {
      transformPaste(
        {
          paste_id: "0000000000000004",
          raw_text: raw,
          fetched_at: FETCHED_AT,
          tournament_team_id: "labmaus:56757:244473",
        },
        permissiveDeps(db),
      );
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(PokepasteParseError);
  });
});
