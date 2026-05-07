/**
 * Tests T8–T11 — reject-and-fail validation of item / ability / move /
 * species against the Champions ref tables.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { transformPaste, type TransformDeps } from "../../../src/tools/pokepaste/transform";
import {
  PokepasteRefValidationError,
  PokepasteUnknownSpeciesError,
} from "../../../src/schemas/errors";
import { closeIfOpen, seedLabmausDb } from "../../db/labmaus-fixtures";
import type { Db } from "../../../src/db/open";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "..", "..", "..", "fixtures", "pokepaste");

function loadRaw(file: string): string {
  return readFileSync(join(FIX, file), "utf8");
}

function depsWith(
  db: Db,
  overrides: Partial<TransformDeps> = {},
): TransformDeps {
  return {
    db,
    rosterRepo: {
      has: (): boolean => true,
      get: (_d, name): { id: string } => ({ id: name.toLowerCase().replace(/[^a-z0-9-]/g, "") }),
    },
    itemsRepo: { has: (): boolean => true },
    abilitiesRepo: { has: (): boolean => true },
    movesRepo: { has: (): boolean => true },
    ...overrides,
  };
}

describe("transform ref-table validation (reject-and-fail)", () => {
  let db: Db;
  beforeEach(() => {
    db = seedLabmausDb();
  });
  afterEach(() => {
    closeIfOpen(db);
  });

  it("T8. throws PokepasteRefValidationError on unknown item (no partial output)", () => {
    // Mutate the in-memory text — fixtures stay realistic.
    const raw = loadRaw("2026-05-04__7205bf28f85d1e79.txt").replace(
      "Charizardite Y",
      "Bogus Item",
    );
    const deps = depsWith(db, {
      itemsRepo: { has: (_d, name): boolean => name !== "Bogus Item" },
    });
    let thrown: unknown;
    try {
      transformPaste(
        {
          paste_id: "7205bf28f85d1e79",
          raw_text: raw,
          fetched_at: "2026-05-04T19:32:11.000Z",
          tournament_team_id: "labmaus:56757:244471",
        },
        deps,
      );
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(PokepasteRefValidationError);
    const e = thrown as PokepasteRefValidationError;
    expect(e.kind).toBe("item");
    expect(e.value).toBe("Bogus Item");
    expect(e.paste_id).toBe("7205bf28f85d1e79");
    expect(e.slot).toBe(0);
  });

  it("T9. throws PokepasteRefValidationError on unknown ability", () => {
    const raw = loadRaw("2026-05-04__7205bf28f85d1e79.txt").replace(
      "Ability: Blaze",
      "Ability: Bogus Ability",
    );
    const deps = depsWith(db, {
      abilitiesRepo: { has: (_d, name): boolean => name !== "Bogus Ability" },
    });
    let thrown: unknown;
    try {
      transformPaste(
        {
          paste_id: "7205bf28f85d1e79",
          raw_text: raw,
          fetched_at: "2026-05-04T19:32:11.000Z",
          tournament_team_id: "labmaus:56757:244471",
        },
        deps,
      );
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(PokepasteRefValidationError);
    expect((thrown as PokepasteRefValidationError).kind).toBe("ability");
    expect((thrown as PokepasteRefValidationError).value).toBe("Bogus Ability");
  });

  it("T10. throws PokepasteRefValidationError on unknown move (first unknown wins)", () => {
    const raw = loadRaw("2026-05-04__7205bf28f85d1e79.txt").replace(
      "- Heat Wave",
      "- Bogus Move",
    );
    const deps = depsWith(db, {
      movesRepo: { has: (_d, name): boolean => name !== "Bogus Move" },
    });
    let thrown: unknown;
    try {
      transformPaste(
        {
          paste_id: "7205bf28f85d1e79",
          raw_text: raw,
          fetched_at: "2026-05-04T19:32:11.000Z",
          tournament_team_id: "labmaus:56757:244471",
        },
        deps,
      );
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(PokepasteRefValidationError);
    expect((thrown as PokepasteRefValidationError).kind).toBe("move");
    expect((thrown as PokepasteRefValidationError).value).toBe("Bogus Move");
  });

  it("T11. throws PokepasteUnknownSpeciesError on unknown roster id", () => {
    const raw = loadRaw("2026-05-04__7205bf28f85d1e79.txt").replace(
      /^Charizard /m,
      "DefinitelyNotAPokemon ",
    );
    const deps = depsWith(db, {
      rosterRepo: {
        has: (_d, name): boolean => !/definitely/i.test(name),
        get: (_d, name): { id: string } | null =>
          /definitely/i.test(name) ? null : { id: name.toLowerCase() },
      },
    });
    let thrown: unknown;
    try {
      transformPaste(
        {
          paste_id: "7205bf28f85d1e79",
          raw_text: raw,
          fetched_at: "2026-05-04T19:32:11.000Z",
          tournament_team_id: "labmaus:56757:244471",
        },
        deps,
      );
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(PokepasteUnknownSpeciesError);
  });
});
