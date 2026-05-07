/**
 * Tests T26, T27 — `fetchPaste` end-to-end + reject-and-fail re-raise.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchPaste } from "../../../src/tools/pokepaste/fetch-paste";
import type { PokepasteClient } from "../../../src/tools/pokepaste/client";
import type { TransformDeps } from "../../../src/tools/pokepaste/transform";
import { PokepasteRefValidationError } from "../../../src/schemas/errors";
import { closeIfOpen, seedLabmausDb } from "../../db/labmaus-fixtures";
import type { Db } from "../../../src/db/open";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "..", "..", "..", "fixtures", "pokepaste");

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

describe("fetchPaste", () => {
  let db: Db;
  beforeEach(() => {
    db = seedLabmausDb();
  });
  afterEach(() => {
    closeIfOpen(db);
  });

  it("T26. returns parsed PasteFetchResult on injected client + DB", async () => {
    const raw = readFileSync(join(FIX, "2026-05-04__7205bf28f85d1e79.txt"), "utf8");
    const client: PokepasteClient = {
      fetchRaw: vi.fn(async () => raw),
    };
    const out = await fetchPaste(
      { paste_id: "7205bf28f85d1e79" },
      {
        client,
        transform: permissiveTransformDeps(db),
        tournament_team_id: "labmaus:56757:244471",
      },
    );
    expect(out.paste_id).toBe("7205bf28f85d1e79");
    expect(out.sets.length).toBe(6);
  });

  it("T27. re-raises PokepasteRefValidationError without swallowing", async () => {
    const raw = readFileSync(join(FIX, "2026-05-04__7205bf28f85d1e79.txt"), "utf8")
      .replace("Charizardite Y", "Bogus Item");
    const client: PokepasteClient = {
      fetchRaw: vi.fn(async () => raw),
    };
    let thrown: unknown;
    try {
      await fetchPaste(
        { paste_id: "7205bf28f85d1e79" },
        {
          client,
          transform: {
            ...permissiveTransformDeps(db),
            itemsRepo: { has: (_d, name): boolean => name !== "Bogus Item" },
          },
          tournament_team_id: "labmaus:56757:244471",
        },
      );
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(PokepasteRefValidationError);
  });
});
