/**
 * VGC-T63 — live vgcguide HTML extraction contract test.
 * Gated by `RUN_CONTRACT_TESTS=1`.
 *
 * Stage 4: when ungated, the test suite skips. When gated, it fails because
 * `extractVgcGuideArticle` throws "not implemented (Stage 5)".
 */

import { describe, expect, it } from "vitest";
import { extractVgcGuideArticle } from "../../src/tools/vgcguide/extract-article";

const SHOULD_RUN = process.env.RUN_CONTRACT_TESTS === "1";
const maybe = SHOULD_RUN ? describe : describe.skip;

maybe("vgcguide live contract (VGC-T63)", () => {
  it("VGC-T63. live vgcguide HTML for /speed-control extracts non-empty body", async () => {
    const res = await fetch("https://www.vgcguide.com/speed-control", {
      headers: {
        "User-Agent":
          "pokemon-ai-trainer-contract-test/0.1 (https://github.com/RodCaba)",
      },
    });
    expect(res.ok).toBe(true);
    const html = await res.text();
    const out = extractVgcGuideArticle({
      slug: "speed-control",
      html,
      article_section: "teambuilding",
    });
    expect(out.sections.length).toBeGreaterThanOrEqual(1);
    const totalParas = out.sections.reduce(
      (n, s) => n + s.paragraphs.length,
      0,
    );
    expect(totalParas).toBeGreaterThanOrEqual(1);
  });
});
