/**
 * Stage 4 — RED tests for the phase_tag backfill script (Q12 §17).
 *
 * The script re-runs Stage A's Haiku extractor over insights with
 * `phase_tag IS NULL`, parses the emitted `phase_tag`, and updates the
 * insights row in place. Idempotent — re-running on a fully-tagged DB
 * is a no-op.
 *
 * Module under test (Stage 5): `scripts/data/backfill-phase-tag.ts`.
 */

import { describe, expect, it } from "vitest";
import { open } from "../../src/db/open";
import { createInsightStore } from "../../src/db/insights";
import type { EmbedClient } from "../../src/tools/knowledge/embed";
import type { Insight } from "../../src/schemas/insight";
import { seedChunk } from "../_helpers/seed-chunk";

// Re-import the backfill `main` at test time (after Stage 5 lands it).
async function callBackfill(args: {
  db: ReturnType<typeof open>;
  embedClient: EmbedClient;
  anthropic: { messages: { create(_args: unknown): Promise<unknown> } };
}): Promise<{ scanned: number; tagged: number; skipped: number }> {
  const mod = await import("../../scripts/data/backfill-phase-tag");
  type BackfillMain = (deps: {
    db: ReturnType<typeof open>;
    embedClient: EmbedClient;
    anthropic: { messages: { create(_args: unknown): Promise<unknown> } };
  }) => Promise<{ scanned: number; tagged: number; skipped: number }>;
  const main = (mod as unknown as { main: BackfillMain }).main;
  return main(args);
}

const fakeEmbed: EmbedClient = {
  async embed(texts) {
    return texts.map(() => new Float32Array(512));
  },
};

const tagInsight = (id: string, phase: "lead" | "mid" | "late"): unknown => ({
  content: [
    {
      type: "tool_use",
      name: "classify_phase",
      input: { phase_tag: phase },
    },
  ],
});

function mkInsight(id: string, chunk_id: string, phase_tag: Insight["phase_tag"]): Insight {
  return {
    id,
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
    chunk_id,
    phase_tag,
  };
}

describe("backfill-phase-tag (Q12 §17)", () => {
  it("BF1. seeds NULL-tag insights → backfill flips them to lead/mid/late", async () => {
    const db = open(":memory:");
    try {
      seedChunk(db, "youtube:abc:0");
      const store = createInsightStore(db, { embedClient: fakeEmbed });
      const id = "01H8XGJWBWBAQ4XK7Z4F9DGH4P";
      await store.upsertMany([
        {
          insight: mkInsight(id, "youtube:abc:0", null),
          embedding: new Float32Array(512),
          subjects: [{ insight_id: id, subject_kind: "pokemon", subject_value: "sableye" }],
        },
      ]);
      const anthropic = {
        async messages() { return tagInsight(id, "lead"); },
        // Anthropic SDK uses .messages.create not .messages directly.
      };
      const result = await callBackfill({
        db,
        embedClient: fakeEmbed,
        anthropic: {
          messages: { async create(_args: unknown) { return tagInsight(id, "lead"); } },
        },
      });
      expect(result.scanned).toBe(1);
      expect(result.tagged).toBe(1);
      const row = db.$client.prepare("SELECT phase_tag FROM insights WHERE id = ?").get(id) as { phase_tag: string };
      expect(row.phase_tag).toBe("lead");
    } finally {
      db.$client.close();
    }
  });

  it("BF2. idempotent: skips rows whose phase_tag is already set", async () => {
    const db = open(":memory:");
    try {
      seedChunk(db, "youtube:def:0");
      const store = createInsightStore(db, { embedClient: fakeEmbed });
      const id = "01H8XGJWBWBAQ4XK7Z4F9DGH4Q";
      await store.upsertMany([
        {
          insight: mkInsight(id, "youtube:def:0", "lead"),
          embedding: new Float32Array(512),
          subjects: [{ insight_id: id, subject_kind: "pokemon", subject_value: "sableye" }],
        },
      ]);
      const result = await callBackfill({
        db,
        embedClient: fakeEmbed,
        anthropic: {
          messages: { async create(_args: unknown) { return tagInsight(id, "mid"); } },
        },
      });
      expect(result.scanned).toBe(0);
      expect(result.tagged).toBe(0);
      expect(result.skipped).toBeGreaterThanOrEqual(1);
      // Pre-existing tag must be preserved.
      const row = db.$client.prepare("SELECT phase_tag FROM insights WHERE id = ?").get(id) as { phase_tag: string };
      expect(row.phase_tag).toBe("lead");
    } finally {
      db.$client.close();
    }
  });

  it("BF3. an Anthropic-emitted non-enum value falls back to NULL (no write)", async () => {
    const db = open(":memory:");
    try {
      seedChunk(db, "youtube:ghi:0");
      const store = createInsightStore(db, { embedClient: fakeEmbed });
      const id = "01H8XGJWBWBAQ4XK7Z4F9DGH4R";
      await store.upsertMany([
        {
          insight: mkInsight(id, "youtube:ghi:0", null),
          embedding: new Float32Array(512),
          subjects: [{ insight_id: id, subject_kind: "pokemon", subject_value: "sableye" }],
        },
      ]);
      const result = await callBackfill({
        db,
        embedClient: fakeEmbed,
        anthropic: {
          messages: {
            async create(_args: unknown) {
              return {
                content: [
                  { type: "tool_use", name: "classify_phase", input: { phase_tag: "midgame" } },
                ],
              };
            },
          },
        },
      });
      expect(result.scanned).toBe(1);
      expect(result.tagged).toBe(0);
      const row = db.$client.prepare("SELECT phase_tag FROM insights WHERE id = ?").get(id) as { phase_tag: string | null };
      expect(row.phase_tag).toBeNull();
    } finally {
      db.$client.close();
    }
  });
});
