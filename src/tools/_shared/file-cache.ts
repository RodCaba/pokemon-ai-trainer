/**
 * Content-addressed file cache primitive. Stage 4 stub.
 */

/** Configuration for {@link createFileCache}. */
export interface FileCacheOpts {
  /** Absolute directory path. Created on first write. */
  dir: string;
}

/** Read-through cache keyed by an opaque string. */
export interface FileCache {
  read(key: string): string | undefined;
  write(key: string, body: string): void;
}

/**
 * Build a {@link FileCache}. Stub — throws "not implemented (Stage 5)".
 *
 * **When to use it:** as the disk-cache dep in any read-through tool
 * client where keys are content-addressed (immutable, never expire).
 *
 * @param opts — see {@link FileCacheOpts}.
 * @returns A {@link FileCache}.
 * @throws Always (Stage 4 stub).
 */
export function createFileCache(_opts: FileCacheOpts): FileCache {
  throw new Error("not implemented (Stage 5)");
}
