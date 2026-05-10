/**
 * YouTube transcript + watch-page metadata client. Wraps the
 * `youtube-transcript` npm package (duck-typed via {@link YoutubeTranscriptImpl})
 * and parses the watch-page HTML for title / channel / published_at / language.
 * Self-throttles via a shared token bucket (default 1 RPS).
 */

import { YoutubeFetchError } from "../../schemas/errors";
import { createTokenBucket, type TokenBucket } from "../_shared/throttle";

/** One transcript segment, normalized from the package's raw shape. */
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

interface RawSeg {
  text?: string;
  // package historically uses `offset` (ms or s); normalize defensively.
  offset?: number;
  start?: number;
  start_s?: number;
  duration?: number;
  duration_s?: number;
  dur?: number;
}

function normalizeSegments(raw: unknown): YoutubeTranscriptSegment[] {
  if (!Array.isArray(raw)) return [];
  const out: YoutubeTranscriptSegment[] = [];
  for (const r of raw) {
    if (typeof r !== "object" || r === null) continue;
    const seg = r as RawSeg;
    const text = typeof seg.text === "string" ? seg.text : "";
    // youtube-transcript v1 returns `offset` in seconds (despite the name).
    // Some forks return ms. We accept either: if value > 1e5 we assume ms.
    let start_s =
      typeof seg.start_s === "number"
        ? seg.start_s
        : typeof seg.start === "number"
          ? seg.start
          : typeof seg.offset === "number"
            ? seg.offset
            : 0;
    if (start_s > 1e5) start_s = start_s / 1000;
    let duration_s =
      typeof seg.duration_s === "number"
        ? seg.duration_s
        : typeof seg.duration === "number"
          ? seg.duration
          : typeof seg.dur === "number"
            ? seg.dur
            : 0;
    if (duration_s > 1e5) duration_s = duration_s / 1000;
    out.push({ text, start_s, duration_s });
  }
  return out;
}

/** Map a transcript-package error to a typed {@link YoutubeFetchError}. */
function classifyTranscriptError(e: unknown, video_id: string): YoutubeFetchError {
  const name =
    typeof e === "object" && e !== null && "name" in e
      ? String((e as { name: unknown }).name)
      : "";
  const msg =
    e instanceof Error ? e.message : typeof e === "string" ? e : "unknown";
  const lower = `${name} ${msg}`.toLowerCase();
  let kind: YoutubeFetchError["kind"];
  if (
    name === "TranscriptDisabled" ||
    lower.includes("transcript") && lower.includes("disabl")
  ) {
    kind = "no_captions";
  } else if (lower.includes("disabl") || lower.includes("captions")) {
    kind = "disabled";
  } else if (lower.includes("private")) {
    kind = "private";
  } else {
    kind = "network";
  }
  return new YoutubeFetchError({
    kind,
    video_id,
    message: msg,
    cause: e,
  });
}

function extractMeta(
  html: string,
  videoId: string,
  fetched_at: string,
): YoutubeVideoMetadata {
  const og = (prop: string): string | null => {
    const re = new RegExp(
      `<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']*)["']`,
      "i",
    );
    const m = html.match(re);
    return m?.[1] ?? null;
  };
  const itemprop = (prop: string): string | null => {
    const re = new RegExp(
      `<meta[^>]+itemprop=["']${prop}["'][^>]+content=["']([^"']*)["']`,
      "i",
    );
    const m = html.match(re);
    return m?.[1] ?? null;
  };
  const linkRel = (rel: string): string | null => {
    const re = new RegExp(
      `<link[^>]+rel=["']${rel}["'][^>]+href=["']([^"']*)["']`,
      "i",
    );
    const m = html.match(re);
    return m?.[1] ?? null;
  };

  const title = og("og:title") ?? "";
  const author = og("og:video:tag") ?? null;
  const channelMatch = html.match(/"author"\s*:\s*"([^"]+)"/);
  const channel = channelMatch?.[1] ?? author ?? "";
  const published_at = itemprop("datePublished");
  const canonical_url =
    linkRel("canonical") ?? `https://www.youtube.com/watch?v=${videoId}`;
  const langMatch = html.match(/<html[^>]*\blang=["']([^"']+)["']/i);
  const language = langMatch?.[1] ?? null;
  const durationStr = itemprop("duration");
  let duration_s: number | null = null;
  if (durationStr !== null) {
    // ISO 8601 PT#H#M#S
    const m = durationStr.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
    if (m !== null) {
      const h = Number.parseInt(m[1] ?? "0", 10);
      const mi = Number.parseInt(m[2] ?? "0", 10);
      const s = Number.parseInt(m[3] ?? "0", 10);
      duration_s = h * 3600 + mi * 60 + s;
    }
  }

  return {
    video_id: videoId,
    title,
    channel,
    published_at,
    duration_s,
    canonical_url,
    fetched_at,
    language,
  };
}

