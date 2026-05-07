/**
 * HTTP client for `pikalytics.com/ai/pokedex/<format>/<species>`. Throttled at
 * 1 rps by default (Cloudflare-fronted host; per-host bucket independent of
 * pokepaste / labmaus), retries 429/5xx with exponential backoff, and caches
 * 200 responses to disk forever (content is essentially immutable for a given
 * species + as_of). 404 responses are NOT cached so a future-coverage species
 * is retried on the next ingest.
 */

import {
  PikalyticsNetworkError,
  PikalyticsNotFoundError,
} from "../../schemas/errors";
import { createTokenBucket } from "../_shared/throttle";
import { createFileCache } from "../_shared/file-cache";

const BASE_URL = "https://www.pikalytics.com";
const FORMAT_SLUG = "gen9championsvgc2026regma";
const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent": "pokemon-ai-trainer/0.1 (pikalytics client)",
};

/** Configuration for {@link createPikalyticsClient}. */
export interface PikalyticsClientOptions {
  /** Absolute path under `data/cache/pikalytics`. */
  cacheDir: string;
  /** Sustained request rate. Default 1 (Cloudflare politeness). */
  throttleRps: number;
  /** Max retry attempts on 429/5xx. Default 3. */
  maxRetries: number;
  /** Base delay for exponential backoff in ms. Default 1000. */
  backoffBaseMs: number;
  /** Injectable `fetch` for tests. */
  fetchImpl?: typeof fetch;
  /** Injectable clock for tests. */
  clock?: () => number;
}

/** Result of one raw fetch — the markdown body and both URL forms. */
export interface PikalyticsRawFetch {
  /** Raw markdown body. */
  body: string;
  /** Human-facing URL — used for citations on persisted records. */
  source_url: string;
  /** Machine-facing AI-markdown URL — what we re-fetch from. */
  ai_url: string;
}

/**
 * Thin HTTP client around pikalytics's AI-markdown endpoint. Returns the raw
 * markdown body on success; throws `PikalyticsNotFoundError` on 404 and
 * `PikalyticsNetworkError` on other failure classes.
 */
export interface PikalyticsClient {
  /**
   * GET `https://www.pikalytics.com/ai/pokedex/gen9championsvgc2026regma/<slug>`.
   *
   * @param species_slug — Showdown-style hyphenated lowercase id.
   * @param as_of_hint — Optional upstream `as_of` (extends the cache key).
   * @returns The raw markdown body + both URL forms.
   * @throws {PikalyticsNetworkError} On HTTP exhaustion.
   * @throws {PikalyticsNotFoundError} On HTTP 404.
   */
  fetchSpeciesMarkdown(
    species_slug: string,
    as_of_hint?: string,
  ): Promise<PikalyticsRawFetch>;
}

const sleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function urls(slug: string): { ai: string; human: string } {
  return {
    ai: `${BASE_URL}/ai/pokedex/${FORMAT_SLUG}/${slug}`,
    human: `${BASE_URL}/pokedex/${FORMAT_SLUG}/${slug}`,
  };
}

/**
 * Build a {@link PikalyticsClient}.
 *
 * **When to use it:** as the dep injected into `fetchSpecies` and the pikalytics
 * ingest script. Tests inject `fetchImpl` + `clock` to avoid real network.
 *
 * @param opts — see {@link PikalyticsClientOptions}.
 * @returns A {@link PikalyticsClient}.
 */
export function createPikalyticsClient(opts: PikalyticsClientOptions): PikalyticsClient {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const bucket = createTokenBucket({
    refillPerSec: opts.throttleRps,
    clock: opts.clock,
  });
  const cache = createFileCache({
    dir: opts.cacheDir,
    ttlMs: Number.POSITIVE_INFINITY,
  });

  return {
    async fetchSpeciesMarkdown(
      species_slug: string,
      as_of_hint?: string,
    ): Promise<PikalyticsRawFetch> {
      const { ai, human } = urls(species_slug);
      const cacheKey = as_of_hint ? `${species_slug}__${as_of_hint}` : species_slug;
      const cached = cache.read(cacheKey);
      if (cached !== undefined) {
        return { body: cached, source_url: human, ai_url: ai };
      }

      let attempt = 0;
      let lastStatus = 0;
      while (attempt <= opts.maxRetries) {
        await bucket.acquire();
        const res = await fetchImpl(ai, { headers: DEFAULT_HEADERS });
        lastStatus = res.status;
        if (res.ok) {
          const body = await res.text();
          cache.write(cacheKey, body);
          return { body, source_url: human, ai_url: ai };
        }
        if (res.status === 404) {
          // 404 is NOT retried and NOT cached — species may be in coverage on
          // a later run.
          throw new PikalyticsNotFoundError(`pikalytics 404: ${species_slug}`, {
            species_roster_id: species_slug,
          });
        }
        const retryable = res.status === 429 || (res.status >= 500 && res.status < 600);
        if (!retryable || attempt === opts.maxRetries) {
          throw new PikalyticsNetworkError(
            `pikalytics ${ai} failed: HTTP ${lastStatus}`,
            { species_roster_id: species_slug, status: lastStatus },
          );
        }
        const backoff = opts.backoffBaseMs * 2 ** attempt;
        await sleep(backoff);
        attempt++;
      }
      throw new PikalyticsNetworkError(
        `pikalytics ${ai} retries exhausted (status=${lastStatus})`,
        { species_roster_id: species_slug, status: lastStatus },
      );
    },
  };
}
