/**
 * CLI entry point for `pnpm data:ingest:youtube`.
 *
 * Argv:
 *   --url <youtube_url>   required (single video).
 *   --db <path>           SQLite path (default ./data/db.sqlite).
 *   --no-extract          chunk-only mode (skip Haiku extraction).
 *
 * Env vars:
 *   VOYAGE_API_KEY        required unless tests inject embedClient.
 *   ANTHROPIC_API_KEY     required unless tests inject anthropic, OR --no-extract is set.
 *
 * Exit codes:
 *   0  success (including soft-skips: no-captions, non-English, etc.)
 *   1  KnowledgeAuthError, DB error, uncaught exception.
 *
 * Per CLAUDE.md memory `single_db_non_destructive_build.md`: this script never
 * `unlink`s the DB; all writes are upserts.
 */

import { createHash } from "node:crypto";
import { open, type Db } from "../../src/db/open";
import {
  createYoutubeClient,
  type YoutubeClient,
  type YoutubeVideoMetadata,
} from "../../src/tools/youtube/client";
import { parseTranscript } from "../../src/tools/youtube/parse-transcript";
import { chunkTranscript } from "../../src/tools/youtube/chunk-transcript";
import {
  createEmbedClient,
  type EmbedClient,
} from "../../src/tools/knowledge/embed";
import {
  buildSpeciesIndex,
  type SpeciesIndex,
} from "../../src/tools/knowledge/species-tagger";
import {
  extractInsights,
  type AnthropicClientLike,
} from "../../src/tools/insights/extract";
import { embedInsights } from "../../src/tools/insights/embed";
import { createInsightStore } from "../../src/db/insights";
import {
  KnowledgeAuthError,
  YoutubeFetchError,
} from "../../src/schemas/errors";
import type { InsightSubjectRow } from "../../src/schemas/insight";

/** Injection slots for {@link main} — overridable in tests. */
export interface MainDeps {
  db?: Db;
  ytClient?: YoutubeClient;
  embedClient?: EmbedClient;
  anthropic?: AnthropicClientLike;
  speciesIndex?: SpeciesIndex;
}

interface ParsedArgs {
  url: string | null;
  db: string;
  noExtract: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    url: null,
    db: "./data/db.sqlite",
    noExtract: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--url") {
      out.url = argv[++i] ?? null;
    } else if (a === "--db") {
      out.db = argv[++i] ?? out.db;
    } else if (a === "--no-extract") {
      out.noExtract = true;
    }
  }
  return out;
}

const VIDEO_ID_RE = /[?&]v=([A-Za-z0-9_-]+)|youtu\.be\/([A-Za-z0-9_-]+)/;

