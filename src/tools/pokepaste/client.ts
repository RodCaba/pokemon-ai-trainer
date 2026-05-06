/**
 * HTTP client for `pokepast.es/<paste_id>/raw`. Stage 4 stub — every
 * method throws "not implemented (Stage 5)".
 */

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

/**
 * Build a {@link PokepasteClient}. Stub — throws "not implemented (Stage 5)".
 *
 * **When to use it:** as the dep injected into `fetchPaste` and the
 * labmaus ingest hook. Tests inject `fetchImpl` + `clock` to avoid real
 * network.
 *
 * @param opts — see {@link PokepasteClientOptions}.
 * @returns A {@link PokepasteClient}.
 * @throws Always (Stage 4 stub).
 */
export function createPokepasteClient(_opts: PokepasteClientOptions): PokepasteClient {
  throw new Error("not implemented (Stage 5)");
}
