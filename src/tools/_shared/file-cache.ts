/**
 * Shared on-disk cache primitive used by every tool client that needs a
 * read-through file cache. Uniform JSON envelope on disk, optional TTL
 * gating, atomic writes (`tmp + rename`) so a killed process can't leave a
 * half-written cache file.
 *
 * Storage layout: each entry lives at `<dir>/<sanitized-key>.json` with the
 * shape `{ "fetchedAt": "<iso>", "body": "<string>" }`. Bodies are always
 * strings; callers that need structured data stringify before {@link FileCache.write}
 * and parse after {@link FileCache.read}.
 *
 * TTL semantics:
 *   - `ttlMs === Number.POSITIVE_INFINITY` — content-addressed mode; reads
 *     never expire (e.g. pokepaste, where the paste id is a content hash).
 *   - finite `ttlMs` — entry is fresh iff `(clock() - fetchedAt) < ttlMs`.
 *     Stale or malformed entries surface as `undefined` (cache miss).
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Configuration for {@link createFileCache}. */
export interface FileCacheOpts {
  /** Absolute directory path. Created on first write. */
  dir: string;
  /**
   * Entry lifetime in milliseconds. Use {@link Number.POSITIVE_INFINITY}
   * (or `Infinity`) for content-addressed caches that never expire.
   */
  ttlMs: number;
  /** Injectable clock for tests. Defaults to {@link Date.now}. */
  clock?: () => number;
}

/** Read-through cache keyed by an opaque string. */
export interface FileCache {
  /**
   * @param key — Caller-defined cache key. Sanitized to a filesystem-safe
   *   filename internally.
   * @returns The cached body string, or `undefined` if the entry is absent,
   *   expired (per `ttlMs`), or malformed on disk.
   */
  read(key: string): string | undefined;
  /**
   * Atomically write `body` under `key`. Creates `dir` on first write.
   *
   * @param key — Caller-defined cache key.
   * @param body — Body string to persist. Callers needing structured data
   *   must `JSON.stringify` before calling.
   */
  write(key: string, body: string): void;
}

/** On-disk envelope shape. Internal — not exported. */
interface Envelope {
  fetchedAt: string;
  body: string;
}

/**
 * Sanitize an opaque key into a filesystem-safe filename. Any character
 * outside `[a-zA-Z0-9._-]` is replaced with `_`. This keeps human-readable
 * keys (e.g. pokepaste paste ids, labmaus `tournament_56757`) legible for
 * debugging while preventing path traversal or illegal-char errors.
 */
function sanitizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function pathFor(dir: string, key: string): string {
  return join(dir, `${sanitizeKey(key)}.json`);
}

/**
 * Build a {@link FileCache}.
 *
 * **When to use it:** as the disk-cache dep in any read-through tool client
 * (pokepaste, labmaus, future scrapers). Pokepaste uses
 * `ttlMs: Number.POSITIVE_INFINITY` (content-addressed); labmaus uses a
 * 24-hour TTL because tournament aggregates change as more results land.
 *
 * @param opts — see {@link FileCacheOpts}.
 * @returns A {@link FileCache}.
 *
 * @example
 * ```ts
 * const cache = createFileCache({ dir: "/tmp/c", ttlMs: 60_000 });
 * cache.write("foo", JSON.stringify({ x: 1 }));
 * const hit = cache.read("foo"); // "{\"x\":1}" or undefined when stale
 * ```
 */
export function createFileCache(opts: FileCacheOpts): FileCache {
  const clock = opts.clock ?? ((): number => Date.now());
  return {
    read(key: string): string | undefined {
      const p = pathFor(opts.dir, key);
      if (!existsSync(p)) return undefined;
      let env: Envelope;
      try {
        const raw = readFileSync(p, "utf8");
        env = JSON.parse(raw) as Envelope;
      } catch {
        return undefined;
      }
      if (typeof env?.fetchedAt !== "string" || typeof env?.body !== "string") {
        return undefined;
      }
      if (opts.ttlMs === Number.POSITIVE_INFINITY) return env.body;
      const fetchedAtMs = new Date(env.fetchedAt).getTime();
      if (Number.isNaN(fetchedAtMs)) return undefined;
      const age = clock() - fetchedAtMs;
      if (age >= opts.ttlMs) return undefined;
      return env.body;
    },
    write(key: string, body: string): void {
      if (!existsSync(opts.dir)) mkdirSync(opts.dir, { recursive: true });
      const p = pathFor(opts.dir, key);
      const tmp = `${p}.tmp`;
      const env: Envelope = {
        fetchedAt: new Date(clock()).toISOString(),
        body,
      };
      writeFileSync(tmp, JSON.stringify(env));
      renameSync(tmp, p);
    },
  };
}
