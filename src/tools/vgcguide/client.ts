/**
 * HTTP client for `vgcguide.com`. Throttled at 2 RPS by default (Squarespace;
 * politeness; no observed rate limit). Retries 429/5xx with exponential
 * backoff. Caches 200 responses to disk with a finite 7-day TTL (Aaron edits
 * articles occasionally; weekly cron picks up edits without re-fetching every
 * run). 404 responses are NOT cached.
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
import { parseVgcGuideSitemap } from "./sitemap";

const BASE_URL = "https://www.vgcguide.com";
const SITEMAP_URL = `${BASE_URL}/sitemap.xml`;
const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent": "pokemon-ai-trainer/0.1 (vgcguide client)",
};
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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
export type VgcGuideArticleFetch = KnowledgeArticleFetch;

/**
 * Thin HTTP client around the vgcguide sitemap + article endpoints.
 *
 * Type-aliased to the shared {@link KnowledgeArticleClient} contract so
 * site-agnostic helpers (e.g. ingest scripts) accept either vgcguide or
 * metavgc clients without a discriminated union. See plan §19.1.
 */
export type VgcGuideClient = KnowledgeArticleClient;

const sleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Build a {@link VgcGuideClient}.
 *
 * **When to use it:** the dep injected into the vgcguide ingest script.
 * Tests inject `fetchImpl` + `clock` to avoid real network.
 *
 * @param opts — see {@link VgcGuideClientOptions}.
 * @returns A {@link VgcGuideClient}.
 * @throws {KnowledgeArticleNetworkError} from `fetchSitemap` / `fetchArticleHtml` on HTTP exhaustion.
 * @throws {KnowledgeArticleNotFoundError} from `fetchArticleHtml` on HTTP 404.
 */
export function createVgcGuideClient(opts: VgcGuideClientOptions): VgcGuideClient {
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
        throw new KnowledgeArticleNotFoundError(`vgcguide 404: ${url}`, {
          article_slug: slug,
          source_site: "vgcguide",
        });
      }
      const retryable =
        res.status === 429 || (res.status >= 500 && res.status < 600);
      if (!retryable || attempt === maxRetries) {
        throw new KnowledgeArticleNetworkError(
          `vgcguide ${url} failed: HTTP ${lastStatus}`,
          { article_slug: slug, source_site: "vgcguide", status: lastStatus },
        );
      }
      const backoff = backoffBaseMs * 2 ** attempt;
      await sleep(backoff);
      attempt++;
    }
    throw new KnowledgeArticleNetworkError(
      `vgcguide ${url} retries exhausted (status=${lastStatus})`,
      { article_slug: slug, source_site: "vgcguide", status: lastStatus },
    );
  }

  return {
    async fetchSitemap(): Promise<string[]> {
      const xml = await fetchWithRetry(SITEMAP_URL);
      return parseVgcGuideSitemap(xml);
    },

    async fetchArticleHtml(slug: string): Promise<VgcGuideArticleFetch> {
      const article_url = `${BASE_URL}/${slug}`;
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
