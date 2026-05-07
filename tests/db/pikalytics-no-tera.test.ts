/**
 * PIKA-T43 — Tera property test on persisted rows.
 *
 * §3 vacuous-green slip flag: this test is "vacuous green" once the schema
 * (which has no tera_* fields) and the transform's fail-loud check land
 * correctly — the explicit guard catches future regressions. Flagged for
 * Stage 6 reviewer per CLAUDE.md §3 last paragraph.
 *
 * Stage 4: fails because `upsertSnapshot` throws "not implemented".
 */

import { describe, expect, it } from "vitest";
import * as pikalytics from "../../src/db/pikalytics";
import { pikalyticsSnapshots } from "../../src/db/drizzle-schema";
import type { PikalyticsSnapshot } from "../../src/schemas/pikalytics";
import { seedLabmausDb, closeIfOpen } from "./labmaus-fixtures";

function snap(species: string, as_of: string): PikalyticsSnapshot {
  return {
    schema_version: 1,
    id: `pikalytics:gen9championsvgc2026regma:${species}:${as_of}`,
    format: "RegM-A",
    format_slug: "gen9championsvgc2026regma",
    species_roster_id: species,
    as_of,
    usage_percent: null,
    teammates: [{ roster_id: "sneasler", percent: 46.767 }],
    items: [{ name: "Choice Scarf", percent: 27.89 }],
    abilities: [{ name: "Rough Skin", percent: 93.852 }],
    moves: [{ name: "Earthquake", percent: 91.473 }],
    sample_size: null,
    source: {
      site: "pikalytics",
      source_url: `https://www.pikalytics.com/pokedex/gen9championsvgc2026regma/${species}`,
      ai_url: `https://www.pikalytics.com/ai/pokedex/gen9championsvgc2026regma/${species}`,
      fetched_at: "2026-05-07T12:00:00Z",
    },
  };
}

describe("pikalytics — Tera property test on persisted rows (PIKA-T43)", () => {
  it("PIKA-T43. no row in pikalytics_snapshots has any column or JSON key matching /tera/i", () => {
    const db = seedLabmausDb();
    try {
      pikalytics.upsertSnapshot(db, snap("garchomp", "2026-04-01"));
      pikalytics.upsertSnapshot(db, snap("sneasler", "2026-04-01"));

      // 1. Column-name property check.
      const cols = Object.keys(pikalyticsSnapshots);
      for (const c of cols) {
        expect(c).not.toMatch(/tera/i);
      }

      // 2. JSON-blob property check on every persisted row.
      const rows = db.$client
        .prepare("SELECT teammates_json, items_json, abilities_json, moves_json FROM pikalytics_snapshots")
        .all() as Array<Record<string, string>>;
      for (const r of rows) {
        for (const v of Object.values(r)) {
          expect(v).not.toMatch(/tera/i);
        }
      }
    } finally {
      closeIfOpen(db);
    }
  });
});
