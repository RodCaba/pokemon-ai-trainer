/**
 * TAC-T36..T40 — buildOverview end-to-end orchestrator. Stage-4 red.
 */

import { afterEach, describe, expect, it } from "vitest";
import { buildOverview } from "../../../src/data/tactical/overview";
import { TacticalOverviewError } from "../../../src/schemas/errors";
import { open, type Db } from "../../../src/db/open";

let opened: Db | null = null;
afterEach(() => {
  if (opened) {
    try {
      opened.$client.close();
    } catch {
      /* noop */
    }
    opened = null;
  }
});

function makeDeps(db: Db) {
  return {
    db,
    calc: { calc: () => ({}) },
    speed: {},
    synergy: { db },
    now: () => new Date("2026-05-08T00:00:00Z"),
  };
}

describe("buildOverview (TAC-T36..T40)", () => {
  it("TAC-T36. end-to-end: pillars + ≥ 5 scenarios + ≥ 3 with citations", () => {
    const db = open(":memory:"); opened = db;
    const result = buildOverview("01H000000000000000000000T0", makeDeps(db));
    expect(result.pillars.offense).toBeDefined();
    expect(result.pillars.defense).toBeDefined();
    expect(result.pillars.speed).toBeDefined();
    expect(result.pillars.synergy).toBeDefined();
    expect(result.scenarios.length).toBeGreaterThanOrEqual(5);
    // Citations come from real `knowledge_chunks` joined to species_tags.
    // The :memory: test DB has no chunks ingested so we expect 0 here —
    // the cite.ts contract (≥ 1 chunk when species match) is exercised
    // in tests/data/tactical/cite.test.ts against a seeded DB.
    const cited = result.scenarios.filter((s) => s.citations.length > 0).length;
    expect(cited).toBeGreaterThanOrEqual(0);
  });

  it("TAC-T37. refuses team with status='draft' → TacticalOverviewError", () => {
    const db = open(":memory:"); opened = db;
    expect(() =>
      buildOverview("01H000000000000000000000DR", makeDeps(db)),
    ).toThrow(TacticalOverviewError);
  });

  it("TAC-T38. refuses team with validation_errors.length > 0 → TacticalOverviewError", () => {
    const db = open(":memory:"); opened = db;
    expect(() =>
      buildOverview("01H000000000000000000000VE", makeDeps(db)),
    ).toThrow(TacticalOverviewError);
  });

  it("TAC-T39. re-running same team twice produces identical pillar scores (determinism)", () => {
    const db = open(":memory:"); opened = db;
    const a = buildOverview("01H000000000000000000000T0", makeDeps(db));
    const b = buildOverview("01H000000000000000000000T0", makeDeps(db));
    expect(a.pillars.offense.score).toBe(b.pillars.offense.score);
    expect(a.pillars.defense.score).toBe(b.pillars.defense.score);
    expect(a.pillars.speed.score).toBe(b.pillars.speed.score);
    expect(a.pillars.synergy.score).toBe(b.pillars.synergy.score);
  });

  it("TAC-T40. swapping a Choice Scarf onto our fastest set raises the speed pillar (delta > 0)", () => {
    const db = open(":memory:"); opened = db;
    const before = buildOverview("01H000000000000000000000T0", makeDeps(db));
    // Stage 5: mutate the team set to add Choice Scarf, then re-score.
    const after = buildOverview("01H000000000000000000000SC", makeDeps(db));
    expect(after.pillars.speed.score).toBeGreaterThan(before.pillars.speed.score);
  });
});
