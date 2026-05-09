/**
 * TAC-T31..T32 — findCitations. Stage-4 red.
 */

import { afterEach, describe, expect, it } from "vitest";
import { findCitations } from "../../../src/data/tactical/cite";
import type { ScenarioOverview } from "../../../src/schemas/tactical";
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

const SCENARIO = {} as ScenarioOverview;

describe("findCitations (TAC-T31..T32)", () => {
  it("TAC-T31. returns ≤ 3 chunks with species_ids overlapping the scenario species", () => {
    const db = open(":memory:"); opened = db;
    const result = findCitations(SCENARIO, ["incineroar", "amoonguss"], {
      db,
    });
    expect(result.length).toBeLessThanOrEqual(3);
    for (const c of result) {
      expect(
        c.species_ids.includes("incineroar") ||
          c.species_ids.includes("amoonguss"),
      ).toBe(true);
    }
  });

  it("TAC-T32. empty result when no chunk matches; does NOT throw", () => {
    const db = open(":memory:"); opened = db;
    expect(() =>
      findCitations(SCENARIO, ["nonexistent-species", "another-fake"], { db }),
    ).not.toThrow();
  });
});
