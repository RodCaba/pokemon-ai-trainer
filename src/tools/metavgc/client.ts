/**
 * HTTP client for `metavgc.com`. Throttled at 2 RPS by default (politeness;
 * no published rate limit; robots.txt has no Crawl-delay). Retries 429/5xx
 * with exponential backoff. Caches 200 responses to disk with a finite 7-day
 * TTL. 404 responses are NOT cached.
 *
 * Mirrors `src/tools/vgcguide/client.ts` and satisfies the shared
 * {@link KnowledgeArticleClient} contract so site-agnostic helpers
 * (ingest scripts, `discoverScope`) accept either client.
 */

import {
  KnowledgeArticleNetworkError,
  KnowledgeArticleNotFoundError,
} from "../../schemas/errors";
import { createTokenBucket } from "../_shared/throttle";
import { createFileCache } from "../_shared/file-cache";
import type {
  KnowledgeArticleClient,
  KnowledgeArticleFetch,
} from "../knowledge/article-client";
import { parseMetaVgcSitemap } from "./sitemap";

const BASE_URL = "https://metavgc.com";
const SITEMAP_URL = `${BASE_URL}/sitemap.xml`;
const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent": "pokemon-ai-trainer/0.1 (metavgc client)",
};
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Configuration for {@link createMetaVgcClient}. Mirrors `VgcGuideClientOptions`. */
export interface MetaVgcClientOptions {
  /** Absolute path under `data/cache/metavgc`. */
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
export type MetaVgcArticleFetch = KnowledgeArticleFetch;

/**
 * Type alias to the shared {@link KnowledgeArticleClient} contract — the
 * metavgc client adds no surface beyond `fetchSitemap` + `fetchArticleHtml`.
 */
export type MetaVgcClient = KnowledgeArticleClient;

const sleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Build a {@link MetaVgcClient}.
 *
 * **When to use it:** the dep injected into the metavgc ingest script. Tests
 * inject `fetchImpl` + `clock` to avoid real network. Both methods route
 * through the shared throttle + file-cache primitives so the cron stays under
 * the 2 RPS politeness ceiling and unchanged guides skip the network on
 * subsequent runs.
 *
 * @param opts — see {@link MetaVgcClientOptions}.
 * @returns A {@link MetaVgcClient}.
 * @throws {KnowledgeArticleNetworkError} from `fetchSitemap` /
 *   `fetchArticleHtml` after retry exhaustion or non-retryable HTTP failure.
 * @throws {KnowledgeArticleNotFoundError} from `fetchArticleHtml` on HTTP 404
 *   (no retry, not cached).
 *
 * @example
 * ```ts
 * const client = createMetaVgcClient({
 *   cacheDir: "data/cache/metavgc",
 *   throttleRps: 2,
 *   maxRetries: 3,
 *   backoffBaseMs: 1000,
 * });
 * const urls = await client.fetchSitemap();
 * ```
 */
export function createMetaVgcClient(
  opts: MetaVgcClientOptions,
): MetaVgcClient {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const throttleRps = opts.throttleRps ?? 2;
  const maxRetries = opts.maxRetries ?? 3;
  const backoffBaseMs = opts.backoffBaseMs ?? 1000;
  const ttlMs = opts.cacheTtlMs ?? DEFAULT_TTL_MS;
  const clock = opts.clock ?? ((): number => Date.now());
  const bucket = createTokenBucket({ refillPerSec: throttleRps, clock });
  const cache = createFileCache({ dir: opts.cacheDir, ttlMs, clock });

  async function fetchWithRetry(url: string, slug?: string): Promise<string> {
    let attempt = 0;
    let lastStatus = 0;
    while (attempt <= maxRetries) {
      await bucket.acquire();
      const res = await fetchImpl(url, { headers: DEFAULT_HEADERS });
      lastStatus = res.status;
      if (res.ok) {
        return await res.text();
      }
      if (res.status === 404) {
        throw new KnowledgeArticleNotFoundError(`metavgc 404: ${url}`, {
          article_slug: slug,
          source_site: "metavgc",
        });
      }
      const retryable =
        res.status === 429 || (res.status >= 500 && res.status < 600);
      if (!retryable || attempt === maxRetries) {
        throw new KnowledgeArticleNetworkError(
          `metavgc ${url} failed: HTTP ${lastStatus}`,
          { article_slug: slug, source_site: "metavgc", status: lastStatus },
        );
      }
      const backoff = backoffBaseMs * 2 ** attempt;
      await sleep(backoff);
      attempt++;
    }
    throw new KnowledgeArticleNetworkError(
      `metavgc ${url} retries exhausted (status=${lastStatus})`,
      { article_slug: slug, source_site: "metavgc", status: lastStatus },
    );
  }

  return {
    async fetchSitemap(): Promise<string[]> {
      const xml = await fetchWithRetry(SITEMAP_URL);
      return parseMetaVgcSitemap(xml);
    },

    async fetchArticleHtml(slug: string): Promise<MetaVgcArticleFetch> {
      const article_url = `${BASE_URL}/guides/${slug}`;
      const cached = cache.read(slug);
      if (cached !== undefined) {
        return {
          slug,
          html: cached,
          article_url,
          fetched_at: new Date(clock()).toISOString(),
        };
      }
      const html = await fetchWithRetry(article_url, slug);
      cache.write(slug, html);
      return {
        slug,
        html,
        article_url,
        fetched_at: new Date(clock()).toISOString(),
      };
    },
  };
}
