/**
 * HTTP client for labmaus.net's two public endpoints.
 *
 * Implements:
 *   - per-host token-bucket throttle (1 rps default, injectable clock)
 *   - retry with exponential backoff on 429 / 5xx
 *   - read-through disk cache via the shared {@link createFileCache}
 *     primitive (TTL-gated; labmaus payloads are not immutable).
 */

import { LabmausNetworkError } from "../../schemas/errors";
import { createFileCache, type FileCache } from "../_shared/file-cache";
import { createTokenBucket } from "../_shared/throttle";

const BASE_URL = "https://labmaus.net";
const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent": "pokemon-ai-trainer/0.1 (labmaus client)",
  Origin: BASE_URL,
  Referer: `${BASE_URL}/`,
};

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
   * @throws {LabmausNetworkError} On HTTP exhaustion.
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
   * @throws {LabmausNetworkError} On HTTP exhaustion.
   */
  getTournament(args: { id: number; language?: "en" }): Promise<unknown>;
}

/**
 * Build a {@link LabmausClient}.
 *
 * **When to use it:** as the single dependency injected into `listTournaments` /
 * `getTournament` and the ingest script. Tests inject `fetchImpl` + `clock` to
 * avoid real network.
 *
 * @param opts — see {@link LabmausClientOptions}.
 * @returns A `LabmausClient`.
 */
export function createLabmausClient(opts: LabmausClientOptions): LabmausClient {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;

  const sleep = (ms: number): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, ms));

  // Throttle: shared token-bucket from src/tools/_shared/throttle.ts (each
  // client constructs its own bucket so per-host limits are independent).
  const bucket = createTokenBucket({
    refillPerSec: opts.throttleRps,
  });
  const throttle = (): Promise<void> => bucket.acquire();

  const cache: FileCache = createFileCache({
    dir: opts.cacheDir,
    ttlMs: opts.cacheTtlMs,
  });

  const cacheGet = (key: string): unknown | undefined => {
    const raw = cache.read(key);
    if (raw === undefined) return undefined;
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return undefined;
    }
  };
  const cacheSet = (key: string, body: unknown): void => {
    cache.write(key, JSON.stringify(body));
  };

  const fetchWithRetry = async (url: string): Promise<unknown> => {
    let attempt = 0;
    let lastStatus = 0;
    let lastBody = "";
    while (attempt <= opts.maxRetries) {
      await throttle();
      const res = await fetchImpl(url, { headers: DEFAULT_HEADERS });
      lastStatus = res.status;
      if (res.ok) {
        return await res.json();
      }
      lastBody = await res.text().catch(() => "");
      const retryable = res.status === 429 || (res.status >= 500 && res.status < 600);
      if (!retryable || attempt === opts.maxRetries) {
        throw new LabmausNetworkError(
          `labmaus ${url} failed: HTTP ${lastStatus} ${lastBody.slice(0, 200)}`,
          { query: { url, status: lastStatus } },
        );
      }
      const backoff = opts.backoffBaseMs * 2 ** attempt;
      await sleep(backoff);
      attempt++;
    }
    throw new LabmausNetworkError(`labmaus ${url} retries exhausted (status=${lastStatus})`, {
      query: { url, status: lastStatus },
    });
  };

  return {
    async listCompletedTournaments(args): Promise<unknown> {
      const params = new URLSearchParams({
        regulation: args.regulation,
        date_range: `${args.from} to ${args.to}`,
      });
      const key = `list/${args.regulation}/${args.from}_${args.to}`;
      const cached = cacheGet(key);
      if (cached !== undefined) return cached;
      const url = `${BASE_URL}/api/completed_tournaments?${params.toString()}`;
      const body = await fetchWithRetry(url);
      cacheSet(key, body);
      return body;
    },
    async getTournament(args): Promise<unknown> {
      const lang = args.language ?? "en";
      const key = `tournament/${args.id}`;
      const cached = cacheGet(key);
      if (cached !== undefined) return cached;
      const url = `${BASE_URL}/api/tournament?tournament=${args.id}&language=${lang}`;
      const body = await fetchWithRetry(url);
      cacheSet(key, body);
      return body;
    },
  };
}
