/**
 * PIKA-T29, PIKA-T30 — `pikalytics.fetchSpecies` agent surface.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fetchSpecies } from "../../../src/tools/pikalytics/fetch-species";
import * as roster from "../../../src/db/roster";
import { seedLabmausDb, closeIfOpen } from "../../db/labmaus-fixtures";
import { PikalyticsInputError } from "../../../src/schemas/errors";
import type { PikalyticsClient } from "../../../src/tools/pikalytics/client";

const FIX = join(process.cwd(), "fixtures", "pikalytics");

function makeClient(body: string): PikalyticsClient {
  return {
    async fetchSpeciesMarkdown(slug: string) {
      return {
        body,
        source_url: `https://www.pikalytics.com/pokedex/gen9championsvgc2026regma/${slug}`,
        ai_url: `https://www.pikalytics.com/ai/pokedex/gen9championsvgc2026regma/${slug}`,
      };
    },
  };
}

describe("pikalytics.fetchSpecies (PIKA-T29, PIKA-T30)", () => {
  it("PIKA-T29. returns parsed PikalyticsSnapshot end-to-end on injected client + DB", async () => {
    const db = seedLabmausDb();
    try {
      const raw = readFileSync(join(FIX, "2026-05-07__garchomp.md"), "utf8");
      const out = await fetchSpecies(
        { format: "RegM-A", species_roster_id: "garchomp" },
        {
          client: makeClient(raw),
          transform: { db, rosterRepo: { has: roster.has, get: roster.get } },
        },
      );
      expect(out.snapshot.species_roster_id).toBe("garchomp");
      expect(out.snapshot.format).toBe("RegM-A");
      expect(Array.isArray(out.unknown_teammate_names)).toBe(true);
    } finally {
      closeIfOpen(db);
    }
  });

  it("PIKA-T30. throws PikalyticsInputError on unknown roster id", async () => {
    const db = seedLabmausDb();
    try {
      const fakeClient: PikalyticsClient = {
        fetchSpeciesMarkdown: vi.fn(async () => {
          throw new Error("client should not be called for unknown roster id");
        }),
      };
      let thrown: unknown;
      try {
        await fetchSpecies(
          { format: "RegM-A", species_roster_id: "not-a-pokemon" },
          {
            client: fakeClient,
            transform: { db, rosterRepo: { has: roster.has, get: roster.get } },
          },
        );
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(PikalyticsInputError);
    } finally {
      closeIfOpen(db);
    }
  });
});
