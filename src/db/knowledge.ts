/**
 * Bespoke `knowledge_chunks` repo. Per `docs/plans/vgc-knowledge-base.md` §6
 * the factory pattern (`createSimpleRepo`) doesn't fit:
 *   - writes are multi-table (relational + virtual sidecar);
 *   - `search` is a vec-virtual-table query joined back to relational;
 *   - `list` has multi-column filters (slug + section + subtype).
 *
 * Vector tier: vec0 sidecar `knowledge_chunk_embeddings` with cosine distance
 * metric. Each `knowledge_chunks.embedding_ref` carries the literal
 * `"knowledge_chunk_embeddings:<rowid>"` linking to the sidecar; reads JOIN
 * via that string. App-level cascade-delete on body_hash mismatch.
 */

import type { Db } from "./open";
import type {
  ChunkFilter,
  KnowledgeChunk,
  KnowledgeSearchHit,
} from "../schemas/knowledge";
import {
  KnowledgeChunkSchema,
  KnowledgeSearchHitSchema,
} from "../schemas/knowledge";
import {
  KnowledgeStorageError,
  RosterDataError,
  RosterDbError,
} from "../schemas/errors";
import { parseOrThrow } from "./simple-repo";

const VECTOR_DIM = 512;
const EMBEDDING_REF_PREFIX = "knowledge_chunk_embeddings:";

/** Args for {@link search}. */
export interface KnowledgeSearchRepoArgs {
  /** 512-dim query vector (voyage-3-lite). */
  query_vector: Float32Array;
  /** Top-k. Plan default 5. */
  k: number;
  exclude_subtypes?: Array<"battle-replay">;
  article_section_filter?: Array<"intro" | "teambuilding" | "battling">;
}

/** Args for {@link upsertArticleChunks}. */
export interface UpsertArticleChunksArgs {
  /**
   * Source-site discriminator. Backwards-compatible: callers that omit this
   * default to `"vgcguide"` so the existing vgcguide ingest stays one-line.
   */
  source_site?: "vgcguide" | "metavgc";
  article_slug: string;
  body_hash: string;
  chunks: Array<Omit<KnowledgeChunk, "embedding_ref">>;
  /** One vector per chunk. Length must match `chunks.length`. */
  embeddings: Float32Array[];
  /**
   * Optional per-chunk species tags (canonical species ids). When provided,
   * length must equal `chunks.length`. `null` for a position means "not
   * tagged" (no link rows written for that chunk); `[]` means "tagged, no
   * matches" (delete-only). Plan §19.3 — link table, not JSON.
   */
  species_tags_per_chunk?: ReadonlyArray<readonly string[] | null>;
}

/** Result of {@link upsertArticleChunks}. */
export interface UpsertArticleChunksResult {
  inserted: number;
  replaced: number;
  /** True if `body_hash` matched the persisted hash and no work was done. */
  skipped_unchanged: boolean;
}

interface KnowledgeRow {
  id: string;
  source_site: string;
  article_slug: string;
  article_title: string;
  article_url: string;
  article_section: string;
  section_heading: string;
  chunk_index: number;
  chunk_text: string;
  chunk_token_count: number;
  subtype: string | null;
  body_hash: string;
  embedding_ref: string;
  fetched_at: string;
  author: string | null;
  captured_via: string;
}

function rowToChunk(row: KnowledgeRow): KnowledgeChunk {
  const candidate = {
    schema_version: 1,
    id: row.id,
    source_site: row.source_site,
    article_slug: row.article_slug,
    article_title: row.article_title,
    article_url: row.article_url,
    article_section: row.article_section,
    section_heading: row.section_heading,
    chunk_index: row.chunk_index,
    chunk_text: row.chunk_text,
    chunk_token_count: row.chunk_token_count,
    subtype: row.subtype,
    body_hash: row.body_hash,
    embedding_ref: row.embedding_ref,
    source: {
      site: row.source_site,
      fetched_at: row.fetched_at,
      author: row.author,
      captured_via: row.captured_via,
    },
  };
  return parseOrThrow(KnowledgeChunkSchema, candidate, "knowledge_chunks", row.id);
}

