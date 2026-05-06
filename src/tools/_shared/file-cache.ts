/**
 * Content-addressed file cache primitive. Sibling-extracted for the
 * pokepaste client; pokepaste keys are immutable hex hashes so reads
 * never expire.
 *
 * Writes are atomic (`tmp + rename`) so a killed process can't leave a
 * half-written cache file.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Configuration for {@link createFileCache}. */
export interface FileCacheOpts {
  /** Absolute directory path. Created on first write. */
  dir: string;
}

/** Read-through cache keyed by an opaque string. */
export interface FileCache {
  /** @returns The cached body, or `undefined` if absent. */
  read(key: string): string | undefined;
  /** Atomically write `body` under `key`. */
  write(key: string, body: string): void;
}

function pathFor(dir: string, key: string): string {
  // Keys are content-addressed (e.g. pokepaste hex paste ids). Filenames
  // are `<key>.txt` so callers can pre-seed cache entries by writing a
  // file with the predictable name.
  return join(dir, `${key}.txt`);
}

/**
 * Build a {@link FileCache}.
 *
 * **When to use it:** as the disk-cache dep in any read-through tool
 * client where keys are content-addressed (immutable, never expire).
 * The pokepaste client uses this; the labmaus client retains its own
 * TTL-gated cache because labmaus payloads are not immutable.
 *
 * @param opts — see {@link FileCacheOpts}.
 * @returns A {@link FileCache}.
 */
export function createFileCache(opts: FileCacheOpts): FileCache {
  return {
    read(key: string): string | undefined {
      const p = pathFor(opts.dir, key);
      if (!existsSync(p)) return undefined;
      try {
        return readFileSync(p, "utf8");
      } catch {
        return undefined;
      }
    },
    write(key: string, body: string): void {
      if (!existsSync(opts.dir)) mkdirSync(opts.dir, { recursive: true });
      const p = pathFor(opts.dir, key);
      const tmp = `${p}.tmp`;
      writeFileSync(tmp, body);
      renameSync(tmp, p);
    },
  };
}
