/**
 * Time-windowed transcript chunker. 90s window, 15s overlap (step=75s).
 * Output is deterministic, ordered by anchor; each chunk's
 * `chunk_token_count` is computed via the Anthropic tokenizer.
 *
 * Per `docs/plans/youtube-insights.md` §15.8 — when a single 90s window
 * exceeds the 500-token cap we throw `KnowledgeStorageError`; we do NOT
 * re-window finer.
 */

import { getTokenizer } from "@anthropic-ai/tokenizer";
import { KnowledgeStorageError } from "../../schemas/errors";
import type { TranscriptSegment } from "./parse-transcript";

/** Knobs for {@link chunkTranscript}. Defaults: 90s window, 15s overlap. */
export interface TranscriptChunkOptions {
  window_s: number;
  overlap_s: number;
}

/** One time-windowed chunk emitted by {@link chunkTranscript}. */
export interface TranscriptChunk {
  chunk_index: number;
  chunk_text: string;
  chunk_token_count: number;
  timestamp_start_seconds: number;
  timestamp_end_seconds: number;
}

const DEFAULT_OPTS: TranscriptChunkOptions = {
  window_s: 90,
  overlap_s: 15,
};

const MAX_TOKENS = 500;

/**
 * Group transcript segments into time-windowed chunks.
 *
 * **When to use it:** between {@link parseTranscript} and the embed/extract
 * pipeline in YouTube ingest. Sibling to `chunkExtractedArticle` — heading
 * chunking does not apply to transcripts (no headings); time windows do.
 *
 * @param segments - Sorted-by-`start_s`-ascending transcript segments.
 *   Defensive sort still done internally.
 * @param opts - Window / overlap knobs (defaults 90s / 15s). `0 ≤ overlap_s < window_s`.
 * @returns Deterministic ordered array of {@link TranscriptChunk}s; `[]` on empty input.
 * @throws {RangeError} When `overlap_s ≥ window_s`.
 * @throws {KnowledgeStorageError} When a single window exceeds 500 tokens
 *   (per plan §15.8 — no finer re-windowing).
 *
 * @example
 *   const chunks = chunkTranscript(parseTranscript(raw), { window_s: 90, overlap_s: 15 });
 */
export function chunkTranscript(
  segments: TranscriptSegment[],
  opts?: Partial<TranscriptChunkOptions>,
): TranscriptChunk[] {
  if (segments.length === 0) return [];
  const window_s = opts?.window_s ?? DEFAULT_OPTS.window_s;
  const overlap_s = opts?.overlap_s ?? DEFAULT_OPTS.overlap_s;
  if (overlap_s >= window_s) {
    throw new RangeError(
      `chunkTranscript: overlap_s (${overlap_s}) must be < window_s (${window_s})`,
    );
  }
  const step_s = window_s - overlap_s;

  const sorted = [...segments].sort((a, b) => a.start_s - b.start_s);
  const last = sorted[sorted.length - 1]!;
  const totalEnd = last.start_s + last.duration_s;

  // Special case: the entire transcript is one segment longer than `window_s`.
  // Emit a single chunk that captures the full extent (per YT-T9).
  if (sorted.length === 1) {
    return [makeChunk(0, sorted, sorted[0]!.start_s, totalEnd)];
  }

  // Special case: total extent shorter than window — one chunk.
  if (totalEnd <= window_s) {
    return [makeChunk(0, sorted, 0, totalEnd)];
  }

  const out: TranscriptChunk[] = [];
  let chunkIndex = 0;
  for (let anchor = 0; anchor < totalEnd; anchor += step_s) {
    const windowEnd = anchor + window_s;
    // Collect segments whose start_s falls in [anchor, anchor+window_s).
    const inWindow = sorted.filter(
      (s) => s.start_s >= anchor && s.start_s < windowEnd,
    );
    if (inWindow.length === 0) {
      // Once we pass the last segment's start, stop emitting empties.
      if (anchor > last.start_s) break;
      continue;
    }
    const ts_end = Math.min(windowEnd, totalEnd);
    out.push(makeChunk(chunkIndex, inWindow, anchor, ts_end));
    chunkIndex++;
  }
  return out;
}

function makeChunk(
  index: number,
  segments: TranscriptSegment[],
  ts_start: number,
  ts_end: number,
): TranscriptChunk {
  const text = segments.map((s) => s.text).join(" ").trim();
  const tk = getTokenizer();
  let tokenCount: number;
  try {
    tokenCount = tk.encode(text, "all").length;
  } finally {
    tk.free();
  }
  if (tokenCount > MAX_TOKENS) {
    throw new KnowledgeStorageError(
      `chunkTranscript: window [${ts_start}..${ts_end}] yields ${tokenCount} tokens (> ${MAX_TOKENS} cap); per plan §15.8 we do not re-window finer`,
    );
  }
  return {
    chunk_index: index,
    chunk_text: text,
    chunk_token_count: Math.max(1, tokenCount),
    timestamp_start_seconds: ts_start,
    timestamp_end_seconds: ts_end,
  };
}
