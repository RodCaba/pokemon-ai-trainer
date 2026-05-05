/**
 * HTTP client for labmaus.net's two public endpoints.
 *
 * Stage 4 stub — every method throws `not implemented (Stage 5)`. The exported
 * surface (interface + factory) is final so that tests, tools, and the ingest
 * script can take a typed dependency.
 */

const NI = "not implemented (Stage 5)";

/**
 * Configuration for {@link createLabmausClient}.
 */
export interface LabmausClientOptions {
  /** Absolute path under `data/cache/labmaus`. */
  cacheDir: string;
  /** Cache TTL in milliseconds. Default 24h. */
  cacheTtlMs: number;
  /** Sustained request rate. Default 1. */
  throttleRps: number;
  /** Max retry attempts on 429/5xx. Default 3. */
  maxRetries: number;
  /** Base delay for exponential backoff in ms. Default 1000. */
  backoffBaseMs: number;
  /** Injectable `fetch` implementation for tests. */
  fetchImpl?: typeof fetch;
  /** Injectable monotonic-clock for tests (token bucket + cache TTL). */
  clock?: () => number;
}

/**
 * Thin HTTP client around labmaus's two endpoints. Returns raw `unknown` JSON;
 * the caller is responsible for zod validation.
 */
export interface LabmausClient {
  /**
   * GET `/api/completed_tournaments?regulation=...&date_range=...`.
   *
   * @returns Raw JSON (caller validates).
   * @throws LabmausNetworkError on HTTP exhaustion.
   */
  listCompletedTournaments(args: {
    regulation: string;
    from: string;
    to: string;
  }): Promise<unknown>;

  /**
   * GET `/api/tournament?tournament=<id>&language=<lang>`.
   *
   * @returns Raw JSON (caller validates).
   * @throws LabmausNetworkError on HTTP exhaustion.
   */
  getTournament(args: { id: number; language?: "en" }): Promise<unknown>;
}

/**
 * Build a {@link LabmausClient}. Stage 5 will materialize the throttle, cache,
 * and retry logic; for Stage 4 the factory returns an object whose methods throw.
 *
 * **When to use it:** as the single dependency injected into `listTournaments` /
 * `getTournament` and the ingest script. Tests inject `fetchImpl` + `clock` to
 * avoid real network.
 *
 * @param opts — see {@link LabmausClientOptions}.
 * @returns A `LabmausClient` (stub in Stage 4).
 */
export function createLabmausClient(opts: LabmausClientOptions): LabmausClient {
  void opts;
  return {
    async listCompletedTournaments(): Promise<unknown> {
      throw new Error(NI);
    },
    async getTournament(): Promise<unknown> {
      throw new Error(NI);
    },
  };
}
