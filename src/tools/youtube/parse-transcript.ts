/**
 * Stage 4 stub for transcript normalization.
 * Real implementation lands in Stage 5; see `docs/plans/youtube-insights.md` §2.2.
 */

import type { YoutubeTranscriptSegment } from "./client";

/**
 * Canonical transcript-segment shape consumed by the chunker. Stage 5 normalizes
 * the raw `youtube-transcript` package shape into this; v1 the two shapes are
 * structurally identical.
 */
export interface TranscriptSegment {
  text: string;
  start_s: number;
  duration_s: number;
}

/**
 * Normalize raw transcript segments from the `youtube-transcript` package into
 * canonical {@link TranscriptSegment}s.
 *
 * **When to use it:** between `youtubeClient.fetchTranscript(...)` and
 * `chunkTranscript(...)` in the ingest pipeline.
 *
 * @param _raw — Segments as returned by the package.
 * @returns Normalized segments — same length, same order; HTML entities decoded;
 *          `offset_ms` coerced to `start_s`.
 * @throws Never (pure function). Stage 5 may add a single-pass validation.
 *
 * @example
 *   const segments = parseTranscript(await yt.fetchTranscript(id));
 */
export function parseTranscript(
  _raw: YoutubeTranscriptSegment[],
): TranscriptSegment[] {
  throw new Error("parseTranscript: not implemented (Stage 5)");
}
