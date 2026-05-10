/**
 * YT-T6..YT-T12 — Stage 4 tests for the time-windowed transcript chunker.
 * Stage 4: every test fails because `chunkTranscript` throws "not implemented".
 */

import { describe, expect, it } from "vitest";
import { chunkTranscript } from "../../../src/tools/youtube/chunk-transcript";
import type { TranscriptSegment } from "../../../src/tools/youtube/parse-transcript";

/** 360 seconds of 5-second segments (72 segments). */
function makeSegments(totalSeconds: number, stepSeconds = 5): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  for (let t = 0; t < totalSeconds; t += stepSeconds) {
    out.push({ text: `seg ${t}`, start_s: t, duration_s: stepSeconds });
  }
  return out;
}

describe("youtube/chunk-transcript (YT-T6..YT-T12)", () => {
  it("YT-T6. default opts produce 90s windows with 15s overlap (anchors at 0,75,150,225,300)", () => {
    const segments = makeSegments(360);
    const chunks = chunkTranscript(segments);
    const anchors = chunks.map((c) => c.timestamp_start_seconds);
    expect(anchors).toEqual([0, 75, 150, 225, 300]);
  });

  it("YT-T7. empty input returns []", () => {
    expect(chunkTranscript([])).toEqual([]);
  });

  it("YT-T8. video shorter than window emits one chunk covering full extent", () => {
    const segments = makeSegments(45);
    const chunks = chunkTranscript(segments);
    expect(chunks.length).toBe(1);
    expect(chunks[0]?.timestamp_start_seconds).toBe(0);
  });

  it("YT-T9. single 240s segment longer than window emits one chunk", () => {
    const segments: TranscriptSegment[] = [
      { text: "monologue", start_s: 0, duration_s: 240 },
    ];
    const chunks = chunkTranscript(segments);
    expect(chunks.length).toBe(1);
  });

  it("YT-T10. preserves timestamp_start_seconds at first segment of each window", () => {
    const segments = makeSegments(360);
    const chunks = chunkTranscript(segments);
    expect(chunks[2]?.timestamp_start_seconds).toBe(150);
  });

  it("YT-T11. each chunk's chunk_token_count is ≤ 500", () => {
    const segments = makeSegments(360);
    const chunks = chunkTranscript(segments);
    for (const c of chunks) {
      expect(c.chunk_token_count).toBeLessThanOrEqual(500);
      expect(c.chunk_token_count).toBeGreaterThanOrEqual(1);
    }
  });

  it("YT-T12. determinism — identical input → identical output across two runs", () => {
    const segments = makeSegments(360);
    const a = chunkTranscript(segments);
    const b = chunkTranscript(segments);
    expect(a).toEqual(b);
  });
});
