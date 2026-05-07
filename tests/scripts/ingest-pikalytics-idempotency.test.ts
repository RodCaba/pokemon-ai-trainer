/**
 * PIKA-T50 — running ingest twice produces zero pikalytics_snapshots deltas.
 * Stage 4: fails because `main(...)` throws "not implemented".
 */

import { describe, expect, it } from "vitest";
import { main } from "../../scripts/data/ingest-pikalytics";

describe("ingest-pikalytics idempotency (PIKA-T50)", () => {
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
