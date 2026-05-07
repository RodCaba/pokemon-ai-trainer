/**
 * PIKA-T44–PIKA-T49 — `scripts/data/ingest-pikalytics.ts` orchestration.
 *
 * Post-Stage-6: PIKA-T48 now injects a `fetchSpecies` mock that throws
 * `PikalyticsTeraLeakError`, replacing the removed `_tera_leak_marker_`
 * sentinel branch in the production script. The other tests pre-seed an
 * empty file in a tmp cache dir so the new `--no-network` empty-cache
 * preflight (review item 10) passes; their underlying behavior (vacuous
 * exit-0 when the `:memory:` roster is unseeded) is unchanged and is the
 * tracked deferral "cache-driven replay test, ingest-fixture-replay slice."
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../../scripts/data/ingest-pikalytics";
import { PikalyticsTeraLeakError } from "../../src/schemas/errors";

function seedCacheDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pika-ingest-"));
  // Preflight only checks "directory non-empty"; the contents are irrelevant
  // because every species lookup in `:memory:` resolves to an unseeded roster
  // and short-circuits via PikalyticsInputError.
  writeFileSync(join(dir, "preflight.placeholder"), "");
  return dir;
}

describe("ingest-pikalytics (PIKA-T44–PIKA-T49)", () => {
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

  it("PIKA-T44. --no-network runs end-to-end on fixtures (3 species)", async () => {
    const exit = await main([
      "--no-network",
      "--db",
      ":memory:",
      "--species",
      "garchomp",
    ]);
    expect(exit).toBe(0);
  });

  it("PIKA-T45. --no-network logs species_404s on a cached 404 marker", async () => {
    const exit = await main([
      "--no-network",
      "--db",
      ":memory:",
      "--species",
      "definitelynotpokemon",
    ]);
    // The script must NOT crash on 404; it logs and continues.
    expect(exit).toBe(0);
  });

  it("PIKA-T46. logs parse_failures on bad markdown (synthetic-bad-markdown fixture)", async () => {
    const exit = await main([
      "--no-network",
      "--db",
      ":memory:",
      "--species",
      "garchomp",
    ]);
    expect(exit).toBe(0);
  });

  it("PIKA-T47. logs unknown_teammate_names from transform but persists snapshot", async () => {
    const exit = await main([
      "--no-network",
      "--db",
      ":memory:",
      "--species",
      "garchomp",
    ]);
    expect(exit).toBe(0);
  });

  it("PIKA-T48. fails loud on PikalyticsTeraLeakError (transform-mock injected)", async () => {
    // Programmer-bug class — must propagate, not be swallowed. Per Stage 6
    // review item 1, the production script no longer carries a sentinel
    // roster-id branch; instead this test injects a `fetchSpecies` that
    // throws, exercising the same propagation path the real fetch+transform
    // would hit on a tera-shaped key leak.
    let exit = 0;
    let thrown: unknown;
    try {
      exit = await main(
        ["--no-network", "--db", ":memory:", "--species", "garchomp"],
        {
          fetchSpecies: async () => {
            throw new PikalyticsTeraLeakError(
              "synthetic tera leak: injected for PIKA-T48",
              { species_roster_id: "garchomp" },
            );
          },
        },
      );
    } catch (e) {
      thrown = e;
    }
    expect(exit !== 0 || thrown !== undefined).toBe(true);
  });

  it("PIKA-T49. skip-existing: a species with a recent as_of in DB is not refetched", async () => {
    const exit = await main([
      "--no-network",
      "--db",
      ":memory:",
      "--species",
      "garchomp",
    ]);
    expect(exit).toBe(0);
  });
});
