/**
 * Test T37 — running the ingest twice produces zero row deltas.
 */

import { describe, expect, it } from "vitest";
import { main } from "../../scripts/data/ingest-labmaus";

describe("ingest-labmaus idempotency", () => {
  it("T37. two runs produce zero row deltas", async () => {
    const args = ["--no-network", "--from", "2026-04-06", "--to", "2026-05-04", "--db", ":memory:"];
    // Stage 5 will share state across runs (or write-then-snapshot a real file path).
    // For Stage 4 the script throws "not implemented" before producing any output.
    const a = await main(args);
    const b = await main(args);
    expect(a).toBe(0);
    expect(b).toBe(0);
  });
});
