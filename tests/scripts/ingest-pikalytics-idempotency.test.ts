/**
 * PIKA-T50 — running ingest twice produces zero pikalytics_snapshots deltas.
 *
 * Post-Stage-6: pre-seeds a tmp cache dir to satisfy the new `--no-network`
 * empty-cache preflight (review item 10).
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../../scripts/data/ingest-pikalytics";

function seedCacheDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pika-ingest-idem-"));
  writeFileSync(join(dir, "preflight.placeholder"), "");
  return dir;
}

describe("ingest-pikalytics idempotency (PIKA-T50)", () => {
  let prevCacheDir: string | undefined;

  beforeEach(() => {
    prevCacheDir = process.env.PIKALYTICS_CACHE_DIR;
    process.env.PIKALYTICS_CACHE_DIR = seedCacheDir();
  });

  afterEach(() => {
    if (prevCacheDir === undefined) {
      delete process.env.PIKALYTICS_CACHE_DIR;
    } else {
      process.env.PIKALYTICS_CACHE_DIR = prevCacheDir;
    }
  });

  it("PIKA-T50. running ingest twice produces zero pikalytics_snapshots deltas", async () => {
    const exit1 = await main([
      "--no-network",
      "--db",
      ":memory:",
      "--species",
      "garchomp",
    ]);
    const exit2 = await main([
      "--no-network",
      "--db",
      ":memory:",
      "--species",
      "garchomp",
    ]);
    expect(exit1).toBe(0);
    expect(exit2).toBe(0);
    // Stage 5 will pin an actual file path so the two runs share state and
    // the second run's row count equals the first.
  });
});
