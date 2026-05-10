/**
 * Stage 4 stub for the YouTube transcript + watch-page metadata client.
 * Real implementation lands in Stage 5; see `docs/plans/youtube-insights.md` §2.2.
 */

import { YoutubeFetchError } from "../../schemas/errors";

/** One transcript segment from the `youtube-transcript` package, normalized. */
export interface YoutubeTranscriptSegment {
  text: string;
  start_s: number;
  duration_s: number;
}

/** Watch-page metadata gathered alongside the transcript. */
export interface YoutubeVideoMetadata {
  video_id: string;
  title: string;
  channel: string;
  published_at: string | null;
  duration_s: number | null;
  canonical_url: string;
  fetched_at: string;
  language: string | null;
}

/** Duck-typed seam over the `youtube-transcript` npm package. */
export interface YoutubeTranscriptImpl {
  fetchTranscript(videoIdOrUrl: string): Promise<unknown>;
}

/** Configuration for {@link createYoutubeClient}. */
export interface YoutubeClientOptions {
  fetchImpl?: typeof fetch;
  transcriptImpl?: YoutubeTranscriptImpl;
  cacheDir?: string;
  cacheTtlMs?: number;
  throttleRps?: number;
  clock?: () => number;
}

/** Public surface of the YouTube client. */
export interface YoutubeClient {
  fetchTranscript(videoId: string): Promise<YoutubeTranscriptSegment[]>;
  fetchMetadata(videoId: string): Promise<YoutubeVideoMetadata>;
}

/**
 * Build a {@link YoutubeClient}.
 *
 * **When to use it:** the dep injected into `scripts/data/ingest-youtube.ts`.
 * Tests inject `transcriptImpl` + `fetchImpl` to avoid real network.
 *
 * @param _opts — see {@link YoutubeClientOptions}.
 * @returns A {@link YoutubeClient}; v1 stub throws on every method.
 * @throws {YoutubeFetchError} (from real impl) on every documented failure mode.
 */
export function createYoutubeClient(_opts?: YoutubeClientOptions): YoutubeClient {
  return {
    async fetchTranscript(videoId: string): Promise<YoutubeTranscriptSegment[]> {
      throw new YoutubeFetchError({
        kind: "network",
        video_id: videoId,
        message: "not implemented (Stage 5)",
      });
    },
    async fetchMetadata(videoId: string): Promise<YoutubeVideoMetadata> {
      throw new YoutubeFetchError({
        kind: "network",
        video_id: videoId,
        message: "not implemented (Stage 5)",
      });
    },
  };
}

/**
 * Convenience: fetch a transcript by id with injectable deps.
 *
 * **When to use it:** thin functional alternative to `createYoutubeClient` for
 * callers that only need the transcript fetch. Stage 5 wires the real impl.
 *
 * @param videoId — 11-char YouTube video id.
 * @param _deps — Injection slots.
 * @returns Transcript segments.
 * @throws {YoutubeFetchError} On every failure mode.
 */
export async function fetchVideoTranscript(
  videoId: string,
  _deps?: YoutubeClientOptions,
): Promise<YoutubeTranscriptSegment[]> {
  throw new YoutubeFetchError({
    kind: "network",
    video_id: videoId,
    message: "not implemented (Stage 5)",
  });
}

/**
 * Default export used by the ingest script. Created lazily so tests can
 * substitute via the `deps?.ytClient` injection slot.
 */
export const youtubeTranscriptClient: YoutubeClient = createYoutubeClient();
