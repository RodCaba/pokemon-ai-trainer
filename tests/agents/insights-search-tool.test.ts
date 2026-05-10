/**
 * YT-T50..YT-T51 — Stage 4 tests for the `insights_search` Anthropic tool.
 * Stage 4: every test fails because the underlying store throws "not implemented".
 */

import { describe, expect, it } from "vitest";
import {
  insightsSearchTool,
  invokeInsightsSearch,
} from "../../src/agents/insights-tools";
import { open } from "../../src/db/open";
import type { EmbedClient } from "../../src/tools/knowledge/embed";
import { z } from "zod";

function fakeEmbed(): EmbedClient {
  return {
    async embed(texts) {
      return texts.map(() => new Float32Array(512));
    },
  };
}

describe("agents/insights-tools (YT-T50..YT-T51)", () => {
  it("YT-T50a. tool definition exposes name=insights_search and a meaningful description", () => {
    expect(insightsSearchTool.name).toBe("insights_search");
    expect(insightsSearchTool.description.length).toBeGreaterThan(50);
  });

  it("YT-T50b. invokeInsightsSearch wires args → store.search and returns hits[]", async () => {
    const db = open(":memory:");
    try {
      const hits = await invokeInsightsSearch(
        { query: "garchomp lead", limit: 3 },
        { db, embedClient: fakeEmbed() },
      );
      expect(Array.isArray(hits)).toBe(true);
    } finally {
      db.$client.close();
    }
  });

  it("YT-T51a. input_schema rejects empty query", async () => {
    const db = open(":memory:");
    try {
      await expect(
        invokeInsightsSearch({ query: "" }, { db, embedClient: fakeEmbed() }),
      ).rejects.toBeInstanceOf(z.ZodError);
    } finally {
      db.$client.close();
    }
  });

  it("YT-T51b. input_schema rejects malformed claim_type", async () => {
    const db = open(":memory:");
    try {
      await expect(
        invokeInsightsSearch(
          { query: "x", claim_type: "not_a_real_claim_type" },
          { db, embedClient: fakeEmbed() },
        ),
      ).rejects.toBeInstanceOf(z.ZodError);
    } finally {
      db.$client.close();
    }
  });

  it("YT-T51c. species_id_filter passes valid id, rejects invalid", async () => {
    const db = open(":memory:");
    try {
      await expect(
        invokeInsightsSearch(
          { query: "x", species_id_filter: "INVALID UPPER CASE" },
          { db, embedClient: fakeEmbed() },
        ),
      ).rejects.toBeInstanceOf(z.ZodError);
    } finally {
      db.$client.close();
    }
  });
});