function vectorToBuffer(vec: Float32Array): Buffer {
  if (vec.length !== VECTOR_DIM) {
    throw new KnowledgeStorageError(
      `vec dimension mismatch: got ${vec.length}, expected ${VECTOR_DIM}`,
    );
  }
  // TODO(stage6-deferred): document slice ownership semantics in vectorToBuffer
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

function wrapDb<T>(op: string, fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof KnowledgeStorageError) throw e;
    if (e instanceof RosterDataError) throw e;
    throw new RosterDbError(`knowledge.${op}: ${(e as Error).message ?? String(e)}`, {
      cause: e,
      query: op,
    });
  }
}

/**
 * List persisted chunks matching a filter.
 *
 * **When to use it:** debugging / `knowledge.search` boundary tests / the
 * operator demo. For semantic queries use {@link search}.
 *
 * @param db — Open Drizzle DB handle.
 * @param filter — Optional `article_slug` / `article_section` / `subtype` /
 *   `limit`. Empty filter returns all chunks (subject to `limit`).
 * @returns Chunks ordered by `(article_slug, chunk_index)`.
 * @throws {RosterDbError} On SQLite I/O failure.
 */
export function list(db: Db, filter: ChunkFilter): KnowledgeChunk[] {
  return wrapDb("list", () => {
    const conds: string[] = [];
    const params: Array<string | number> = [];
    if (filter.article_slug !== undefined) {
      conds.push("article_slug = ?");
      params.push(filter.article_slug);
    }
    if (filter.article_section !== undefined) {
      conds.push("article_section = ?");
      params.push(filter.article_section);
    }
    if (filter.subtype !== undefined) {
      if (filter.subtype === null) {
        conds.push("subtype IS NULL");
      } else {
        conds.push("subtype = ?");
        params.push(filter.subtype);
      }
    }
    let sql = "SELECT * FROM knowledge_chunks";
    if (conds.length > 0) sql += " WHERE " + conds.join(" AND ");
    sql += " ORDER BY article_slug ASC, chunk_index ASC";
    if (filter.limit !== undefined) {
      sql += " LIMIT ?";
      params.push(filter.limit);
    }
    const rows = db.$client.prepare(sql).all(...params) as KnowledgeRow[];
    return rows.map(rowToChunk);
  });
}

/**
 * Look up a single chunk by `id`.
 *
 * **When to use it:** the agent runtime uses `id` to re-fetch the canonical
 * row when a tool result needs to be re-read. Returns `null` on miss.
 *
 * @param db — Open Drizzle DB handle.
 * @param id — Canonical chunk id of the form `vgcguide:<slug>:<index>`.
 * @returns The chunk row, or `null` if no match.
 * @throws {RosterDbError} On SQLite I/O failure.
 */
export function get(db: Db, id: string): KnowledgeChunk | null {
  return wrapDb("get", () => {
    const row = db.$client
      .prepare("SELECT * FROM knowledge_chunks WHERE id = ? LIMIT 1")
      .get(id) as KnowledgeRow | undefined;
    if (row === undefined) return null;
    return rowToChunk(row);
  });
}

/**
 * Top-k semantic search via the vec0 sidecar with cosine distance.
 * `exclude_subtypes` and `article_section_filter` are applied post-vec
 * (vec0 doesn't accept arbitrary WHERE on virtual rows). Over-fetches a
 * bounded multiple of `k` to keep top-k stable after filtering at corpus
 * scale (~1000 chunks).
 *
 * **When to use it:** the agent's `knowledge_search` runtime. Inputs are a
 * pre-embedded query vector (the embed step lives in `tools/knowledge/search.ts`).
 *
 * @param db — Open Drizzle DB handle.
 * @param args — Query vector + k + optional filters.
 * @returns Hits ordered by `cosine_score DESC`, length ≤ `k` after post-filter.
 * @throws {RosterDbError} On SQLite I/O failure.
 */
