/**
 * PIKA-T33–PIKA-T42 — bespoke `pikalytics_snapshots` repo.
 * Stage 4: every test fails because every repo function throws "not implemented".
 */

import { describe, expect, it } from "vitest";
import * as pikalytics from "../../src/db/pikalytics";
import type { Db } from "../../src/db/open";
import type { PikalyticsSnapshot } from "../../src/schemas/pikalytics";
import { seedLabmausDb, closeIfOpen } from "./labmaus-fixtures";

function snap(args: {
  species: string;
  as_of: string;
  teammates?: Array<{ roster_id: string; percent: number }>;
  items?: Array<{ name: string; percent: number }>;
  usage?: number | null;
}): PikalyticsSnapshot {
  return {
    schema_version: 1,
    id: `pikalytics:gen9championsvgc2026regma:${args.species}:${args.as_of}`,
    format: "RegM-A",
    format_slug: "gen9championsvgc2026regma",
    species_roster_id: args.species,
    as_of: args.as_of,
    usage_percent: args.usage ?? null,
    teammates: args.teammates ?? [],
    items: args.items ?? [],
    abilities: [],
    moves: [],
    sample_size: null,
    source: {
      site: "pikalytics",
      source_url: `https://www.pikalytics.com/pokedex/gen9championsvgc2026regma/${args.species}`,
      ai_url: `https://www.pikalytics.com/ai/pokedex/gen9championsvgc2026regma/${args.species}`,
      fetched_at: "2026-05-07T12:00:00Z",
    },
  };
}

function withDb(fn: (db: Db) => void): void {
  const db = seedLabmausDb();
  try {
    fn(db);
  } finally {
    closeIfOpen(db);
  }
}

