/**
 * PIKA-T13 — happy-path transform on the real Garchomp fixture.
 * Stage 4: fails because `transformPikalyticsMarkdown` throws "not implemented".
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { transformPikalyticsMarkdown } from "../../../src/tools/pikalytics/transform";
import * as roster from "../../../src/db/roster";
import { seedLabmausDb, closeIfOpen } from "../../db/labmaus-fixtures";

const FIX = join(process.cwd(), "fixtures", "pikalytics");

describe("transformPikalyticsMarkdown — happy path (PIKA-T13)", () => {
  it("PIKA-T13. transforms Garchomp fixture end-to-end", () => {
    const db = seedLabmausDb();
    try {
      const raw = readFileSync(join(FIX, "2026-05-07__garchomp.md"), "utf8");
      const out = transformPikalyticsMarkdown(
        {
          species_roster_id: "garchomp",
          raw_markdown: raw,
          source_url:
            "https://www.pikalytics.com/pokedex/gen9championsvgc2026regma/Garchomp",
          ai_url:
            "https://www.pikalytics.com/ai/pokedex/gen9championsvgc2026regma/Garchomp",
          fetched_at: "2026-05-07T12:00:00Z",
        },
        { db, rosterRepo: { has: roster.has, get: roster.get } },
      );
      expect(out.snapshot.species_roster_id).toBe("garchomp");
      expect(out.snapshot.id).toBe(
        "pikalytics:gen9championsvgc2026regma:garchomp:2026-04-01",
      );
      expect(out.snapshot.format).toBe("RegM-A");
      expect(out.snapshot.format_slug).toBe("gen9championsvgc2026regma");
      expect(out.snapshot.source.site).toBe("pikalytics");
      expect(out.snapshot.teammates.length).toBeGreaterThan(0);
    } finally {
      closeIfOpen(db);
    }
  });
});
