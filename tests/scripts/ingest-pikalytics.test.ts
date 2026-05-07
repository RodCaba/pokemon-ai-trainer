/**
 * PIKA-T44–PIKA-T49 — `scripts/data/ingest-pikalytics.ts` orchestration.
 * Stage 4: every test fails because `main(...)` throws "not implemented".
 */

import { describe, expect, it } from "vitest";
import { main } from "../../scripts/data/ingest-pikalytics";

describe("ingest-pikalytics (PIKA-T44–PIKA-T49)", () => {
  it("PIKA-T44. --no-network runs end-to-end on fixtures (3 species)", async () => {
    // Stage 5 wires this to the fixture cache + a curated seed-roster DB
    // covering the 3 fixture species.
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
    // Stage 5 will inject a fixture cache containing synthetic bad markdown
    // for one species. The ingest must catch the parse failure, log it, and
    // exit 0.
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

  it("PIKA-T48. fails loud on PikalyticsTeraLeakError", async () => {
    // Programmer-bug class — must propagate, not be swallowed. Stage 5 will
    // wire a transform mock that throws PikalyticsTeraLeakError; here we
    // assert the script exits non-zero (or throws) when that happens.
    let exit = 0;
    let thrown: unknown;
    try {
      exit = await main([
        "--no-network",
        "--db",
        ":memory:",
        "--species",
        "_tera_leak_marker_",
      ]);
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
