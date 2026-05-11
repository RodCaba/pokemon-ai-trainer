/**
 * Stage 4 — RED tests for the overview wire-up (OV1..OV4).
 *
 * Plan §10 / §11.6: buildOverview must emit `schema_version: 3` and
 * `scenarios: TeamPlanScenario[]` once Stage B's recommend-plan is the
 * inner loop. Stage 5 wires it; Stage 4 pins the contract here.
 */

import { describe, expect, it } from "vitest";
import { buildOverview } from "../../../src/data/tactical/overview";
import { open } from "../../../src/db/open";
import {
  TeamTacticalOverviewSchema,
  TeamPlanScenarioSchema,
} from "../../../src/schemas/tactical";

function makeDeps(db: ReturnType<typeof open>): Parameters<typeof buildOverview>[1] {
  return {
    db,
    calc: { calc: () => ({}) },
    speed: {},
    synergy: { db },
    now: () => new Date("2026-05-11T00:00:00Z"),
  };
}

describe("buildOverview Stage B wire-up (OV1..OV4)", () => {
  it("OV1. schema_version is 3 after Stage B", () => {
    const db = open(":memory:");
    try {
      const out = buildOverview("01H000000000000000000000T0", makeDeps(db));
      expect(out.schema_version).toBe(3);
    } finally {
      db.$client.close();
    }
  });

  it("OV2. scenarios array is TeamPlanScenario[]; each parses TeamPlanScenarioSchema", () => {
    const db = open(":memory:");
    try {
      const out = buildOverview("01H000000000000000000000T0", makeDeps(db));
      for (const sc of out.scenarios) {
        const r = TeamPlanScenarioSchema.safeParse(sc);
        expect(r.success).toBe(true);
      }
    } finally {
      db.$client.close();
    }
  });

  it("OV3. top-level overview round-trips TeamTacticalOverviewSchema", () => {
    const db = open(":memory:");
    try {
      const out = buildOverview("01H000000000000000000000T0", makeDeps(db));
      const r = TeamTacticalOverviewSchema.safeParse(out);
      expect(r.success).toBe(true);
    } finally {
      db.$client.close();
    }
  });

  it("OV4. each scenario has phases [lead, mid, late] in order", () => {
    const db = open(":memory:");
    try {
      const out = buildOverview("01H000000000000000000000T0", makeDeps(db));
      for (const sc of out.scenarios) {
        const phases = (sc as { phases: Array<{ phase: string }> }).phases;
        expect(phases).toBeDefined();
        expect(phases).toHaveLength(3);
        expect(phases[0]?.phase).toBe("lead");
        expect(phases[1]?.phase).toBe("mid");
        expect(phases[2]?.phase).toBe("late");
      }
    } finally {
      db.$client.close();
    }
  });
});
