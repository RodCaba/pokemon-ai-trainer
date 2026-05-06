/**
 * HTTP client for `pokepast.es/<paste_id>/raw`. Throttled at 2 rps (per-host
 * bucket independent from labmaus's 1 rps), retries 429/5xx with exponential
 * backoff, and caches 200 responses to disk forever (URLs are content-hashed
 * → bodies are immutable). 404 responses are NOT cached.
 */

import {
  PokepasteNetworkError,
  PokepasteNotFoundError,
} from "../../schemas/errors";
import { createTokenBucket } from "../_shared/throttle";
import { createFileCache } from "../_shared/file-cache";

const BASE_URL = "https://pokepast.es";
const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent": "pokemon-ai-trainer/0.1 (pokepaste client)",
};

/** Configuration for {@link createPokepasteClient}. */
export interface PokepasteClientOptions {
  /** Absolute path under `data/cache/pokepaste`. */
  cacheDir: string;
  /** Sustained request rate. Default 2 (separate bucket from labmaus). */
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

/**
 * Thin HTTP client around `pokepast.es`'s `/raw` endpoint. Returns the
 * raw plaintext Showdown export on success.
 */
export interface PokepasteClient {
  /**
   * GET `https://pokepast.es/<paste_id>/raw`.
   *
   * @param paste_id — Hex hash from the URL.
   * @returns The raw Showdown export plaintext.
   * @throws {PokepasteNetworkError} On HTTP exhaustion.
   * @throws {PokepasteNotFoundError} On HTTP 404.
   */
  fetchRaw(paste_id: string): Promise<string>;
}

const sleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Build a {@link PokepasteClient}.
 *
 * **When to use it:** as the dep injected into `fetchPaste` and the
 * labmaus ingest hook. Tests inject `fetchImpl` + `clock` to avoid real
 * network.
 *
 * @param opts — see {@link PokepasteClientOptions}.
 * @returns A {@link PokepasteClient}.
 */
export function createPokepasteClient(opts: PokepasteClientOptions): PokepasteClient {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const bucket = createTokenBucket({
    capacity: 1,
    refillPerSec: opts.throttleRps,
    clock: opts.clock,
  });
  const cache = createFileCache({ dir: opts.cacheDir });

  return {
    async fetchRaw(paste_id: string): Promise<string> {
      const cached = cache.read(paste_id);
      if (cached !== undefined) return cached;

      const url = `${BASE_URL}/${paste_id}/raw`;
      let attempt = 0;
      let lastStatus = 0;
      while (attempt <= opts.maxRetries) {
        await bucket.acquire();
        const res = await fetchImpl(url, { headers: DEFAULT_HEADERS });
        lastStatus = res.status;
        if (res.ok) {
          const body = await res.text();
          cache.write(paste_id, body);
          return body;
        }
        if (res.status === 404) {
          throw new PokepasteNotFoundError(`pokepaste 404: ${paste_id}`, { paste_id });
        }
        const retryable = res.status === 429 || (res.status >= 500 && res.status < 600);
        if (!retryable || attempt === opts.maxRetries) {
          throw new PokepasteNetworkError(
            `pokepaste ${url} failed: HTTP ${lastStatus}`,
            { paste_id, status: lastStatus },
          );
        }
        const backoff = opts.backoffBaseMs * 2 ** attempt;
        await sleep(backoff);
        attempt++;
      }
      throw new PokepasteNetworkError(
        `pokepaste ${url} retries exhausted (status=${lastStatus})`,
        { paste_id, status: lastStatus },
      );
    },
  };
}
