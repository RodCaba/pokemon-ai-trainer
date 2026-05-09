/**
 * TAC-T25..T27 — scenario generation incl. weakness-counter (Q2/Q4 bindings).
 * Stage-4 red.
 */

import { afterEach, describe, expect, it } from "vitest";
import { generateScenarios } from "../../../src/data/tactical/scenarios";
import { createCalcCache } from "../../../src/data/tactical/calc-cache";
import type { ThreatPanel } from "../../../src/schemas/tactical";
import type { UserTeam } from "../../../src/schemas/user-teams";
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

const PANEL = {} as ThreatPanel;
const TEAM = {} as UserTeam;

describe("generateScenarios (TAC-T25..T27)", () => {
  it("TAC-T25. generates 5–7 scenarios; ≥ 3 archetype + 2–4 individual", () => {
    const db = open(":memory:"); opened = db;
    const cache = createCalcCache();
    const scenarios = generateScenarios({
      db,
      panel: PANEL,
      team: TEAM,
      calcCache: cache,
    });
    expect(scenarios.length).toBeGreaterThanOrEqual(5);
    expect(scenarios.length).toBeLessThanOrEqual(7);
    const archetype = scenarios.filter((s) => s.type === "archetype").length;
    const individual = scenarios.filter((s) => s.type === "individual").length;
    expect(archetype).toBeGreaterThanOrEqual(3);
    expect(individual).toBeGreaterThanOrEqual(2);
    expect(individual).toBeLessThanOrEqual(4);
  });

  it("TAC-T26. weakness-counter scenario surfaces with name 'vs <species> (counter)' (Q4 binding)", () => {
    const db = open(":memory:"); opened = db;
    const cache = createCalcCache();
    const scenarios = generateScenarios({
      db,
      panel: PANEL,
      team: TEAM,
      calcCache: cache,
    });
    const wc = scenarios.find((s) => s.type === "weakness_counter");
    expect(wc).toBeDefined();
    expect(wc!.name).toMatch(/^vs .+ \(counter\)$/);
  });

  it("TAC-T27. weakness-detection threshold tunable via deps (weakness_ohko_ratio)", () => {
    const db = open(":memory:"); opened = db;
    const cache = createCalcCache();
    const lax = generateScenarios({
      db,
      panel: PANEL,
      team: TEAM,
      calcCache: cache,
      weakness_ohko_ratio: 0.1, // very low threshold → likely emit
    });
    const strict = generateScenarios({
      db,
      panel: PANEL,
      team: TEAM,
      calcCache: cache,
      weakness_ohko_ratio: 0.99, // very high threshold → none emit
    });
    const laxCount = lax.filter((s) => s.type === "weakness_counter").length;
    const strictCount = strict.filter((s) => s.type === "weakness_counter").length;
    expect(laxCount).toBeGreaterThanOrEqual(strictCount);
  });
});
