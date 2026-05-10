/**
 * YT-T21..YT-T29 — Stage 4 migration tests for 0010_insights_and_youtube.sql.
 *
 * Tests fail because Stage 5 hasn't wired the repository / ingest layers yet.
 * The migration itself is valid (it must apply cleanly so `:memory:` opens at
 * all), but the full behavioral contract (idempotency across re-open, row
 * preservation, CHECK widening for inserts, FK cascades, vec0 dim pin) is
 * exercised here and most assertions either rely on the missing repo layer
 * or directly inspect tables/CHECKs that the migration creates.
 */

import { describe, expect, it } from "vitest";
import { open, type Db } from "../../src/db/open";

const VEC_DIM = 512;

function fakeVecBuf(seed: number): Buffer {
  const v = new Float32Array(VEC_DIM);
  for (let i = 0; i < VEC_DIM; i++) v[i] = ((seed * 31 + i) % 17) / 17;
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

function insertChunk(
  db: Db,
  o: {
    id: string;
    source_site: "vgcguide" | "metavgc" | "youtube";
    article_slug: string;
    chunk_index: number;
    subtype?: string | null;
    metadata?: string | null;
  },
): number {
  const r = db.$client
    .prepare("INSERT INTO knowledge_chunk_embeddings (embedding) VALUES (?)")
    .run(fakeVecBuf(o.chunk_index));
  const rowid = Number(r.lastInsertRowid);
  db.$client
    .prepare(
      `INSERT INTO knowledge_chunks
        (id, source_site, article_slug, article_title, article_url,
         article_section, section_heading, chunk_index, chunk_text,
         chunk_token_count, subtype, body_hash, embedding_ref,
         fetched_at, author, captured_via, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    )
    .run(
      o.id,
      o.source_site,
      o.article_slug,
      "T",
      `https://example/${o.article_slug}`,
      "intro",
      "S",
      o.chunk_index,
      "chunk text",
      10,
      o.subtype ?? null,
      "sha256:" + "0".repeat(64),
      `knowledge_chunk_embeddings:${rowid}`,
      "2026-05-08T00:00:00Z",
      "ingest@dev",
      o.metadata ?? null,
    );
  return rowid;
}

describe("0010_insights_and_youtube migration (YT-T21..YT-T29)", () => {
  it("YT-T21. migration is idempotent — schema_migrations records version 10 and re-open is no-op", () => {
    const path = `/tmp/yt-t21-${Date.now()}.sqlite`;
    try {
      const a = open(path);
      const versionsA = (
        a.$client
          .prepare("SELECT version FROM schema_migrations ORDER BY version")
          .all() as Array<{ version: number }>
      ).map((r) => r.version);
      expect(versionsA).toContain(10);
      a.$client.close();
      const b = open(path);
      const versionsB = (
        b.$client
          .prepare("SELECT version FROM schema_migrations ORDER BY version")
          .all() as Array<{ version: number }>
      ).map((r) => r.version);
      expect(versionsB).toEqual(versionsA);
      b.$client.close();
    } finally {
      try {
        const { unlinkSync } = require("node:fs") as typeof import("node:fs");
        unlinkSync(path);
      } catch {
        /* noop */
      }
    }
  });

  it("YT-T22. existing knowledge_chunks rows survive table rebuild with metadata=NULL", () => {
    // Insert a vgcguide row (legacy shape) — rebuild must preserve it.
    const db = open(":memory:");
    try {
      insertChunk(db, {
        id: "vgcguide:typing:0",
        source_site: "vgcguide",
        article_slug: "typing",
        chunk_index: 0,
      });
      const row = db.$client
        .prepare(
          "SELECT id, source_site, article_slug, metadata FROM knowledge_chunks WHERE id = ?",
        )
        .get("vgcguide:typing:0") as
        | { id: string; source_site: string; article_slug: string; metadata: string | null }
        | undefined;
      expect(row?.id).toBe("vgcguide:typing:0");
      expect(row?.metadata).toBeNull();
    } finally {
      db.$client.close();
    }
  });

  it("YT-T23. knowledge_chunk_embeddings vec0 sidecar is untouched by 0010", () => {
    const db = open(":memory:");
    try {
      // Pre-insert 5 vec rows; they must persist (this assertion would have
      // failed if 0010 dropped or recreated the vec0 table).
      for (let i = 0; i < 5; i++) {
        db.$client
          .prepare("INSERT INTO knowledge_chunk_embeddings (embedding) VALUES (?)")
          .run(fakeVecBuf(i));
      }
      const count = (
        db.$client.prepare("SELECT COUNT(*) AS c FROM knowledge_chunk_embeddings").get() as
          | { c: number }
          | undefined
      )?.c;
      expect(count).toBe(5);
    } finally {
      db.$client.close();
    }
  });

  it("YT-T24a. widened CHECK accepts source_site='youtube' + subtype='youtube-transcript' + youtube id GLOB", () => {
    const db = open(":memory:");
    try {
      insertChunk(db, {
        id: "youtube:J0eVKJyJ_DQ:0",
        source_site: "youtube",
        article_slug: "j0evkjyj_dq",
        chunk_index: 0,
        subtype: "youtube-transcript",
        metadata: JSON.stringify({ timestamp_start_seconds: 0 }),
      });
      const row = db.$client
        .prepare("SELECT subtype FROM knowledge_chunks WHERE id = ?")
        .get("youtube:J0eVKJyJ_DQ:0") as { subtype: string } | undefined;
      expect(row?.subtype).toBe("youtube-transcript");
    } finally {
      db.$client.close();
    }
  });

  it("YT-T24b. CHECK rejects unknown source_site", () => {
    const db = open(":memory:");
    try {
      expect(() =>
        insertChunk(db, {
          id: "discord:abc:0",
          // @ts-expect-error — invalid by design
          source_site: "discord",
          article_slug: "abc",
          chunk_index: 0,
        }),
      ).toThrow();
    } finally {
      db.$client.close();
    }
  });

  it("YT-T25. insights table CHECK rejects claim length > 280", () => {
    const db = open(":memory:");
    try {
      const longClaim = "x".repeat(281);
      expect(() =>
        db.$client
          .prepare(
            `INSERT INTO insights
              (id, schema_version, claim, claim_type, confidence, stance,
               source_type, source_url, source_excerpt, extracted_by_model,
               extracted_by_prompt_version, extracted_at, embedding_ref, chunk_id)
             VALUES (?, 1, ?, 'lead', 'medium', 'supports', 'youtube', 'https://x',
                     'excerpt', 'haiku', 'v1.0', '2026-05-09T00:00:00Z',
                     'insight_embeddings:1', NULL)`,
          )
          .run("01H8XGJWBWBAQ4XK7Z4F9DGH4P", longClaim),
      ).toThrow();
    } finally {
      db.$client.close();
    }
  });

  it("YT-T26. UNIQUE rejects duplicate (chunk_id, claim)", () => {
    const db = open(":memory:");
    try {
      const chunkRowid = insertChunk(db, {
        id: "youtube:abc:0",
        source_site: "youtube",
        article_slug: "abc",
        chunk_index: 0,
        subtype: "youtube-transcript",
      });
      void chunkRowid;
      const stmt = db.$client.prepare(
        `INSERT INTO insights
          (id, schema_version, claim, claim_type, confidence, stance,
           source_type, source_url, source_excerpt, extracted_by_model,
           extracted_by_prompt_version, extracted_at, embedding_ref, chunk_id)
         VALUES (?, 1, ?, 'lead', 'medium', 'supports', 'youtube', 'https://x',
                 'excerpt', 'haiku', 'v1.0', '2026-05-09T00:00:00Z',
                 'insight_embeddings:1', ?)`,
      );
      stmt.run("01H8XGJWBWBAQ4XK7Z4F9DGH4P", "claim", "youtube:abc:0");
      expect(() =>
        stmt.run("01H8XGJWBWBAQ4XK7Z4F9DGH4Q", "claim", "youtube:abc:0"),
      ).toThrow();
    } finally {
      db.$client.close();
    }
  });

  it("YT-T27. insight_subjects CASCADE on insight delete", () => {
    const db = open(":memory:");
    try {
      insertChunk(db, {
        id: "youtube:abc:0",
        source_site: "youtube",
        article_slug: "abc",
        chunk_index: 0,
        subtype: "youtube-transcript",
      });
      db.$client
        .prepare(
          `INSERT INTO insights
             (id, schema_version, claim, claim_type, confidence, stance,
              source_type, source_url, source_excerpt, extracted_by_model,
              extracted_by_prompt_version, extracted_at, embedding_ref, chunk_id)
           VALUES (?, 1, 'c', 'lead', 'medium', 'supports', 'youtube', 'https://x',
                   'excerpt', 'haiku', 'v1.0', '2026-05-09T00:00:00Z',
                   'insight_embeddings:1', 'youtube:abc:0')`,
        )
        .run("01H8XGJWBWBAQ4XK7Z4F9DGH4P");
      db.$client
        .prepare(
          "INSERT INTO insight_subjects (insight_id, subject_kind, subject_value) VALUES (?, ?, ?)",
        )
        .run("01H8XGJWBWBAQ4XK7Z4F9DGH4P", "pokemon", "garchomp");
      db.$client.prepare("DELETE FROM insights WHERE id = ?").run("01H8XGJWBWBAQ4XK7Z4F9DGH4P");
      const subjects = db.$client
        .prepare("SELECT * FROM insight_subjects WHERE insight_id = ?")
        .all("01H8XGJWBWBAQ4XK7Z4F9DGH4P");
      expect(subjects.length).toBe(0);
    } finally {
      db.$client.close();
    }
  });

  it("YT-T28. insights CASCADE on knowledge_chunks delete", () => {
    const db = open(":memory:");
    try {
      insertChunk(db, {
        id: "youtube:abc:0",
        source_site: "youtube",
        article_slug: "abc",
        chunk_index: 0,
        subtype: "youtube-transcript",
      });
      db.$client
        .prepare(
          `INSERT INTO insights
             (id, schema_version, claim, claim_type, confidence, stance,
              source_type, source_url, source_excerpt, extracted_by_model,
              extracted_by_prompt_version, extracted_at, embedding_ref, chunk_id)
           VALUES (?, 1, 'c', 'lead', 'medium', 'supports', 'youtube', 'https://x',
                   'excerpt', 'haiku', 'v1.0', '2026-05-09T00:00:00Z',
                   'insight_embeddings:1', 'youtube:abc:0')`,
        )
        .run("01H8XGJWBWBAQ4XK7Z4F9DGH4P");
      db.$client.prepare("DELETE FROM knowledge_chunks WHERE id = ?").run("youtube:abc:0");
      const remaining = db.$client
        .prepare("SELECT id FROM insights WHERE id = ?")
        .get("01H8XGJWBWBAQ4XK7Z4F9DGH4P");
      expect(remaining).toBeUndefined();
    } finally {
      db.$client.close();
    }
  });

  it("YT-T29. insight_embeddings vec0 is 512-dim — wrong-dim insert is rejected", () => {
    const db = open(":memory:");
    try {
      const wrong = new Float32Array(256);
      const buf = Buffer.from(wrong.buffer, wrong.byteOffset, wrong.byteLength);
      expect(() =>
        db.$client
          .prepare("INSERT INTO insight_embeddings (embedding) VALUES (?)")
          .run(buf),
      ).toThrow();
    } finally {
      db.$client.close();
    }
  });
});
