/**
 * Stage 4 — RED tests for the recommend_team_plan agent tool (T1..T5).
 *
 * Q8 §17: this tool REPLACES `recommend_leads`. Tests both presence of
 * the new tool and removal of the old one.
 */

import { describe, expect, it } from "vitest";
import {
  recommendTeamPlanTool,
  handleRecommendTeamPlan,
  tacticalToolHandlers,
} from "../../src/agents/tactical-tools";
import { open } from "../../src/db/open";
import {
  RecommendTeamPlanOutputSchema,
  TeamPlanScenarioSchema,
} from "../../src/schemas/tactical";

describe("recommend_team_plan agent tool (T1..T5)", () => {
  it("T1. tool definition exposes name = recommend_team_plan + JSON-Schema input", () => {
    expect(recommendTeamPlanTool.name).toBe("recommend_team_plan");
    const schema = recommendTeamPlanTool.input_schema as { properties?: Record<string, unknown> };
    expect(schema.properties).toBeDefined();
    expect(schema.properties?.team_id).toBeDefined();
    expect(schema.properties?.scenario_name).toBeDefined();
  });

  it("T2. tool description mentions 'plan' / 'phase' (so the model knows when to call it)", () => {
    const desc = recommendTeamPlanTool.description ?? "";
    expect(desc.length).toBeGreaterThan(40);
    expect(desc.toLowerCase()).toMatch(/plan|phase/);
  });

  it("T3. handleRecommendTeamPlan dispatches to the new module + returns parseable output", () => {
    const db = open(":memory:");
    try {
      const out = handleRecommendTeamPlan(
        { team_id: "01H000000000000000000000T0" },
        {
          db,
          calc: { calc: () => ({}) },
          speed: {},
          synergy: { db },
          now: () => new Date("2026-05-11T00:00:00Z"),
        },
      );
      const r = RecommendTeamPlanOutputSchema.safeParse(out);
      expect(r.success).toBe(true);
    } finally {
      db.$client.close();
    }
  });

  it("T4. tacticalToolHandlers maps the new tool name + the old `recommend_leads` is gone", () => {
    expect(tacticalToolHandlers).toHaveProperty("recommend_team_plan");
    expect(tacticalToolHandlers).not.toHaveProperty("recommend_leads");
  });

  it("T5. handler returns one scenario when scenario_name matches", () => {
    const db = open(":memory:");
    try {
      const out = handleRecommendTeamPlan(
        { team_id: "01H000000000000000000000T0", scenario_name: "Sun" },
        {
          db,
          calc: { calc: () => ({}) },
          speed: {},
          synergy: { db },
          now: () => new Date("2026-05-11T00:00:00Z"),
        },
      );
      expect(out.scenarios).toHaveLength(1);
      const r = TeamPlanScenarioSchema.safeParse(out.scenarios[0]);
      expect(r.success).toBe(true);
    } finally {
      db.$client.close();
    }
  });
});