export function search(
  db: Db,
  args: KnowledgeSearchRepoArgs,
): KnowledgeSearchHit[] {
  return wrapDb("search", () => {
    // Empty corpus short-circuit.
    const count = db.$client
      .prepare("SELECT COUNT(*) AS c FROM knowledge_chunk_embeddings")
      .get() as { c: number };
    if (count.c === 0) return [];

    const buf = vectorToBuffer(args.query_vector);
    // Over-fetch some to leave room for post-filter; cap at corpus size.
    // TODO(stage6-deferred): bump multiplier when corpus > 5K chunks
    // (currently 4×; battle-replay density makes 4× sufficient).
    const overFetch = Math.min(
      Math.max(args.k * 4, args.k + 16),
      count.c,
    );
    const rows = db.$client
      .prepare(
        `SELECT kc.*, e.distance AS distance
         FROM (
           SELECT rowid, distance
           FROM knowledge_chunk_embeddings
           WHERE embedding MATCH ?
           ORDER BY distance
           LIMIT ?
         ) AS e
         JOIN knowledge_chunks kc
           ON kc.embedding_ref = ('knowledge_chunk_embeddings:' || CAST(e.rowid AS TEXT))
         ORDER BY e.distance ASC`,
      )
      .all(buf, overFetch) as Array<KnowledgeRow & { distance: number }>;

    const exclude = new Set(args.exclude_subtypes ?? []);
    const sectionAllow =
      args.article_section_filter && args.article_section_filter.length > 0
        ? new Set<string>(args.article_section_filter)
        : null;

    const hits: KnowledgeSearchHit[] = [];
    for (const row of rows) {
      if (row.subtype !== null && exclude.has(row.subtype as "battle-replay")) {
        continue;
      }
      if (sectionAllow !== null && !sectionAllow.has(row.article_section)) {
        continue;
      }
      // Cosine distance in vec0 is 1 - cos(theta) for cosine metric. Map to
      // similarity score in [-1, 1].
      const cosine_score = clamp(1 - row.distance, -1, 1);
      const candidate = {
        id: row.id,
        article_slug: row.article_slug,
        article_title: row.article_title,
        article_url: row.article_url,
        article_section: row.article_section,
        section_heading: row.section_heading,
        subtype: row.subtype,
        chunk_text: row.chunk_text,
        cosine_score,
      };
      hits.push(parseOrThrow(KnowledgeSearchHitSchema, candidate, "knowledge_search", row.id));
      if (hits.length >= args.k) break;
    }
    return hits;
  });
}

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return n < lo ? lo : n > hi ? hi : n;
}

/**
 * Skip-existing-aware upsert of one article's chunks. Single transaction:
 * (1) compare body_hash; (2) on mismatch, cascade-delete relational + vec0
 * rows; (3) insert chunks; (4) insert embeddings; (5) update `embedding_ref`.
 *
 * **When to use it:** the vgcguide ingest pipeline.
 *
 * @param db — Writable Drizzle DB handle.
 * @param input — `{ article_slug, body_hash, chunks, embeddings }`.
 * @returns `{ inserted, replaced, skipped_unchanged }` — `skipped_unchanged`
 *   true iff the persisted body_hash matched and no work was done.
 * @throws {KnowledgeStorageError} On vec0 dimension mismatch (defensive).
 * @throws {RosterDbError} On SQLite I/O failure.
 */
