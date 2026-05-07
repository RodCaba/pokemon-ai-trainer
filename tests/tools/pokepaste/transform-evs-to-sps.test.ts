/**
 * Tests T12, T13 — evs → sps rename + Reg M-A SPS cap enforcement.
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

describe("transform evs → sps rename + caps", () => {
  let db: Db;
  beforeEach(() => {
    db = seedLabmausDb();
  });
  afterEach(() => {
    closeIfOpen(db);
  });

  it("T12. transform renames evs → sps and preserves values verbatim", () => {
    const raw = readFileSync(
      join(FIX, "2026-05-04__synthetic-full-spread.txt"),
      "utf8",
    );
    const out = transformPaste(
      {
        paste_id: "0000000000000001",
        raw_text: raw,
        fetched_at: "2026-05-04T19:32:11.000Z",
        tournament_team_id: "labmaus:56757:244471",
      },
      permissiveDeps(db),
    );
    // Slot 0 is Garchomp with `EVs: 32 Atk / 32 Spe` in the fixture.
    const garchomp = out.sets[0];
    expect(garchomp?.sps).not.toBeNull();
    expect(garchomp?.sps?.atk).toBe(32);
    expect(garchomp?.sps?.spe).toBe(32);
    expect(garchomp?.sps?.hp).toBe(0);
    // Domain key is `sps`, not `evs`.
    expect((garchomp as unknown as Record<string, unknown>).evs).toBeUndefined();
  });

  it("T13. transform rejects EVs that exceed Reg M-A SPS caps", async () => {
    // Inject an EV line totaling 510 (Showdown legal, Champions illegal:
    // per-stat > 32 and total > 66 both apply). Stage 5 must surface this
    // as PokepasteParseError, not a generic throw.
    const { PokepasteParseError } = await import("../../../src/schemas/errors");
    const raw = readFileSync(
      join(FIX, "2026-05-04__7205bf28f85d1e79.txt"),
      "utf8",
    ).replace(
      "Level: 50",
      "Level: 50\nEVs: 252 HP / 252 Atk / 4 Spe",
    );
    let thrown: unknown;
    try {
      transformPaste(
        {
          paste_id: "7205bf28f85d1e79",
          raw_text: raw,
          fetched_at: "2026-05-04T19:32:11.000Z",
          tournament_team_id: "labmaus:56757:244471",
        },
        permissiveDeps(db),
      );
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(PokepasteParseError);
  });
});
