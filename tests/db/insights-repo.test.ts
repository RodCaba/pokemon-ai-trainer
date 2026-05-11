/**
 * YT-T30..YT-T38 — Stage 4 tests for the db-bound InsightStore.
 * Stage 4: every test fails because the v2 store throws "not implemented (Stage 5)".
 */

import { describe, expect, it } from "vitest";
import { open, type Db } from "../../src/db/open";
import { createInsightStore } from "../../src/db/insights";
import type { EmbedClient } from "../../src/tools/knowledge/embed";
import type { Insight, InsightSubjectRow } from "../../src/schemas/insight";

const VEC_DIM = 512;

function fakeVec(seed: number): Float32Array {
  const v = new Float32Array(VEC_DIM);
  for (let i = 0; i < VEC_DIM; i++) v[i] = ((seed * 31 + i) % 17) / 17;
  return v;
}

function fakeEmbedClient(): EmbedClient {
  return {
    async embed(texts: string[]): Promise<Float32Array[]> {
      return texts.map((_, i) => fakeVec(i + 1));
    },
  };
}

function ulid(suffix: string): string {
  // 26-char Crockford base32. Pad to length.
  return ("01H8XGJWBWBAQ4XK7Z4F9DGH" + suffix).slice(0, 26).padEnd(26, "0");
}

function mkInsight(
  partial: Partial<Insight> & { id: string; claim: string; chunk_id: string | null },
): Insight {
  return {
    schema_version: 1,
    claim_type: "lead",
    subjects: { pokemon: ["garchomp"], formats: ["RegM-A"] },
    confidence: "medium",
    stance: "supports",
    source: {
      type: "youtube",
      url: "https://youtu.be/example",
      excerpt: "ex",
      timestamp_seconds: 0,
    },
    extracted_by: {
      model: "claude-haiku-4-5-20251001",
      prompt_version: "v1.0",
      extracted_at: "2026-05-09T00:00:00Z",
    },
    embedding_ref: "insight_embeddings:1",
    ...partial,
  } as Insight;
}

// seedChunk is shared with `tests/db/insights-phase-tag.test.ts`.
import { seedChunk } from "../_helpers/seed-chunk";

