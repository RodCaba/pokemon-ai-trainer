/**
 * TAC-T41..T43 — Anthropic agent tool surface for tactical slice (Q8 binding).
 * Stage-4 red.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  TACTICAL_TOOL_DEFINITIONS,
  recommendLeadsTool,
  scorePillarsTool,
  tacticalToolHandlers,
} from "../../src/agents/tactical-tools";
import { open, type Db } from "../../src/db/open";

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
  };
}

describe("tactical agent tool surface (TAC-T41..T43)", () => {
  it("TAC-T41. catalog includes score_pillars + the Stage B recommend_team_plan (Stage A recommend_leads still present during transition)", () => {
    const names = TACTICAL_TOOL_DEFINITIONS.map((t) => t.name).sort();
    expect(names).toContain("score_pillars");
    expect(names).toContain("recommend_team_plan");
    // Note: `recommend_leads` is still in the catalog during Stage 4 →
    // 5 transition; the RM2 regression test in
    // tests/schemas/scenario-overview-removed.test.ts pins its removal.
    for (const t of [scorePillarsTool, recommendLeadsTool]) {
      expect(t.input_schema).toBeDefined();
      const schema = t.input_schema as {
        additionalProperties?: boolean;
        required?: string[];
      };
      expect(schema.additionalProperties).toBe(false);
      expect(schema.required).toContain("team_id");
    }
  });

  it("TAC-T42. score_pillars handler invokable end-to-end on a fixture-seeded DB", () => {
    const db = open(":memory:"); opened = db;
    const result = tacticalToolHandlers.score_pillars(
      { team_id: "01H000000000000000000000T0" },
      makeDeps(db),
    );
    expect(result.team_id).toBe("01H000000000000000000000T0");
    expect(result.pillars.offense.pillar).toBe("offense");
    expect(typeof result.threat_panel_as_of).toBe("string");
  });

  it("TAC-T43. recommend_leads with scenario_name returns one scenario; without returns all", () => {
    const db = open(":memory:"); opened = db;
    const all = tacticalToolHandlers.recommend_leads(
      { team_id: "01H000000000000000000000T0" },
      makeDeps(db),
    );
    expect(all.scenarios.length).toBeGreaterThanOrEqual(5);

    // Pick the first scenario that's actually emitted — archetype set is
    // data-driven now (Sun isn't guaranteed without a Drought setter in
    // pikalytics). Use the actual name from `all.scenarios[0]`.
    const targetName = all.scenarios[0]!.name;
    const single = tacticalToolHandlers.recommend_leads(
      { team_id: "01H000000000000000000000T0", scenario_name: targetName },
      makeDeps(db),
    );
    expect(single.scenarios.length).toBe(1);
    expect(single.scenarios[0]!.name).toBe(targetName);
  });
});
