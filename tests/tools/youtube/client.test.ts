/**
 * YT-T13..YT-T20 — Stage 4 tests for the YouTube client wrapper.
 * Stage 4: every test fails because Stage 5 stubs throw NotImplemented.
 */

import { describe, expect, it } from "vitest";
import {
  createYoutubeClient,
  fetchVideoTranscript,
  type YoutubeTranscriptImpl,
} from "../../../src/tools/youtube/client";
import { YoutubeFetchError } from "../../../src/schemas/errors";

describe("youtube/client (YT-T13..YT-T20)", () => {
  it("YT-T13. fetchTranscript returns YoutubeTranscriptSegment[] from the underlying package", async () => {
    const transcriptImpl: YoutubeTranscriptImpl = {
      async fetchTranscript() {
        return [
          { text: "Hello", offset: 0, duration: 1 },
          { text: "World", offset: 1, duration: 1 },
          { text: "!", offset: 2, duration: 1 },
        ];
      },
    };
    const client = createYoutubeClient({ transcriptImpl });
    const segments = await client.fetchTranscript("J0eVKJyJ_DQ");
    expect(segments.length).toBe(3);
    expect(segments[0]?.text).toBe("Hello");
    expect(segments[0]?.start_s).toBe(0);
  });

  it("YT-T14. fetchTranscript throws YoutubeFetchError(no_captions) on TranscriptDisabled", async () => {
    class TranscriptDisabled extends Error {
      constructor() {
        super("captions disabled");
        this.name = "TranscriptDisabled";
      }
    }
    const transcriptImpl: YoutubeTranscriptImpl = {
      async fetchTranscript() {
        throw new TranscriptDisabled();
      },
    };
    const client = createYoutubeClient({ transcriptImpl });
    await expect(client.fetchTranscript("abc")).rejects.toMatchObject({
      name: "YoutubeFetchError",
      kind: "no_captions",
    });
  });

  it("YT-T15. fetchTranscript throws YoutubeFetchError(disabled) on owner-disabled captions", async () => {
    class CaptionsDisabled extends Error {
      constructor() {
        super("disabled by owner");
        this.name = "CaptionsDisabled";
      }
    }
    const transcriptImpl: YoutubeTranscriptImpl = {
      async fetchTranscript() {
        throw new CaptionsDisabled();
      },
    };
    const client = createYoutubeClient({ transcriptImpl });
    await expect(client.fetchTranscript("abc")).rejects.toBeInstanceOf(YoutubeFetchError);
  });

  it("YT-T16. fetchTranscript wraps generic network errors as YoutubeFetchError(network)", async () => {
    const transcriptImpl: YoutubeTranscriptImpl = {
      async fetchTranscript() {
        throw new Error("Network");
      },
    };
    const client = createYoutubeClient({ transcriptImpl });
    await expect(client.fetchTranscript("abc")).rejects.toMatchObject({
      kind: "network",
    });
  });

  it("YT-T17. fetchMetadata parses watch-page HTML for title + channel + published_at + language", async () => {
    const html = `<!doctype html><html><head>
      <meta property="og:title" content="Team Deep Dive"/>
      <meta itemprop="datePublished" content="2026-04-30"/>
      <meta itemprop="channelId" content="UCxxx"/>
      <link rel="canonical" href="https://www.youtube.com/watch?v=J0eVKJyJ_DQ"/>
      <script>"author":"VGCStream"</script>
      <html lang="en">
    </head><body></body></html>`;
    const fetchImpl: typeof fetch = async () =>
      new Response(html, { status: 200, headers: { "content-type": "text/html" } });
    const client = createYoutubeClient({ fetchImpl });
    const meta = await client.fetchMetadata("J0eVKJyJ_DQ");
    expect(meta.title).toBe("Team Deep Dive");
    expect(meta.language).toBe("en");
    expect(meta.canonical_url).toContain("J0eVKJyJ_DQ");
  });

  it("YT-T18. fetchMetadata returns language='ja' for Japanese watch page", async () => {
    const html = `<!doctype html><html lang="ja"><head>
      <meta property="og:title" content="日本語動画"/>
    </head><body></body></html>`;
    const fetchImpl: typeof fetch = async () =>
      new Response(html, { status: 200, headers: { "content-type": "text/html" } });
    const client = createYoutubeClient({ fetchImpl });
    const meta = await client.fetchMetadata("abc");
    expect(meta.language).toBe("ja");
  });

  it("YT-T19. client throttles to 1 RPS — three calls span ≥ 2000ms", async () => {
    const transcriptImpl: YoutubeTranscriptImpl = {
      async fetchTranscript() {
        return [];
      },
    };
    const t0 = Date.now();
    const client = createYoutubeClient({ transcriptImpl, throttleRps: 1 });
    await client.fetchTranscript("a");
    await client.fetchTranscript("b");
    await client.fetchTranscript("c");
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(2000);
  });

  it("YT-T20. fetchVideoTranscript convenience function is wired and throws YoutubeFetchError on failure", async () => {
    await expect(fetchVideoTranscript("abc")).rejects.toBeInstanceOf(YoutubeFetchError);
  });
});
