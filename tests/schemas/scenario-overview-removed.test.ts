/**
 * Stage 4 — RED tests for Stage B removal regression (RM1..RM3).
 * Q5 §17: ScenarioOverviewSchema is removed in the Stage-5 green commit.
 * Q7 §17: recommend_leads tool definition + handler are removed.
 * Q4 §17: src/data/tactical/recommend-leads.ts is deleted.
 *
 * These tests fail today (the symbols still exist as @deprecated
 * scaffolding) and turn green once Stage 5 deletes them.
 */

import { describe, expect, it } from "vitest";

describe("Stage A surface removal (RM1..RM3)", () => {
  it("RM1. ScenarioOverviewSchema is no longer exported from src/schemas/tactical.ts", async () => {
    const mod = await import("../../src/schemas/tactical");
    expect((mod as Record<string, unknown>).ScenarioOverviewSchema).toBeUndefined();
    expect((mod as Record<string, unknown>).RecommendLeadsInputSchema).toBeUndefined();
    expect((mod as Record<string, unknown>).RecommendLeadsOutputSchema).toBeUndefined();
  });

  it("RM2. recommend-leads handler / tool no longer exported from tactical-tools", async () => {
    const mod = await import("../../src/agents/tactical-tools");
    expect((mod as Record<string, unknown>).recommendLeadsTool).toBeUndefined();
    expect((mod as Record<string, unknown>).handleRecommendLeads).toBeUndefined();
  });

  it("RM3. src/data/tactical/recommend-leads.ts is removed (import throws)", async () => {
    // Stage 5 deletes the file; Stage 4 keeps it as scaffolding so this
    // assertion fails today.
    let threw = false;
    try {
      await import("../../src/data/tactical/recommend-leads");
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});
