import { describe, expect, it } from "vitest";
import { createInsightStore, type InsightStore, type InsightSearchHit } from "../../src/db/insights";
import { NotImplementedError } from "../../src/schemas/errors";
import type { Insight } from "../../src/schemas/insight";

const validInsight: Insight = {
  id: "01H8XGJWBWBAQ4XK7Z4F9DGH4P",
  schema_version: 1,
  claim: "Garchomp commonly leads with Earthquake to pressure Steel + Rock targets.",
  claim_type: "lead",
  subjects: { pokemon: ["garchomp"], formats: ["RegM-A"] },
  confidence: "medium",
  stance: "supports",
  source: {
    type: "youtube",
    url: "https://youtu.be/example",
    excerpt: "Garchomp leads with Earthquake.",
  },
  extracted_by: {
    model: "claude-opus-4-7",
    prompt_version: "v1",
    extracted_at: "2026-05-04T00:00:00Z",
  },
  embedding_ref: "vec_garchomp_lead_001",
};

describe("insights — v1 stub", () => {
  it("1. createInsightStore() returns an object satisfying the InsightStore interface", () => {
    const store = createInsightStore() satisfies InsightStore;
    expect(typeof store.add).toBe("function");
    expect(typeof store.search).toBe("function");
  });

  it("2. .add(validInsight) throws NotImplementedError", async () => {
    const store = createInsightStore();
    await expect(store.add(validInsight)).rejects.toBeInstanceOf(NotImplementedError);
  });

  it("3. .search('query') throws NotImplementedError", async () => {
    const store = createInsightStore();
    await expect(store.search("how do I lead Garchomp")).rejects.toBeInstanceOf(NotImplementedError);
  });

  it("4. NotImplementedError.message mentions 'v1 stub'", async () => {
    const store = createInsightStore();
    let err: unknown;
    try {
      await store.add(validInsight);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(NotImplementedError);
    expect((err as Error).message).toMatch(/v1 stub/);
  });

  it("5. InsightStore shape is structurally callable from a future ingest tool", () => {
    // Compile-time + runtime assertion that any consumer typed against InsightStore
    // can hand off the stub without changes once the real backing store lands.
    function ingestOne(store: InsightStore, insight: Insight): Promise<void> {
      return store.add(insight);
    }
    function searchAll(store: InsightStore, query: string): Promise<InsightSearchHit[]> {
      return store.search(query);
    }
    const store = createInsightStore();
    // The functions take `InsightStore`, the stub satisfies it — no cast needed.
    expect(typeof ingestOne).toBe("function");
    expect(typeof searchAll).toBe("function");
    // And calling them yields rejected promises (stub behavior).
    return Promise.all([
      expect(ingestOne(store, validInsight)).rejects.toBeInstanceOf(NotImplementedError),
      expect(searchAll(store, "x")).rejects.toBeInstanceOf(NotImplementedError),
    ]);
  });
});
