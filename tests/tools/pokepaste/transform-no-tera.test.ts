/**
 * Test T7 — `transform strips Tera Type unconditionally`.
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

describe("transform Tera strip (T7)", () => {
  let db: Db;
  beforeEach(() => {
    db = seedLabmausDb();
  });
  afterEach(() => {
    closeIfOpen(db);
  });

  it("T7. no parsed set carries any tera_* field across every committed fixture", () => {
    const fixtures = [
      "2026-05-04__7205bf28f85d1e79.txt",
      "2026-05-04__a5f32930d39e424e.txt",
      "2026-05-04__synthetic-full-spread.txt",
      "2026-05-04__synthetic-partial.txt",
    ];
    for (const f of fixtures) {
      const out = transformPaste(
        {
          paste_id: f.includes("7205") ? "7205bf28f85d1e79"
            : f.includes("a5f3") ? "a5f32930d39e424e"
            : "0000000000000099",
          raw_text: readFileSync(join(FIX, f), "utf8"),
          fetched_at: "2026-05-04T19:32:11.000Z",
          tournament_team_id: "labmaus:56757:244471",
        },
        permissiveDeps(db),
      );
      for (const s of out.sets) {
        for (const k of Object.keys(s)) {
          expect(/tera/i.test(k)).toBe(false);
        }
      }
    }
  });
});
