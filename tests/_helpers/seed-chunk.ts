/**
 * Shared test helper: insert one row into `knowledge_chunks` + a matching
 * vec0 embedding for the insights repo tests. Extracted from
 * `tests/db/insights-repo.test.ts` so the schema lives in one place.
 *
 * Two consumers today: `tests/db/insights-repo.test.ts` (Stage 5 youtube
 * slice) and `tests/db/insights-phase-tag.test.ts` (Stage A support-pillar
 * slice). Both seed a minimum-viable youtube chunk per chunk_id.
 */

import type { Db } from "../../src/db/open";

/** Seed a single `knowledge_chunks` row + its vec0 embedding. */
export function seedChunk(db: Db, id: string): void {
  const v = new Float32Array(512);
  const r = db.$client
    .prepare("INSERT INTO knowledge_chunk_embeddings (embedding) VALUES (?)")
    .run(Buffer.from(v.buffer, v.byteOffset, v.byteLength));
  const rowid = Number(r.lastInsertRowid);
  db.$client
    .prepare(
      `INSERT INTO knowledge_chunks
        (id, source_site, article_slug, article_title, article_url,
         article_section, section_heading, chunk_index, chunk_text,
         chunk_token_count, subtype, body_hash, embedding_ref,
         fetched_at, author, captured_via, metadata)
       VALUES (?, 'youtube', 'abc', 'T', 'https://www.youtube.com/watch?v=abc',
               'intro', 'S', 0, 'text', 10, 'youtube-transcript',
               ?, ?, '2026-05-09T00:00:00Z', NULL, 'ingest@dev', NULL)`,
    )
    .run(id, "sha256:" + "0".repeat(64), `knowledge_chunk_embeddings:${rowid}`);
}
