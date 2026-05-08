/**
 * META-T1, META-T2 — metavgc sitemap parser.
 * Stage 4: every test fails because `parseMetaVgcSitemap` throws
 * "not implemented (Stage 5)".
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseMetaVgcSitemap } from "../../../src/tools/metavgc/sitemap";

const FIXTURES = join(__dirname, "../../../fixtures/metavgc");
const SITEMAP = readFileSync(
  join(FIXTURES, "2026-05-08__sitemap.xml"),
  "utf8",
);

describe("parseMetaVgcSitemap (META-T1, META-T2)", () => {
  it("META-T1. returns canonical absolute URLs from <loc> entries on the captured sitemap", () => {
    const urls = parseMetaVgcSitemap(SITEMAP);
    expect(urls.length).toBeGreaterThan(50);
    for (const u of urls) {
      expect(u).toMatch(/^https:\/\/metavgc\.com\//);
    }
    expect(
      urls.includes(
        "https://metavgc.com/guides/how-to-counter-incineroar-pokemon-champions",
      ),
    ).toBe(true);
  });

  it("META-T2. preserves /pt/ entries verbatim — the slug-extraction layer (not this parser) is responsible for excluding them", () => {
    const urls = parseMetaVgcSitemap(SITEMAP);
    const ptCount = urls.filter((u) => u.startsWith("https://metavgc.com/pt/"))
      .length;
    expect(ptCount).toBeGreaterThanOrEqual(10);
  });
});