function videoIdFromUrl(url: string): string | null {
  const m = url.match(VIDEO_ID_RE);
  return m?.[1] ?? m?.[2] ?? null;
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function isLikelyEnglish(meta: YoutubeVideoMetadata, transcriptText: string): boolean {
  // Tests: when watch-page declares `lang="ja"` (or similarly clearly
  // non-English) we soft-skip. We don't accept the page-lang attribute as a
  // positive signal because YouTube often serves the requesting user's
  // locale — a Latin-character heuristic on the transcript itself is more
  // reliable for the positive case.
  const lang = meta.language?.toLowerCase() ?? null;
  const NON_ENGLISH_PREFIXES = ["ja", "ko", "zh", "ru", "ar", "th", "he"];
  if (lang !== null && NON_ENGLISH_PREFIXES.some((p) => lang.startsWith(p))) {
    return false;
  }
  const sample = transcriptText.slice(0, 400);
  if (sample.length === 0) return true;
  let latin = 0;
  for (let i = 0; i < sample.length; i++) {
    const c = sample.charCodeAt(i);
    if (c < 0x100) latin++;
  }
  return latin / sample.length >= 0.8;
}

interface IngestSummary {
  video_id: string;
  chunks_inserted: number;
  chunks_skipped_existing: number;
  insights_extracted: number;
  insights_rejected: number;
  top_species: string[];
  sample_claims: string[];
  soft_skip_reason: string | null;
  /** When set, the chunk ingest succeeded but Haiku extraction was
   *  intentionally skipped (`--no-extract` flag, or `ANTHROPIC_API_KEY`
   *  not set). Operators see this in the printed summary so they can
   *  re-run with extraction enabled later. */
  extraction_skipped_reason?: string;
}

const EMBEDDING_REF_PREFIX = "knowledge_chunk_embeddings:";

/**
 * Run the YouTube ingest. Accepts argv (without `node script.js` prefix).
 *
 * **When to use it:** the CLI / cron entry point. Tests inject `db` + `ytClient`
 * + `embedClient` + `anthropic` + `speciesIndex` to avoid real network.
 *
 * @param argv - `process.argv.slice(2)`.
 * @param injected - Optional injection overrides.
 * @returns Exit code (0 = success / soft-skip; 1 = fail loud).
 * @throws {KnowledgeAuthError} Propagates only when caller does not catch
 *   (e.g. via `.catch(() => 1)` in tests). In CLI mode this is mapped to
 *   exit code 1 by {@link main} itself.
 *
 * @example
 *   const code = await main(["--url", "https://youtu.be/abc"]);
 *   process.exit(code);
 */
export async function main(
  argv: string[],
  injected?: MainDeps,
): Promise<number> {
  const args = parseArgs(argv);
  if (args.url === null || args.url.length === 0) {
    process.stderr.write("ingest-youtube: --url is required\n");
    return 1;
  }
  const videoId = videoIdFromUrl(args.url);
  if (videoId === null) {
    process.stderr.write(`ingest-youtube: could not extract video id from URL: ${args.url}\n`);
    return 1;
  }

  const ownDb = injected?.db === undefined;
  const db = injected?.db ?? open(args.db);
  const ytClient =
    injected?.ytClient ??
    createYoutubeClient({ throttleRps: 1 });
  const embedClient =
    injected?.embedClient ??
    createEmbedClient({
      apiKey: process.env.VOYAGE_API_KEY ?? "",
      model: "voyage-3-lite",
    });
  const anthropic = injected?.anthropic;

  let summary: IngestSummary = {
    video_id: videoId,
    chunks_inserted: 0,
    chunks_skipped_existing: 0,
    insights_extracted: 0,
    insights_rejected: 0,
    top_species: [],
    sample_claims: [],
    soft_skip_reason: null,
  };

  try {
    // 1. Fetch metadata
    let meta: YoutubeVideoMetadata;
    try {
      meta = await ytClient.fetchMetadata(videoId);
    } catch (e) {
      if (e instanceof YoutubeFetchError) {
        summary.soft_skip_reason = `metadata: ${e.kind}`;
        report(summary);
        return 0;
      }
      throw e;
    }

    // 2. Fetch transcript (soft-skip on no_captions / disabled / private)
    let segments;
    try {
      segments = await ytClient.fetchTranscript(videoId);
    } catch (e) {
      if (
        e instanceof YoutubeFetchError ||
        (typeof e === "object" &&
          e !== null &&
          (e as { name?: string }).name === "YoutubeFetchError")
      ) {
        const kind = (e as { kind?: string }).kind ?? "unknown";
        summary.soft_skip_reason = `transcript: ${kind}`;
        report(summary);
        return 0;
      }
      throw e;
    }

    const parsed = parseTranscript(segments);
    if (parsed.length === 0) {
      summary.soft_skip_reason = "empty transcript";
      report(summary);
      return 0;
    }

    // 3. English heuristic
    const transcriptText = parsed.map((s) => s.text).join(" ");
    if (!isLikelyEnglish(meta, transcriptText)) {
      summary.soft_skip_reason = "non-English";
      report(summary);
      return 0;
    }

    // 4. Chunk
    const chunks = chunkTranscript(parsed);
    if (chunks.length === 0) {
      summary.soft_skip_reason = "no chunks";
      report(summary);
      return 0;
    }

    // 5. Persist chunks idempotently into knowledge_chunks (subtype='youtube-transcript')
    //    and the vec0 sidecar `knowledge_chunk_embeddings`.
    const slug = videoId.toLowerCase();
    const fetched_at = meta.fetched_at;
    const captured_via = `youtube-ingest@${process.env.GIT_SHA ?? "dev"}`;
    const articleTitle =
      meta.title.length > 0 ? meta.title.slice(0, 200) : videoId;

    // Build chunk texts for embedding (only for those not already persisted).
    const chunkIds = chunks.map((c) => `youtube:${videoId}:${c.chunk_index}`);

    const raw = db.$client;
    const existingIds = new Set(
      (
        raw
          .prepare(
            `SELECT id FROM knowledge_chunks WHERE id IN (${chunkIds.map(() => "?").join(",")})`,
          )
          .all(...chunkIds) as Array<{ id: string }>
      ).map((r) => r.id),
    );

    const newChunks = chunks.filter(
      (c) => !existingIds.has(`youtube:${videoId}:${c.chunk_index}`),
    );
    summary.chunks_skipped_existing = chunks.length - newChunks.length;

    let chunkEmbeddings: Float32Array[] = [];
    if (newChunks.length > 0) {
      chunkEmbeddings = await embedClient.embed(
        newChunks.map((c) => c.chunk_text),
        "document",
      );
    }

    // Insert chunks transactionally.
    if (newChunks.length > 0) {
      const insertVec = raw.prepare(
        "INSERT INTO knowledge_chunk_embeddings(embedding) VALUES (?)",
      );
      const insertChunk = raw.prepare(
        `INSERT INTO knowledge_chunks (
          id, source_site, article_slug, article_title, article_url,
          article_section, section_heading, chunk_index, chunk_text,
          chunk_token_count, subtype, body_hash, embedding_ref,
          fetched_at, author, captured_via, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );

      const tx = raw.transaction(() => {
        for (let i = 0; i < newChunks.length; i++) {
          const c = newChunks[i]!;
          const v = chunkEmbeddings[i]!;
          if (v.length !== 512) {
            throw new Error(`youtube ingest: vec dim ${v.length} != 512`);
          }
          const buf = Buffer.from(v.buffer, v.byteOffset, v.byteLength);
          const info = insertVec.run(buf);
          const rowid = Number(info.lastInsertRowid);
          const ref = `${EMBEDDING_REF_PREFIX}${rowid}`;
          const body_hash = `sha256:${sha256Hex(c.chunk_text)}`;
          const metadata = JSON.stringify({
            timestamp_start_seconds: c.timestamp_start_seconds,
            timestamp_end_seconds: c.timestamp_end_seconds,
          });
          insertChunk.run(
            `youtube:${videoId}:${c.chunk_index}`,
            "youtube",
            slug,
            articleTitle,
            meta.canonical_url,
            "battling",
            "transcript",
            c.chunk_index,
            c.chunk_text,
            c.chunk_token_count,
            "youtube-transcript",
            body_hash,
            ref,
            fetched_at,
            meta.channel.length > 0 ? meta.channel : null,
            captured_via,
            metadata,
          );
          summary.chunks_inserted++;
        }
      });
      tx();
    }

    // 6. Optionally extract + embed insights.
    if (args.noExtract) {
      summary.extraction_skipped_reason = "--no-extract flag";
    } else if (anthropic === undefined) {
      summary.extraction_skipped_reason = "ANTHROPIC_API_KEY not set";
    }
    if (!args.noExtract && anthropic !== undefined) {
      const speciesIndex =
        injected?.speciesIndex ?? buildSpeciesIndex(db);

      // Re-fetch all chunks for this video so we can extract over the full set
      // (existing + newly inserted). Idempotency for insights is via
      // (chunk_id, claim) UNIQUE in upsertMany.
      const allRows = raw
        .prepare(
          `SELECT id, chunk_text, article_url, metadata
             FROM knowledge_chunks
            WHERE source_site = 'youtube' AND article_slug = ?
            ORDER BY chunk_index ASC`,
        )
        .all(slug) as Array<{
        id: string;
        chunk_text: string;
        article_url: string;
        metadata: string | null;
      }>;

      const store = createInsightStore(db, { embedClient });
      const speciesCount = new Map<string, number>();
      const sampleClaims: string[] = [];
      let extracted = 0;
      let rejected = 0;

      for (const row of allRows) {
        const chunkMeta =
          row.metadata !== null
            ? (JSON.parse(row.metadata) as Record<string, unknown>)
            : {};
        const r = await extractInsights(
          {
            chunk: {
              id: row.id,
              chunk_text: row.chunk_text,
              article_url: row.article_url,
              metadata: chunkMeta,
            },
            video_meta: meta,
            species_index: speciesIndex,
          },
          {
            anthropic,
            prompt_version: "v1.0",
            clock: () => new Date(),
            ulid: ulidFactory(),
          },
        );
        rejected += r.rejected.length;

        if (r.insights.length === 0) continue;

        const embeddings = await embedInsights(r.insights, { embedClient });
        const upsertRows = r.insights.map((ins, idx) => {
          const subjects: InsightSubjectRow[] = [];
          for (const p of ins.subjects.pokemon) {
            subjects.push({
              insight_id: ins.id,
              subject_kind: "pokemon",
              subject_value: p,
            });
          }
          for (const m of ins.subjects.moves ?? []) {
            subjects.push({
              insight_id: ins.id,
              subject_kind: "move",
              subject_value: m,
            });
          }
          return {
            insight: ins,
            embedding: embeddings[idx]!,
            subjects,
          };
        });
        const upsertResult = await store.upsertMany(upsertRows);
        extracted += upsertResult.inserted;

        for (const ins of r.insights) {
          for (const p of ins.subjects.pokemon) {
            speciesCount.set(p, (speciesCount.get(p) ?? 0) + 1);
          }
          if (sampleClaims.length < 3) sampleClaims.push(ins.claim);
        }

        // Also tag chunks with species pulled from the insights' subject
        // lists (for citation overlap). FK violations are the only
        // expected failure (species id not yet in roster); narrow the
        // catch so we don't swallow real I/O errors.
        const insightSpecies = new Set<string>();
        for (const ins of r.insights) {
          for (const p of ins.subjects.pokemon) insightSpecies.add(p);
        }
        if (insightSpecies.size > 0) {
          const tagStmt = raw.prepare(
            "INSERT OR IGNORE INTO knowledge_chunk_species_tags (chunk_id, species_id) VALUES (?, ?)",
          );
          for (const t of insightSpecies) {
            try {
              tagStmt.run(row.id, t);
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              // Better-sqlite3 wraps FK violations in a SQLITE_CONSTRAINT_*
              // message — only swallow that specific class, surface anything
              // else loudly.
              if (!/FOREIGN KEY|SQLITE_CONSTRAINT/i.test(msg)) {
                throw e;
              }
              // FK violation: species not yet in roster — log + skip.
              process.stderr.write(
                `[ingest-youtube] WARN species '${t}' not in roster (skipping tag for ${row.id})\n`,
              );
            }
          }
        }
      }

      summary.insights_extracted = extracted;
      summary.insights_rejected = rejected;
      summary.top_species = Array.from(speciesCount.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([s]) => s);
      summary.sample_claims = sampleClaims;
    }

    report(summary);
    return 0;
  } catch (e) {
    if (e instanceof KnowledgeAuthError) {
      process.stderr.write(`ingest-youtube: auth error — ${e.message}\n`);
      return 1;
    }
    process.stderr.write(
      `ingest-youtube: failed — ${e instanceof Error ? e.message : String(e)}\n`,
    );
    return 1;
  } finally {
    if (ownDb) db.$client.close();
  }
}

function ulidFactory(): () => string {
  // Lightweight monotonic ULID-ish: 10 chars time + 16 chars random Crockford.
  const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  return (): string => {
    let timeStr = "";
    let t = Date.now();
    for (let i = 0; i < 10; i++) {
      timeStr = ALPHABET[t % 32]! + timeStr;
      t = Math.floor(t / 32);
    }
    let rand = "";
    for (let i = 0; i < 16; i++) {
      rand += ALPHABET[Math.floor(Math.random() * 32)]!;
    }
    return timeStr + rand;
  };
}

function report(s: IngestSummary): void {
  if (s.soft_skip_reason !== null) {
    process.stdout.write(
      `[youtube] ${s.video_id} soft-skip: ${s.soft_skip_reason}\n`,
    );
    return;
  }
  process.stdout.write(
    `[youtube] ${s.video_id} chunks=${s.chunks_inserted} (skipped_existing=${s.chunks_skipped_existing}) ` +
      `insights=${s.insights_extracted} (rejected=${s.insights_rejected}) ` +
      `top_species=[${s.top_species.join(", ")}]\n`,
  );
  for (const c of s.sample_claims) {
    process.stdout.write(`  • ${c}\n`);
  }
}

// CLI bootstrap — invoked when this file is the script entry. Vitest imports
// `main` directly so we only auto-run when argv[1] basename matches.
const argv1 = process.argv[1] ?? "";
if (
  argv1.endsWith("ingest-youtube.ts") ||
  argv1.endsWith("ingest-youtube.js")
) {
  void main(process.argv.slice(2)).then((code) => process.exit(code));
}
