/**
 * Test T36 — `ingest-labmaus --no-network` runs end-to-end on fixtures.
 */

import { describe, expect, it } from "vitest";
import { main } from "../../scripts/data/ingest-labmaus";

describe("ingest-labmaus", () => {
  it("T36. --no-network runs end-to-end on fixtures", async () => {
    // Stage 5 wires this to use the fixture cache; for Stage 4 the script throws.
    const exit = await main(["--no-network", "--from", "2026-04-06", "--to", "2026-05-04", "--db", ":memory:"]);
    expect(exit).toBe(0);
  });
});
