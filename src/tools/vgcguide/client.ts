/**
 * HTTP client for `vgcguide.com`. Throttled at 2 RPS by default (Squarespace;
 * politeness; no observed rate limit). Retries 429/5xx with exponential
 * backoff. Caches 200 responses to disk with a finite 7-day TTL (Aaron edits
 * articles occasionally; weekly cron picks up edits without re-fetching every
 * run). 404 responses are NOT cached.
 *
 * Stage 4 stub: every method throws `not implemented (Stage 5)`. The
 * full implementation lands in Stage 5 alongside the failing tests in
 * `tests/tools/vgcguide/client.test.ts`.
 */

/** Configuration for {@link createVgcGuideClient}. */
export interface VgcGuideClientOptions {
  /** Absolute path under `data/cache/vgcguide`. */
  cacheDir: string;
  /** Sustained request rate. Default 2. */
  throttleRps?: number;
  /** Max retry attempts on 429/5xx. Default 3. */
  maxRetries?: number;
  /** Base delay for exponential backoff in ms. Default 1000. */
  backoffBaseMs?: number;
  /** Cache TTL in ms. Default 7 days. `Number.POSITIVE_INFINITY` accepted. */
  cacheTtlMs?: number;
  /** Injectable `fetch` for tests. */
  fetchImpl?: typeof fetch;
  /** Injectable clock for tests. */
  clock?: () => number;
}

/** Result of one article fetch. */
export interface VgcGuideArticleFetch {
  slug: string;
  html: string;
  /** Canonical https://www.vgcguide.com/&lt;slug&gt;. */
  article_url: string;
  /** ISO-8601 UTC fetch timestamp. */
  fetched_at: string;
}

/**
 * Thin HTTP client around the vgcguide sitemap + article endpoints.
 */
export interface VgcGuideClient {
  /** GET sitemap.xml; returns canonical absolute article URLs. */
  fetchSitemap(): Promise<string[]>;
  /** GET https://www.vgcguide.com/&lt;slug&gt;; returns the raw HTML + URL + fetched_at. */
  fetchArticleHtml(slug: string): Promise<VgcGuideArticleFetch>;
}

/**
 * Build a {@link VgcGuideClient}.
 *
 * **When to use it:** the dep injected into the vgcguide ingest script.
 * Tests inject `fetchImpl` + `clock` to avoid real network.
 *
 * @param opts — see {@link VgcGuideClientOptions}.
 * @returns A {@link VgcGuideClient}.
 * @throws {VgcGuideNetworkError} from `fetchSitemap` / `fetchArticleHtml` on HTTP exhaustion.
 * @throws {VgcGuideNotFoundError} from `fetchArticleHtml` on HTTP 404.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function createVgcGuideClient(opts: VgcGuideClientOptions): VgcGuideClient {
  return {
    fetchSitemap(): Promise<string[]> {
      throw new Error("not implemented (Stage 5)");
    },
    fetchArticleHtml(_slug: string): Promise<VgcGuideArticleFetch> {
      throw new Error("not implemented (Stage 5)");
    },
  };
}
