/**
 * VGC-T64 — live Voyage embed contract test.
 * Gated by `RUN_CONTRACT_TESTS=1`. Requires `VOYAGE_API_KEY` env var.
 *
 * Stage 4: when ungated, the test suite skips. When gated, it fails because
 * `createEmbedClient.embed` throws "not implemented (Stage 5)".
 */

import { describe, expect, it } from "vitest";
import { createEmbedClient } from "../../src/tools/knowledge/embed";

const SHOULD_RUN =
  process.env.RUN_CONTRACT_TESTS === "1" && !!process.env.VOYAGE_API_KEY;
const maybe = SHOULD_RUN ? describe : describe.skip;

maybe("voyage live contract (VGC-T64)", () => {
  it("VGC-T64. live Voyage embed call returns 1024-dim vector for one query", async () => {
    const client = createEmbedClient({
      apiKey: process.env.VOYAGE_API_KEY ?? "",
      model: "voyage-3-lite",
      maxBatch: 64,
      maxRetries: 3,
      backoffBaseMs: 1000,
    });
    const out = await client.embed(["test"]);
    expect(out.length).toBe(1);
    expect(out[0]?.length).toBe(1024);
  });
});