describe("pikalytics repo (PIKA-T33–PIKA-T42)", () => {
  it("PIKA-T33. upsertSnapshot inserts a row", () => {
    withDb((db) => {
      const s = snap({
        species: "garchomp",
        as_of: "2026-04-01",
        teammates: [{ roster_id: "sneasler", percent: 46.767 }],
        usage: 40.13,
      });
      const result = pikalytics.upsertSnapshot(db, s);
      expect(result.inserted).toBe(true);
      const got = pikalytics.get(db, { species_roster_id: "garchomp" });
      expect(got?.id).toBe(s.id);
    });
  });

  it("PIKA-T34. upsertSnapshot is idempotent — second call returns inserted:false", () => {
    withDb((db) => {
      const s = snap({ species: "garchomp", as_of: "2026-04-01" });
      pikalytics.upsertSnapshot(db, s);
      const second = pikalytics.upsertSnapshot(db, s);
      expect(second.inserted).toBe(false);
    });
  });

  it("PIKA-T35. get returns the latest snapshot when multiple as_of values exist", () => {
    withDb((db) => {
      pikalytics.upsertSnapshot(db, snap({ species: "garchomp", as_of: "2026-03-01" }));
      pikalytics.upsertSnapshot(db, snap({ species: "garchomp", as_of: "2026-04-01" }));
      const got = pikalytics.get(db, { species_roster_id: "garchomp" });
      expect(got?.as_of).toBe("2026-04-01");
    });
  });

  it("PIKA-T36. get returns null on miss", () => {
    withDb((db) => {
      expect(pikalytics.get(db, { species_roster_id: "garchomp" })).toBeNull();
    });
  });

  it("PIKA-T37. teammates returns ranked list with default limit=10", () => {
    withDb((db) => {
      pikalytics.upsertSnapshot(
        db,
        snap({
          species: "garchomp",
          as_of: "2026-04-01",
          teammates: [
            { roster_id: "sneasler", percent: 46.767 },
            { roster_id: "kingambit", percent: 45.485 },
            { roster_id: "basculegionm", percent: 38.819 },
          ],
        }),
      );
      const out = pikalytics.teammates(db, { format: "RegM-A", species: "garchomp" });
      expect(out.length).toBe(3);
      expect(out[0]?.roster_id).toBe("sneasler");
      expect(out[1]?.roster_id).toBe("kingambit");
    });
  });

  it("PIKA-T38. teammates respects limit override", () => {
    withDb((db) => {
      pikalytics.upsertSnapshot(
        db,
        snap({
          species: "garchomp",
          as_of: "2026-04-01",
          teammates: [
            { roster_id: "sneasler", percent: 46.767 },
            { roster_id: "kingambit", percent: 45.485 },
            { roster_id: "basculegionm", percent: 38.819 },
          ],
        }),
      );
      const out = pikalytics.teammates(db, {
        format: "RegM-A",
        species: "garchomp",
        limit: 2,
      });
      expect(out.length).toBe(2);
    });
  });

  it("PIKA-T39. usage(dimension='species') ranks species by usage_percent across the meta", () => {
    withDb((db) => {
      pikalytics.upsertSnapshot(
        db,
        snap({ species: "garchomp", as_of: "2026-04-01", usage: 40.13 }),
      );
      pikalytics.upsertSnapshot(
        db,
        snap({ species: "sneasler", as_of: "2026-04-01", usage: 35.0 }),
      );
      pikalytics.upsertSnapshot(
        db,
        snap({ species: "kingambit", as_of: "2026-04-01", usage: 30.0 }),
      );
      const out = pikalytics.usage(db, { format: "RegM-A", dimension: "species" });
      expect(out.length).toBeGreaterThanOrEqual(3);
      expect(out[0]?.key).toBe("garchomp");
      expect(out[1]?.key).toBe("sneasler");
    });
  });

  it("PIKA-T39b. usage(dimension='species') returns latest-per-species (no duplicates across as_of values)", () => {
    // Stage 6 review item 2: regression guard for `latest-per-species`. Two
    // `as_of` rows for the same species must collapse to the latest one
    // only; the older row must NOT appear in the ranking.
    withDb((db) => {
      pikalytics.upsertSnapshot(
        db,
        snap({ species: "garchomp", as_of: "2026-03-01", usage: 50.0 }),
      );
      pikalytics.upsertSnapshot(
        db,
        snap({ species: "garchomp", as_of: "2026-04-01", usage: 40.13 }),
      );
      pikalytics.upsertSnapshot(
        db,
        snap({ species: "sneasler", as_of: "2026-04-01", usage: 35.0 }),
      );
      const out = pikalytics.usage(db, { format: "RegM-A", dimension: "species" });
      const garchompRows = out.filter((r) => r.key === "garchomp");
      expect(garchompRows.length).toBe(1);
      expect(garchompRows[0]?.as_of).toBe("2026-04-01");
      expect(garchompRows[0]?.usage_percent).toBe(40.13);
    });
  });

  it("PIKA-T40. usage(dimension='item', species='garchomp') ranks items + carries source_url + as_of", () => {
    withDb((db) => {
      pikalytics.upsertSnapshot(
        db,
        snap({
          species: "garchomp",
          as_of: "2026-04-01",
          items: [
            { name: "Choice Scarf", percent: 27.89 },
            { name: "Sitrus Berry", percent: 16.534 },
          ],
        }),
      );
      const out = pikalytics.usage(db, {
        format: "RegM-A",
        dimension: "item",
        species: "garchomp",
      });
      expect(out.length).toBe(2);
      expect(out[0]?.key).toBe("Choice Scarf");
      expect(out[0]?.source_url).toContain("pikalytics.com");
      expect(out[0]?.as_of).toBe("2026-04-01");
    });
  });

  it("PIKA-T41. usage(dimension='teammate') matches teammates() output shape-projected", () => {
    withDb((db) => {
      pikalytics.upsertSnapshot(
        db,
        snap({
          species: "garchomp",
          as_of: "2026-04-01",
          teammates: [
            { roster_id: "sneasler", percent: 46.767 },
            { roster_id: "kingambit", percent: 45.485 },
          ],
        }),
      );
      const teammatesList = pikalytics.teammates(db, {
        format: "RegM-A",
        species: "garchomp",
      });
      const usageList = pikalytics.usage(db, {
        format: "RegM-A",
        dimension: "teammate",
        species: "garchomp",
      });
      expect(usageList.length).toBe(teammatesList.length);
      expect(usageList[0]?.key).toBe(teammatesList[0]?.roster_id);
    });
  });

  it("PIKA-T42. exists returns true after upsert, false otherwise", () => {
    withDb((db) => {
      expect(pikalytics.exists(db, "garchomp", "2026-04-01")).toBe(false);
      pikalytics.upsertSnapshot(db, snap({ species: "garchomp", as_of: "2026-04-01" }));
      expect(pikalytics.exists(db, "garchomp", "2026-04-01")).toBe(true);
    });
  });
});
