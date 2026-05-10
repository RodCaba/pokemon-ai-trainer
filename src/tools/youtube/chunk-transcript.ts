/**
 * Stage 4 stub for the time-windowed transcript chunker.
 * Real implementation lands in Stage 5; see `docs/plans/youtube-insights.md` §2.2.
 */

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

/**
 * Group transcript segments into 90s windows with 15s overlap.
 *
 * **When to use it:** the chunker for YouTube transcripts. Sibling to
 * `chunkExtractedArticle` — heading-driven chunking does not apply to
 * transcripts (no headings); time windows do. Both emit `KnowledgeChunk`-shaped
 * downstream output so persistence stays polymorphic.
 *
 * @param _segments — Sorted-by-`start_s`-ascending transcript segments
 *                    (defensive sort still done internally).
 * @param _opts — Window / overlap knobs (defaults 90s / 15s). `0 ≤ overlap_s < window_s`.
 * @returns Deterministic ordered array of {@link TranscriptChunk}s; `[]` on empty input.
 * @throws Never on bad inputs in v1; Stage 5 may surface a `RangeError` on
 *         `overlap_s ≥ window_s`.
 *
 * @example
 *   const chunks = chunkTranscript(parseTranscript(raw), { window_s: 90, overlap_s: 15 });
 */
export function chunkTranscript(
  _segments: TranscriptSegment[],
  _opts?: Partial<TranscriptChunkOptions>,
): TranscriptChunk[] {
  throw new Error("chunkTranscript: not implemented (Stage 5)");
}
