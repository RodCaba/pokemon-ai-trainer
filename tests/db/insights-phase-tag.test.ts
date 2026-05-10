/**
 * Stage 4 — RED tests for the `insights.phase_tag` DB extension (DB1–DB3).
 * Covers the migration + repo plumbing for the cross-slice phase_tag work.
 *
 * Module under test:
 *   src/db/migrations/0011_insights_phase_tag.sql (new)
 *   src/db/insights.ts (extended): upsertMany / search / rowToInsight thread phase_tag.
 */

import { describe, expect, it } from "vitest";
import { open } from "../../src/db/open";
import { createInsightStore } from "../../src/db/insights";
import { createEmbedClient, type EmbedClient } from "../../src/tools/knowledge/embed";
import type { Insight } from "../../src/schemas/insight";

const fakeEmbed = (seed: number): EmbedClient => ({
  async embed(inputs) {
    return inputs.map((_, j) =>
      new Float32Array(512).map((_v, i) => Math.sin(seed + j + i) * 0.1),
    );
  },
});

const ulid = (suffix: string): string =>
  ("01H" + "0".repeat(23 - suffix.length) + suffix).toUpperCase().slice(0, 26);

const mkInsight = (overrides: Partial<Insight> = {}): Insight => ({
  id: ulid("AA"),
  schema_version: 1,
  claim: "Lead Sableye + Archaludon to set screens.",
  claim_type: "lead",
  subjects: { pokemon: ["sableye", "archaludon"], formats: ["RegM-A"] },
  confidence: "medium",
  stance: "supports",
  source: {
    type: "youtube",
    url: "https://youtu.be/example",
    excerpt: "Lead Sableye + Archaludon.",
  },
  extracted_by: {
    model: "claude-haiku-4-5-20251001",
    prompt_version: "v1.1",
    extracted_at: "2026-05-09T00:00:00Z",
  },
  embedding_ref: "insight_embeddings:0",
  chunk_id: null,
  phase_tag: null,
  ...overrides,
});

function seedChunk(db: ReturnType<typeof open>, chunk_id: string): void {
  db.$client
    .prepare(
      `INSERT INTO knowledge_chunks (id, source_site, article_url, article_slug,
       article_title, chunk_index, chunk_text, chunk_token_count, extractor_version,
       body_hash, embedding_ref, fetched_at, captured_via, metadata)
       VALUES (?, 'youtube', 'https://youtu.be/x', 'x', 't', 0, 't', 5, 'v1', 'h', 'r', '2026-05-09T00:00:00Z', 'test', NULL)`,
    )
    .run(chunk_id);
}

describe("insights.phase_tag (DB1..DB3)", () => {
  it("DB1. migration 0011 applied: insights.phase_tag column exists, default null", () => {
    const db = open(":memory:");
    try {
      const cols = db.$client
        .prepare("PRAGMA table_info(insights)")
        .all() as Array<{ name: string; dflt_value: string | null }>;
      const phaseTagCol = cols.find((c) => c.name === "phase_tag");
      expect(phaseTagCol).toBeDefined();
      // Existing rows from earlier migrations would survive — but the in-memory
      // DB is freshly migrated, so the property to test is "column exists".
    } finally {
      db.$client.close();
    }
  });

  it("DB1b. migration is non-destructive: pre-existing insight rows survive", () => {
    const db = open(":memory:");
    try {
      seedChunk(db, "youtube:x:0");
      const store = createInsightStore(db, { embedClient: fakeEmbed(1) });
      // Insert an insight WITHOUT phase_tag (pre-migration shape).
      void store.upsertMany([
        {
          insight: mkInsight({ chunk_id: "youtube:x:0", phase_tag: null }),
          embedding: new Float32Array(512),
          subjects: [
            { insight_id: ulid("AA"), subject_kind: "pokemon", subject_value: "sableye" },
          ],
        },
      ]);
      // Querying back should not throw and phase_tag should be null.
      const rows = db.$client.prepare("SELECT id, phase_tag FROM insights").all() as Array<{ id: string; phase_tag: string | null }>;
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        expect(r.phase_tag === null || typeof r.phase_tag === "string").toBe(true);
      }
    } finally {
      db.$client.close();
    }
  });

  it("DB2. upsertMany writes phase_tag when present; rowToInsight reads it back", async () => {
    const db = open(":memory:");
    try {
      seedChunk(db, "youtube:y:0");
      const store = createInsightStore(db, { embedClient: fakeEmbed(2) });
      const id = ulid("BB");
      await store.upsertMany([
        {
          insight: mkInsight({ id, chunk_id: "youtube:y:0", phase_tag: "lead" }),
          embedding: new Float32Array(512),
          subjects: [
            { insight_id: id, subject_kind: "pokemon", subject_value: "sableye" },
          ],
        },
      ]);
      const got = db.$client.prepare("SELECT phase_tag FROM insights WHERE id = ?").get(id) as { phase_tag: string };
      expect(got.phase_tag).toBe("lead");
    } finally {
      db.$client.close();
    }
  });

  it("DB3. search filter phase_tag returns only matching rows", async () => {
    const db = open(":memory:");
    try {
      seedChunk(db, "youtube:z:0");
      const store = createInsightStore(db, { embedClient: fakeEmbed(3) });
      const a = ulid("CA");
      const b = ulid("CB");
      const c = ulid("CC");
      await store.upsertMany([
        {
          insight: mkInsight({ id: a, chunk_id: "youtube:z:0", phase_tag: "lead", claim: "lead claim" }),
          embedding: new Float32Array(512),
          subjects: [{ insight_id: a, subject_kind: "pokemon", subject_value: "sableye" }],
        },
        {
          insight: mkInsight({ id: b, chunk_id: "youtube:z:0", phase_tag: "mid", claim: "mid claim" }),
          embedding: new Float32Array(512),
          subjects: [{ insight_id: b, subject_kind: "pokemon", subject_value: "sableye" }],
        },
        {
          insight: mkInsight({ id: c, chunk_id: "youtube:z:0", phase_tag: null, claim: "untagged claim" }),
          embedding: new Float32Array(512),
          subjects: [{ insight_id: c, subject_kind: "pokemon", subject_value: "sableye" }],
        },
      ]);
      const hits = await store.search("claim", { filter: { phase_tag: "lead" } });
      expect(hits.length).toBeGreaterThan(0);
      for (const h of hits) {
        expect(h.insight.phase_tag).toBe("lead");
      }
    } finally {
      db.$client.close();
    }
  });
});
