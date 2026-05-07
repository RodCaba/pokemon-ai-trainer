/**
 * PIKA-T51 — live pikalytics AI-markdown contract test.
 * Gated by `RUN_CONTRACT_TESTS=1` per labmaus + pokepaste precedent.
 *
 * Stage 4: when ungated, the test suite skips (no failure recorded).
 * When gated, it fails because the parser stub throws "not implemented".
 */

import { describe, expect, it } from "vitest";
import { parsePikalyticsMarkdown } from "../../src/tools/pikalytics/parse-markdown";

const SHOULD_RUN = process.env.RUN_CONTRACT_TESTS === "1";
const maybe = SHOULD_RUN ? describe : describe.skip;

maybe("pikalytics live contract (PIKA-T51)", () => {
  it("PIKA-T51. live pikalytics AI markdown for Garchomp parses without throwing", async () => {
    const url =
      "https://www.pikalytics.com/ai/pokedex/gen9championsvgc2026regma/garchomp";
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "pokemon-ai-trainer-contract-test/0.1 (https://github.com/RodCaba)",
      },
    });
    expect(res.ok).toBe(true);
    const body = await res.text();
    const out = parsePikalyticsMarkdown(body);
    expect(out.as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
