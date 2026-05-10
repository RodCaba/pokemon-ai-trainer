/**
 * YT-T4..YT-T5 — Stage 4 tests for transcript normalization.
 * Stage 4: every test fails because `parseTranscript` throws "not implemented".
 */

import { describe, expect, it } from "vitest";
import { parseTranscript } from "../../../src/tools/youtube/parse-transcript";
import type { YoutubeTranscriptSegment } from "../../../src/tools/youtube/client";

describe("youtube/parse-transcript (YT-T4..YT-T5)", () => {
  it("YT-T4. parseTranscript decodes HTML entities (e.g. &amp;#39; → ')", () => {
    const raw: YoutubeTranscriptSegment[] = [
      { text: "it&#39;s a great lead", start_s: 0, duration_s: 2 },
    ];
    const out = parseTranscript(raw);
    expect(out[0]?.text).toBe("it's a great lead");
  });

  it("YT-T5. parseTranscript preserves order + timestamps + duration", () => {
    const raw: YoutubeTranscriptSegment[] = [
      { text: "Hello", start_s: 0, duration_s: 1 },
      { text: "World", start_s: 1.5, duration_s: 1 },
    ];
    const out = parseTranscript(raw);
    expect(out.length).toBe(2);
    expect(out[1]?.start_s).toBe(1.5);
    expect(out[1]?.duration_s).toBe(1);
  });

  it("YT-T5b. parseTranscript on empty input returns []", () => {
    expect(parseTranscript([])).toEqual([]);
  });
});