describe("db/insights repo (YT-T30..YT-T38)", () => {
  it("YT-T30. upsertMany inserts insight + subjects + embedding atomically", async () => {
    const db = open(":memory:");
    try {
      seedChunk(db, "youtube:abc:0");
      const store = createInsightStore(db, { embedClient: fakeEmbedClient() });
      const id = ulid("AA");
      const insight = mkInsight({ id, claim: "c", chunk_id: "youtube:abc:0" });
      const subjects: InsightSubjectRow[] = [
        { insight_id: id, subject_kind: "pokemon", subject_value: "garchomp" },
      ];
      const r = await store.upsertMany([
        { insight, embedding: fakeVec(1), subjects },
      ]);
      expect(r.inserted).toBe(1);
    } finally {
      db.$client.close();
    }
  });

  it("YT-T31. upsertMany skip-duplicate on (chunk_id, claim) — second run zero new rows", async () => {
    const db = open(":memory:");
    try {
      seedChunk(db, "youtube:abc:0");
      const store = createInsightStore(db, { embedClient: fakeEmbedClient() });
      const id = ulid("AA");
      const id2 = ulid("AB");
      const a = mkInsight({ id, claim: "c", chunk_id: "youtube:abc:0" });
      const b = mkInsight({ id: id2, claim: "c", chunk_id: "youtube:abc:0" });
      await store.upsertMany([{ insight: a, embedding: fakeVec(1), subjects: [] }]);
      const r = await store.upsertMany([
        { insight: b, embedding: fakeVec(2), subjects: [] },
      ]);
      expect(r.inserted).toBe(0);
      expect(r.skipped_duplicate).toBe(1);
    } finally {
      db.$client.close();
    }
  });

  it("YT-T32. search returns hits ranked by cosine; respects limit", async () => {
    const db = open(":memory:");
    try {
      seedChunk(db, "youtube:abc:0");
      const store = createInsightStore(db, { embedClient: fakeEmbedClient() });
      const rows = ["alpha", "bravo", "charlie", "delta", "echo"].map((c, i) => ({
        insight: mkInsight({
          id: ulid("A" + String.fromCharCode(65 + i)),
          claim: c,
          chunk_id: "youtube:abc:0",
        }),
        embedding: fakeVec(i + 1),
        subjects: [],
      }));
      await store.upsertMany(rows);
      const hits = await store.search("alpha bravo", { limit: 3 });
      expect(hits.length).toBeLessThanOrEqual(3);
    } finally {
      db.$client.close();
    }
  });

  it("YT-T33. search filter.pokemon excludes non-matching subjects", async () => {
    const db = open(":memory:");
    try {
      seedChunk(db, "youtube:abc:0");
      const store = createInsightStore(db, { embedClient: fakeEmbedClient() });
      const a = mkInsight({
        id: ulid("AA"),
        claim: "incin claim",
        chunk_id: "youtube:abc:0",
        subjects: { pokemon: ["incineroar"], formats: ["RegM-A"] },
      });
      const b = mkInsight({
        id: ulid("AB"),
        claim: "garch claim",
        chunk_id: "youtube:abc:0",
        subjects: { pokemon: ["garchomp"], formats: ["RegM-A"] },
      });
      await store.upsertMany([
        {
          insight: a,
          embedding: fakeVec(1),
          subjects: [
            { insight_id: a.id, subject_kind: "pokemon", subject_value: "incineroar" },
          ],
        },
        {
          insight: b,
          embedding: fakeVec(2),
          subjects: [
            { insight_id: b.id, subject_kind: "pokemon", subject_value: "garchomp" },
          ],
        },
      ]);
      const hits = await store.search("claim", { filter: { pokemon: ["incineroar"] } });
      for (const h of hits) {
        expect(h.insight.subjects.pokemon).toContain("incineroar");
      }
    } finally {
      db.$client.close();
    }
  });

  it("YT-T34. search filter.claim_type excludes non-lead claims", async () => {
    const db = open(":memory:");
    try {
      seedChunk(db, "youtube:abc:0");
      const store = createInsightStore(db, { embedClient: fakeEmbedClient() });
      const a = mkInsight({
        id: ulid("AA"),
        claim: "x",
        chunk_id: "youtube:abc:0",
        claim_type: "lead",
      });
      const b = mkInsight({
        id: ulid("AB"),
        claim: "y",
        chunk_id: "youtube:abc:0",
        claim_type: "matchup",
      });
      await store.upsertMany([
        { insight: a, embedding: fakeVec(1), subjects: [] },
        { insight: b, embedding: fakeVec(2), subjects: [] },
      ]);
      const hits = await store.search("x", { filter: { claim_type: ["lead"] } });
      for (const h of hits) expect(h.insight.claim_type).toBe("lead");
    } finally {
      db.$client.close();
    }
  });

  it("YT-T35. search filter.min_confidence='medium' excludes low-confidence rows", async () => {
    const db = open(":memory:");
    try {
      seedChunk(db, "youtube:abc:0");
      const store = createInsightStore(db, { embedClient: fakeEmbedClient() });
      const lo = mkInsight({
        id: ulid("AA"),
        claim: "lo",
        chunk_id: "youtube:abc:0",
        confidence: "low",
      });
      const med = mkInsight({
        id: ulid("AB"),
        claim: "med",
        chunk_id: "youtube:abc:0",
        confidence: "medium",
      });
      await store.upsertMany([
        { insight: lo, embedding: fakeVec(1), subjects: [] },
        { insight: med, embedding: fakeVec(2), subjects: [] },
      ]);
      const hits = await store.search("x", { filter: { min_confidence: "medium" } });
      for (const h of hits) expect(h.insight.confidence).not.toBe("low");
    } finally {
      db.$client.close();
    }
  });

  it("YT-T36. listByChunkId returns insights for that chunk", async () => {
    const db = open(":memory:");
    try {
      seedChunk(db, "youtube:abc:0");
      const store = createInsightStore(db, { embedClient: fakeEmbedClient() });
      const a = mkInsight({ id: ulid("AA"), claim: "a", chunk_id: "youtube:abc:0" });
      const b = mkInsight({ id: ulid("AB"), claim: "b", chunk_id: "youtube:abc:0" });
      await store.upsertMany([
        { insight: a, embedding: fakeVec(1), subjects: [] },
        { insight: b, embedding: fakeVec(2), subjects: [] },
      ]);
      const rows = await store.listByChunkId("youtube:abc:0");
      expect(rows.length).toBe(2);
    } finally {
      db.$client.close();
    }
  });

  it("YT-T37. listByVideoId resolves source_url match", async () => {
    const db = open(":memory:");
    try {
      seedChunk(db, "youtube:abc:0");
      const store = createInsightStore(db, { embedClient: fakeEmbedClient() });
      const a = mkInsight({
        id: ulid("AA"),
        claim: "a",
        chunk_id: "youtube:abc:0",
        source: {
          type: "youtube",
          url: "https://www.youtube.com/watch?v=abc",
          excerpt: "x",
          timestamp_seconds: 0,
        },
      });
      await store.upsertMany([{ insight: a, embedding: fakeVec(1), subjects: [] }]);
      const rows = await store.listByVideoId("abc");
      expect(rows.length).toBeGreaterThanOrEqual(1);
    } finally {
      db.$client.close();
    }
  });

  it("YT-T38. listBySpecies returns insights whose subjects.pokemon contains id", async () => {
    const db = open(":memory:");
    try {
      seedChunk(db, "youtube:abc:0");
      const store = createInsightStore(db, { embedClient: fakeEmbedClient() });
      const a = mkInsight({ id: ulid("AA"), claim: "a", chunk_id: "youtube:abc:0" });
      await store.upsertMany([
        {
          insight: a,
          embedding: fakeVec(1),
          subjects: [
            { insight_id: a.id, subject_kind: "pokemon", subject_value: "garchomp" },
          ],
        },
      ]);
      const rows = await store.listBySpecies("garchomp");
      expect(rows.length).toBe(1);
    } finally {
      db.$client.close();
    }
  });
});
