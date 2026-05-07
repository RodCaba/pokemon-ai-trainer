/**
 * Test T14 — completeness tag computed correctly across the 5 fixtures.
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

describe("transform completeness tag (T14)", () => {
  let db: Db;
  beforeEach(() => {
    db = seedLabmausDb();
  });
  afterEach(() => {
    closeIfOpen(db);
  });

  it("T14a. minimal-completeness fixture → every set tagged 'minimal'", () => {
    const raw = readFileSync(join(FIX, "2026-05-04__7205bf28f85d1e79.txt"), "utf8");
    const out = transformPaste(
      {
        paste_id: "7205bf28f85d1e79",
        raw_text: raw,
        fetched_at: "2026-05-04T19:32:11.000Z",
        tournament_team_id: "labmaus:56757:244471",
      },
      permissiveDeps(db),
    );
    for (const s of out.sets) expect(s.completeness).toBe("minimal");
  });

  it("T14b. full-spread fixture → every set tagged 'full'", () => {
    const raw = readFileSync(join(FIX, "2026-05-04__synthetic-full-spread.txt"), "utf8");
    const out = transformPaste(
      {
        paste_id: "0000000000000001",
        raw_text: raw,
        fetched_at: "2026-05-04T19:32:11.000Z",
        tournament_team_id: "labmaus:56757:244471",
      },
      permissiveDeps(db),
    );
    for (const s of out.sets) expect(s.completeness).toBe("full");
  });

  it("T14c. partial fixture → mixed minimal/partial tags", () => {
    const raw = readFileSync(join(FIX, "2026-05-04__synthetic-partial.txt"), "utf8");
    const out = transformPaste(
      {
        paste_id: "0000000000000002",
        raw_text: raw,
        fetched_at: "2026-05-04T19:32:11.000Z",
        tournament_team_id: "labmaus:56757:244471",
      },
      permissiveDeps(db),
    );
    const tags = out.sets.map((s) => s.completeness);
    // Some sets carry SPS (`partial`), some carry only nature (`partial`),
    // some carry neither (`minimal`). Never `full` (no IV lines).
    expect(tags).not.toContain("full");
    expect(tags).toContain("partial");
  });
});
