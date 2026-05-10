/**
 * Transcript normalization. Decodes HTML entities, drops filler segments
 * (`[Music]`, `[Applause]`, etc.), preserves order + timestamps + duration.
 */

import type { YoutubeTranscriptSegment } from "./client";

/**
 * Canonical transcript-segment shape consumed by the chunker.
 */
export interface TranscriptSegment {
  text: string;
  start_s: number;
  duration_s: number;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Decode common HTML entities (numeric + a small named subset). */
function decodeHtmlEntities(s: string): string {
  // Multiple passes: e.g. `&amp;#39;` → `&#39;` → `'`.
  let prev: string;
  let cur = s;
  for (let i = 0; i < 3; i++) {
    prev = cur;
    cur = cur.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (_, ent: string) => {
      if (ent.startsWith("#x") || ent.startsWith("#X")) {
        const cp = Number.parseInt(ent.slice(2), 16);
        return Number.isFinite(cp) ? String.fromCodePoint(cp) : _;
      }
      if (ent.startsWith("#")) {
        const cp = Number.parseInt(ent.slice(1), 10);
        return Number.isFinite(cp) ? String.fromCodePoint(cp) : _;
      }
      return NAMED_ENTITIES[ent.toLowerCase()] ?? _;
    });
    if (cur === prev) break;
  }
  return cur;
}

const FILLER_RE = /^\s*\[(music|applause|laughter|cheering|silence|sound effects?)\]\s*$/i;

/**
 * Normalize raw transcript segments from the `youtube-transcript` package.
 *
 * **When to use it:** between `youtubeClient.fetchTranscript(...)` and
 * `chunkTranscript(...)` in the ingest pipeline.
 *
 * @param raw - Segments as returned by the package (already shape-normalized
 *   by the client wrapper).
 * @returns Normalized segments — same order; HTML entities decoded; filler
 *   segments (`[Music]`, `[Applause]`, ...) dropped.
 * @throws Never — pure function.
 *
 * @example
 *   const segments = parseTranscript(await yt.fetchTranscript(id));
 */
export function parseTranscript(
  raw: YoutubeTranscriptSegment[],
): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  for (const seg of raw) {
    const decoded = decodeHtmlEntities(seg.text ?? "");
    if (FILLER_RE.test(decoded)) continue;
    out.push({
      text: decoded,
      start_s: seg.start_s,
      duration_s: seg.duration_s,
    });
  }
  return out;
}
