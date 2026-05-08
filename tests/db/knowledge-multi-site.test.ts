/**
 * META-T38..T44 — multi-site knowledge_chunks + species link table.
 * Stage 4: every test fails because migration 0008 doesn't exist yet — the
 * widened CHECK rejects 'metavgc' and the `knowledge_chunk_species_tags`
 * table doesn't exist. Stage 5 produces `0008_knowledge_multi_site_and_tags.sql`.
 */

import { describe, expect, it } from "vitest";
import { open, type Db } from "../../src/db/open";

const VEC_DIM = 512;

function fakeVecBuf(seed: number): Buffer {
  const v = new Float32Array(VEC_DIM);
  for (let i = 0; i < VEC_DIM; i++) v[i] = ((seed * 31 + i) % 17) / 17;
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

interface InsertOpts {
  id: string;
  source_site: "vgcguide" | "metavgc";
  article_slug: string;
  chunk_index: number;
  article_section?: string;
}

function insertChunk(db: Db, o: InsertOpts): void {
  const section = o.article_section ?? "intro";
  // Insert vec0 row first, then relational with embedding_ref pointing back.
  const r = db.$client
    .prepare(
      "INSERT INTO knowledge_chunk_embeddings (embedding) VALUES (?)",
    )
    .run(fakeVecBuf(o.chunk_index));
  const rowid = Number(r.lastInsertRowid);
  db.$client
    .prepare(
      `INSERT INTO knowledge_chunks
        (id, source_site, article_slug, article_title, article_url,
         article_section, section_heading, chunk_index, chunk_text,
         chunk_token_count, subtype, body_hash, embedding_ref,
         fetched_at, author, captured_via)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL, ?)`,
    )
    .run(
      o.id,
      o.source_site,
      o.article_slug,
      "T",
      `https://${o.source_site === "vgcguide" ? "www.vgcguide.com" : "metavgc.com"}/${o.source_site === "metavgc" ? "guides/" : ""}${o.article_slug}`,
      section,
      "S",
      o.chunk_index,
      "chunk text",
      10,
      "sha256:" + "0".repeat(64),
      `knowledge_chunk_embeddings:${rowid}`,
      "2026-05-08T00:00:00Z",
      "ingest@dev",
    );
}

describe("knowledge multi-site (META-T38..T44)", () => {
  it("META-T38. migration 0008 is recorded in schema_migrations and is idempotent across two opens", () => {
    const path = `/tmp/meta-t38-${Date.now()}.sqlite`;
    try {
      const a = open(path);
      const versionsA = (
        a.$client
          .prepare("SELECT version FROM schema_migrations ORDER BY version")
          .all() as Array<{ version: number }>
      ).map((r) => r.version);
      expect(versionsA).toContain(8);
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

  it("META-T39. existing vgcguide rows survive the migration AND the new link table exists alongside", () => {
    const db = open(":memory:");
    try {
      insertChunk(db, {
        id: "vgcguide:typing:0",
        source_site: "vgcguide",
        article_slug: "typing",
        chunk_index: 0,
        article_section: "teambuilding",
      });
      const row = db.$client
        .prepare("SELECT * FROM knowledge_chunks WHERE id = ?")
        .get("vgcguide:typing:0") as { source_site: string; article_slug: string };
      expect(row.source_site).toBe("vgcguide");
      expect(row.article_slug).toBe("typing");
      // The link table must exist post-migration.
      const tableMeta = db.$client
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
        )
        .get("knowledge_chunk_species_tags") as { name: string } | undefined;
      expect(tableMeta?.name).toBe("knowledge_chunk_species_tags");
    } finally {
      db.$client.close();
    }
  });

  it("META-T40. CHECK accepts 'metavgc' as source_site (relaxed enum)", () => {
    const db = open(":memory:");
    try {
      insertChunk(db, {
        id: "metavgc:incineroar:0",
        source_site: "metavgc",
        article_slug: "how-to-counter-incineroar-pokemon-champions",
        chunk_index: 0,
      });
      const row = db.$client
        .prepare("SELECT source_site FROM knowledge_chunks WHERE id = ?")
        .get("metavgc:incineroar:0") as { source_site: string };
      expect(row.source_site).toBe("metavgc");
    } finally {
      db.$client.close();
    }
  });

  it("META-T41. CHECK rejects unknown source_site (e.g., 'pikalytics')", () => {
    const db = open(":memory:");
    try {
      let thrown: unknown;
      try {
        insertChunk(db, {
          id: "pikalytics:foo:0",
          source_site: "pikalytics" as "vgcguide",
          article_slug: "foo",
          chunk_index: 0,
        });
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeDefined();
    } finally {
      db.$client.close();
    }
  });

  it("META-T42. unique index is widened to (source_site, article_slug, chunk_index): same slug+chunk on two sites coexist", () => {
    const db = open(":memory:");
    try {
      insertChunk(db, {
        id: "vgcguide:typing:0",
        source_site: "vgcguide",
        article_slug: "typing",
        chunk_index: 0,
        article_section: "teambuilding",
      });
      insertChunk(db, {
        id: "metavgc:typing:0",
        source_site: "metavgc",
        article_slug: "typing",
        chunk_index: 0,
      });
      const cnt = db.$client
        .prepare(
          "SELECT COUNT(*) AS c FROM knowledge_chunks WHERE article_slug = ?",
        )
        .get("typing") as { c: number };
      expect(cnt.c).toBe(2);
    } finally {
      db.$client.close();
    }
  });

  it("META-T43. knowledge_chunk_species_tags inserts succeed and ON DELETE CASCADE removes link rows when chunk is deleted", () => {
    const db = open(":memory:");
    try {
      // Need a species row for FK satisfaction.
      db.$client
        .prepare(
          `INSERT INTO species (id, display_name, form_id, is_mega, types, weight_kg, aliases, movepool, source_json)
           VALUES ('incineroar', 'Incineroar', NULL, 0, '["Fire","Dark"]', 83.0, '[]', '[]', '{}')`,
        )
        .run();
      insertChunk(db, {
        id: "metavgc:incineroar:0",
        source_site: "metavgc",
        article_slug: "how-to-counter-incineroar-pokemon-champions",
        chunk_index: 0,
      });
      db.$client
        .prepare(
          "INSERT INTO knowledge_chunk_species_tags (chunk_id, species_id) VALUES (?, ?)",
        )
        .run("metavgc:incineroar:0", "incineroar");
      const before = db.$client
        .prepare("SELECT COUNT(*) AS c FROM knowledge_chunk_species_tags")
        .get() as { c: number };
      expect(before.c).toBe(1);

      // Composite PK rejects duplicate (chunk_id, species_id).
      let dup: unknown;
      try {
        db.$client
          .prepare(
            "INSERT INTO knowledge_chunk_species_tags (chunk_id, species_id) VALUES (?, ?)",
          )
          .run("metavgc:incineroar:0", "incineroar");
      } catch (e) {
        dup = e;
      }
      expect(dup).toBeDefined();

      // Cascade on chunk delete.
      db.$client
        .prepare("DELETE FROM knowledge_chunks WHERE id = ?")
        .run("metavgc:incineroar:0");
      const after = db.$client
        .prepare("SELECT COUNT(*) AS c FROM knowledge_chunk_species_tags")
        .get() as { c: number };
      expect(after.c).toBe(0);
    } finally {
      db.$client.close();
    }
  });

  it("META-T44. species_id_filter join returns matching chunks (source_site agnostic — both metavgc and vgcguide)", () => {
    const db = open(":memory:");
    try {
      db.$client
        .prepare(
          `INSERT INTO species (id, display_name, form_id, is_mega, types, weight_kg, aliases, movepool, source_json)
           VALUES ('incineroar', 'Incineroar', NULL, 0, '["Fire","Dark"]', 83.0, '[]', '[]', '{}')`,
        )
        .run();
      insertChunk(db, {
        id: "metavgc:incineroar:0",
        source_site: "metavgc",
        article_slug: "how-to-counter-incineroar-pokemon-champions",
        chunk_index: 0,
      });
      insertChunk(db, {
        id: "vgcguide:typing:0",
        source_site: "vgcguide",
        article_slug: "typing",
        chunk_index: 0,
        article_section: "teambuilding",
      });
      // Tag only the metavgc chunk.
      db.$client
        .prepare(
          "INSERT INTO knowledge_chunk_species_tags (chunk_id, species_id) VALUES (?, ?)",
        )
        .run("metavgc:incineroar:0", "incineroar");
      // Vanilla join: chunks tagged with 'incineroar'.
      const rows = db.$client
        .prepare(
          `SELECT kc.id
             FROM knowledge_chunks kc
             JOIN knowledge_chunk_species_tags t ON t.chunk_id = kc.id
            WHERE t.species_id = ?`,
        )
        .all("incineroar") as Array<{ id: string }>;
      expect(rows.map((r) => r.id)).toEqual(["metavgc:incineroar:0"]);
    } finally {
      db.$client.close();
    }
  });
});
