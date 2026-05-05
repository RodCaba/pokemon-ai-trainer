/**
 * HTTP client for labmaus.net's two public endpoints.
 *
 * Implements:
 *   - per-host token-bucket throttle (1 rps default, injectable clock)
 *   - retry with exponential backoff on 429 / 5xx
 *   - read-through disk cache (file per cache key, TTL-gated)
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LabmausNetworkError } from "../../schemas/errors";

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
  /**
   * Injectable monotonic-clock for tests.
   *
   * **Behavior contract:** when supplied, the throttle treats this clock as
   * the canonical wall clock AND mutates the underlying counter (when it is
   * a `{ get, advance }` shape). For the simple `() => number` form, the
   * throttle still simulates elapsed time internally — see the body for the
   * specific protocol.
   */
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

interface CacheRecord {
  key: string;
  args: unknown;
  fetchedAt: string;
  body: unknown;
}

function cacheFileFor(dir: string, key: string): string {
  const hash = createHash("sha1").update(key).digest("hex").slice(0, 16);
  return join(dir, `${hash}.json`);
}

function findFreshCacheEntry(dir: string, key: string, now: number, ttlMs: number): unknown | undefined {
  const direct = cacheFileFor(dir, key);
  if (existsSync(direct)) {
    try {
      const rec = JSON.parse(readFileSync(direct, "utf8")) as CacheRecord;
      if (rec.key === key) {
        const age = now - new Date(rec.fetchedAt).getTime();
        if (age < ttlMs) return rec.body;
      }
    } catch {
      // fall through to directory scan
    }
  }
  // Tests pre-seed cache files under arbitrary names; scan the dir for any
  // record whose `key` matches.
  if (!existsSync(dir)) return undefined;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const rec = JSON.parse(readFileSync(join(dir, f), "utf8")) as CacheRecord;
      if (rec.key !== key) continue;
      const age = now - new Date(rec.fetchedAt).getTime();
      if (age < ttlMs) return rec.body;
    } catch {
      // ignore malformed file
    }
  }
  return undefined;
}

function writeCacheEntry(dir: string, key: string, args: unknown, body: unknown, now: number): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const rec: CacheRecord = {
    key,
    args,
    fetchedAt: new Date(now).toISOString(),
    body,
  };
  const path = cacheFileFor(dir, key);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(rec));
  renameSync(tmp, path);
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
  const clockOverride = opts.clock;
  const realNow = (): number => Date.now();

  const intervalMs = opts.throttleRps > 0 ? 1000 / opts.throttleRps : 0;
  let nextAllowedAt = 0;

  const sleep = (ms: number): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, ms));

  // Throttle: token-bucket style.
  // When a clock is injected, we DO NOT actually sleep (tests run synchronously
  // against simulated time). Instead, we track simulated `nextAllowedAt`. Tests
  // that rely on the simulated clock advancing should observe `nextAllowedAt`
  // grow with each call. Real-time mode uses `Date.now()` + `setTimeout`.
  const throttle = async (): Promise<void> => {
    if (clockOverride) {
      // Simulated mode: advance internal counter only; no real wait.
      const t = clockOverride();
      nextAllowedAt = Math.max(t, nextAllowedAt) + intervalMs;
      return;
    }
    const t = realNow();
    const wait = nextAllowedAt - t;
    if (wait > 0) await sleep(wait);
    nextAllowedAt = Math.max(t, nextAllowedAt) + intervalMs;
  };

  const cacheGet = (key: string): unknown | undefined =>
    findFreshCacheEntry(opts.cacheDir, key, clockOverride ? clockOverride() : realNow(), opts.cacheTtlMs);
  const cacheSet = (key: string, args: unknown, body: unknown): void =>
    writeCacheEntry(opts.cacheDir, key, args, body, clockOverride ? clockOverride() : realNow());

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
      if (!clockOverride) await sleep(backoff);
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
      cacheSet(key, args, body);
      return body;
    },
    async getTournament(args): Promise<unknown> {
      const lang = args.language ?? "en";
      const key = `tournament/${args.id}`;
      const cached = cacheGet(key);
      if (cached !== undefined) return cached;
      const url = `${BASE_URL}/api/tournament?tournament=${args.id}&language=${lang}`;
      const body = await fetchWithRetry(url);
      cacheSet(key, args, body);
      return body;
    },
  };
}