export function upsertArticleChunks(
  db: Db,
  input: UpsertArticleChunksArgs,
): UpsertArticleChunksResult {
  if (input.chunks.length !== input.embeddings.length) {
    throw new KnowledgeStorageError(
      `upsert: chunks (${input.chunks.length}) and embeddings (${input.embeddings.length}) length mismatch`,
    );
  }
  if (
    input.species_tags_per_chunk !== undefined &&
    input.species_tags_per_chunk.length !== input.chunks.length
  ) {
    throw new KnowledgeStorageError(
      `upsert: species_tags_per_chunk length (${input.species_tags_per_chunk.length}) != chunks (${input.chunks.length})`,
    );
  }
  for (const v of input.embeddings) {
    if (v.length !== VECTOR_DIM) {
      throw new KnowledgeStorageError(
        `upsert: vec dimension mismatch (got ${v.length}, expected ${VECTOR_DIM})`,
      );
    }
  }
  const sourceSite: "vgcguide" | "metavgc" = input.source_site ?? "vgcguide";

  return wrapDb("upsertArticleChunks", () => {
    const raw = db.$client;
    const existingHashRow = raw
      .prepare(
        "SELECT body_hash FROM knowledge_chunks WHERE source_site = ? AND article_slug = ? LIMIT 1",
      )
      .get(sourceSite, input.article_slug) as
      | { body_hash: string }
      | undefined;
    if (
      existingHashRow !== undefined &&
      existingHashRow.body_hash === input.body_hash
    ) {
      return { inserted: 0, replaced: 0, skipped_unchanged: true };
    }

    let replaced = 0;
    const tx = raw.transaction(() => {
      // Cascade-delete vec rows + relational rows for this (site, slug). The
      // `knowledge_chunk_species_tags` link rows cascade via FK ON DELETE.
      const oldRefs = raw
        .prepare(
          "SELECT embedding_ref FROM knowledge_chunks WHERE source_site = ? AND article_slug = ?",
        )
        .all(sourceSite, input.article_slug) as Array<{
        embedding_ref: string;
      }>;
      replaced = oldRefs.length;
      for (const r of oldRefs) {
        const refStr = r.embedding_ref;
        if (!refStr.startsWith(EMBEDDING_REF_PREFIX)) continue;
        const rowid = Number.parseInt(
          refStr.slice(EMBEDDING_REF_PREFIX.length),
          10,
        );
        if (Number.isFinite(rowid)) {
          raw
            .prepare("DELETE FROM knowledge_chunk_embeddings WHERE rowid = ?")
            .run(rowid);
        }
      }
      raw
        .prepare(
          "DELETE FROM knowledge_chunks WHERE source_site = ? AND article_slug = ?",
        )
        .run(sourceSite, input.article_slug);

      const insertVec = raw.prepare(
        "INSERT INTO knowledge_chunk_embeddings(embedding) VALUES (?)",
      );
      const insertChunk = raw.prepare(
        `INSERT INTO knowledge_chunks (
          id, source_site, article_slug, article_title, article_url,
          article_section, section_heading, chunk_index, chunk_text,
          chunk_token_count, subtype, body_hash, embedding_ref,
          fetched_at, author, captured_via
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const insertTag = raw.prepare(
        "INSERT OR IGNORE INTO knowledge_chunk_species_tags (chunk_id, species_id) VALUES (?, ?)",
      );

      for (let i = 0; i < input.chunks.length; i++) {
        const c = input.chunks[i]!;
        const v = input.embeddings[i]!;
        const buf = vectorToBuffer(v);
        const info = insertVec.run(buf);
        const rowid = Number(info.lastInsertRowid);
        const ref = `${EMBEDDING_REF_PREFIX}${rowid}`;
        insertChunk.run(
          c.id,
          c.source_site,
          c.article_slug,
          c.article_title,
          c.article_url,
          c.article_section,
          c.section_heading,
          c.chunk_index,
          c.chunk_text,
          c.chunk_token_count,
          c.subtype,
          c.body_hash,
          ref,
          c.source.fetched_at,
          c.source.author,
          c.source.captured_via,
        );
        const tags = input.species_tags_per_chunk?.[i];
        if (tags !== undefined && tags !== null) {
          for (const speciesId of tags) {
            insertTag.run(c.id, speciesId);
          }
        }
      }
    });
    tx();

    return {
      inserted: input.chunks.length,
      replaced,
      skipped_unchanged: false,
    };
  });
}

/**
 * Cheap probe: latest persisted body_hash for `article_slug`, or `null`.
 *
 * **When to use it:** the ingest's skip-existing pre-check.
 *
 * @param db — Open Drizzle DB handle.
 * @param article_slug — Canonical vgcguide slug.
 * @returns The body_hash string or `null` if no row exists.
 * @throws {RosterDbError} On SQLite I/O failure.
 */
export function articleBodyHash(
  db: Db,
  arg2: string,
  arg3?: string,
): string | null {
  // Backwards-compatible overload-style signature:
  //   articleBodyHash(db, article_slug)                  → vgcguide default
  //   articleBodyHash(db, source_site, article_slug)     → multi-site form
  // Plan §19 — the metavgc ingest passes the site explicitly; the vgcguide
  // ingest stayed one-line and continues to call the two-arg form.
  const sourceSite: "vgcguide" | "metavgc" =
    arg3 === undefined ? "vgcguide" : (arg2 as "vgcguide" | "metavgc");
  const articleSlug = arg3 ?? arg2;
  return wrapDb("articleBodyHash", () => {
    const row = db.$client
      .prepare(
        "SELECT body_hash FROM knowledge_chunks WHERE source_site = ? AND article_slug = ? LIMIT 1",
      )
      .get(sourceSite, articleSlug) as { body_hash: string } | undefined;
    return row?.body_hash ?? null;
  });
}
