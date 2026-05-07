/**
 * PIKA-T1–PIKA-T6 — zod schema round-trip + invariant tests.
 * Per CLAUDE.md §3 pure-data exemption: schemas land green; these tests lock
 * the contract.
 */

import { describe, expect, it } from "vitest";
import {
  PikalyticsSnapshotSchema,
  PikalyticsUsageArgsSchema,
  TeammateEntrySchema,
  type PikalyticsSnapshot,
} from "../../src/schemas/pikalytics";

function baseSnapshot(): PikalyticsSnapshot {
  return {
    schema_version: 1,
    id: "pikalytics:gen9championsvgc2026regma:garchomp:2026-04-01",
    format: "RegM-A",
    format_slug: "gen9championsvgc2026regma",
    species_roster_id: "garchomp",
    as_of: "2026-04-01",
    usage_percent: null,
    teammates: [
      { roster_id: "sneasler", percent: 46.767 },
      { roster_id: "kingambit", percent: 45.485 },
    ],
    items: [{ name: "Choice Scarf", percent: 27.89 }],
    abilities: [{ name: "Rough Skin", percent: 93.852 }],
    moves: [{ name: "Earthquake", percent: 91.473 }],
    sample_size: null,
    source: {
      site: "pikalytics",
      source_url:
        "https://www.pikalytics.com/pokedex/gen9championsvgc2026regma/Garchomp",
      ai_url:
        "https://www.pikalytics.com/ai/pokedex/gen9championsvgc2026regma/Garchomp",
      fetched_at: "2026-05-07T12:00:00Z",
    },
  };
}

describe("PikalyticsSnapshotSchema (PIKA-T1–PIKA-T4, PIKA-T6)", () => {
  it("PIKA-T1. parses a representative Garchomp-shaped snapshot", () => {
    const parsed = PikalyticsSnapshotSchema.parse(baseSnapshot());
    expect(parsed.species_roster_id).toBe("garchomp");
    expect(parsed.teammates.length).toBeGreaterThan(0);
    expect(parsed.items.length).toBeGreaterThan(0);
    expect(parsed.abilities.length).toBeGreaterThan(0);
    expect(parsed.moves.length).toBeGreaterThan(0);
  });

  it("PIKA-T2. rejects any tera_* field via .strict()", () => {
    const bad = { ...baseSnapshot(), tera_type: "Fire" } as unknown;
    const result = PikalyticsSnapshotSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("PIKA-T3. accepts empty teammates / items / abilities / moves", () => {
    const empty: PikalyticsSnapshot = {
      ...baseSnapshot(),
      teammates: [],
      items: [],
      abilities: [],
      moves: [],
    };
    expect(() => PikalyticsSnapshotSchema.parse(empty)).not.toThrow();
  });

  it("PIKA-T4. rejects format != RegM-A", () => {
    const bad = { ...baseSnapshot(), format: "RegM-B" } as unknown;
    const result = PikalyticsSnapshotSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("PIKA-T6. TeammateEntrySchema clamps percent to [0,100]", () => {
    expect(TeammateEntrySchema.safeParse({ roster_id: "garchomp", percent: 0 }).success).toBe(true);
    expect(TeammateEntrySchema.safeParse({ roster_id: "garchomp", percent: 100 }).success).toBe(true);
    expect(TeammateEntrySchema.safeParse({ roster_id: "garchomp", percent: 120 }).success).toBe(false);
    expect(TeammateEntrySchema.safeParse({ roster_id: "garchomp", percent: -1 }).success).toBe(false);
  });
});

describe("PikalyticsUsageArgsSchema (PIKA-T5)", () => {
  it("PIKA-T5. requires species when dimension != 'species'", () => {
    expect(
      PikalyticsUsageArgsSchema.safeParse({ format: "RegM-A", dimension: "item" }).success,
    ).toBe(false);
    expect(
      PikalyticsUsageArgsSchema.safeParse({
        format: "RegM-A",
        dimension: "item",
        species: "garchomp",
      }).success,
    ).toBe(true);
    expect(
      PikalyticsUsageArgsSchema.safeParse({ format: "RegM-A", dimension: "species" }).success,
    ).toBe(true);
  });
});
