/**
 * Stage 4 stub for the pikalytics HTTP client. Real implementation lands in
 * Stage 5 per `docs/plans/pikalytics.md` §2 / §12.
 */

import { PikalyticsNetworkError } from "../../schemas/errors";

const _ERROR_REFS = [PikalyticsNetworkError];
void _ERROR_REFS;

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

/**
 * Build a {@link PikalyticsClient}.
 *
 * **When to use it:** as the dep injected into `fetchSpecies` and the pikalytics
 * ingest script. Tests inject `fetchImpl` + `clock` to avoid real network.
 *
 * @param opts — see {@link PikalyticsClientOptions}.
 * @returns A {@link PikalyticsClient}.
 */
export function createPikalyticsClient(_opts: PikalyticsClientOptions): PikalyticsClient {
  void _opts;
  return {
    async fetchSpeciesMarkdown(_species_slug: string, _as_of_hint?: string): Promise<PikalyticsRawFetch> {
      void _species_slug;
      void _as_of_hint;
      throw new Error("not implemented (Stage 5): pikalytics client.fetchSpeciesMarkdown");
    },
  };
}