/**
 * Build a {@link YoutubeClient}.
 *
 * **When to use it:** the dep injected into `scripts/data/ingest-youtube.ts`.
 * Tests inject `transcriptImpl` + `fetchImpl` to avoid real network.
 *
 * @param opts - Client options. See {@link YoutubeClientOptions}.
 * @returns A {@link YoutubeClient}.
 * @throws {YoutubeFetchError} (per call) on every documented failure mode.
 */
export function createYoutubeClient(opts?: YoutubeClientOptions): YoutubeClient {
  const fetchImpl: typeof fetch =
    opts?.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const transcriptImpl = opts?.transcriptImpl;
  const throttleRps = opts?.throttleRps ?? 1;
  const bucket: TokenBucket = createTokenBucket({
    refillPerSec: throttleRps,
    clock: opts?.clock,
  });

  return {
    async fetchTranscript(videoId: string): Promise<YoutubeTranscriptSegment[]> {
      await bucket.acquire();
      if (transcriptImpl === undefined) {
        // Lazy-load the npm package so unit tests that inject `transcriptImpl`
        // don't pay the import cost.
        let pkg: { YoutubeTranscript?: YoutubeTranscriptImpl } | null = null;
        try {
          pkg = (await import("youtube-transcript")) as unknown as {
            YoutubeTranscript?: YoutubeTranscriptImpl;
          };
        } catch (e) {
          throw new YoutubeFetchError({
            kind: "network",
            video_id: videoId,
            message: "youtube-transcript package not installed",
            cause: e,
          });
        }
        const impl = pkg?.YoutubeTranscript;
        if (impl === undefined) {
          throw new YoutubeFetchError({
            kind: "network",
            video_id: videoId,
            message: "youtube-transcript package missing YoutubeTranscript export",
          });
        }
        try {
          const raw = await impl.fetchTranscript(videoId);
          return normalizeSegments(raw);
        } catch (e) {
          throw classifyTranscriptError(e, videoId);
        }
      }
      try {
        const raw = await transcriptImpl.fetchTranscript(videoId);
        return normalizeSegments(raw);
      } catch (e) {
        throw classifyTranscriptError(e, videoId);
      }
    },
    async fetchMetadata(videoId: string): Promise<YoutubeVideoMetadata> {
      await bucket.acquire();
      const url = `https://www.youtube.com/watch?v=${videoId}`;
      const fetched_at = new Date().toISOString();
      let res: Response;
      try {
        res = await fetchImpl(url, { headers: { "user-agent": "pokemon-ai-trainer/0.0" } });
      } catch (e) {
        throw new YoutubeFetchError({
          kind: "network",
          video_id: videoId,
          message: e instanceof Error ? e.message : "fetch failed",
          cause: e,
        });
      }
      if (!res.ok) {
        throw new YoutubeFetchError({
          kind: "network",
          video_id: videoId,
          message: `watch page HTTP ${res.status}`,
        });
      }
      const html = await res.text();
      return extractMeta(html, videoId, fetched_at);
    },
  };
}

/**
 * Convenience: fetch a transcript by id with injectable deps.
 *
 * **When to use it:** thin functional alternative to {@link createYoutubeClient}
 * for callers that only need the transcript fetch.
 *
 * @param videoId - 11-char YouTube video id.
 * @param deps - Injection slots (test override).
 * @returns Transcript segments.
 * @throws {YoutubeFetchError} On every failure mode.
 */
export async function fetchVideoTranscript(
  videoId: string,
  deps?: YoutubeClientOptions,
): Promise<YoutubeTranscriptSegment[]> {
  const client = createYoutubeClient(deps);
  return client.fetchTranscript(videoId);
}

/**
 * Default client used by the ingest script. Lazily uses the real
 * `youtube-transcript` package + `globalThis.fetch`.
 */
export const youtubeTranscriptClient: YoutubeClient = createYoutubeClient();
