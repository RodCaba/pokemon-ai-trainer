/**
 * META-T3..T8 — metavgc discoverScope.
 * Stage 4: every test fails because the implementation throws
 * "not implemented (Stage 5)".
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  discoverScope,
  extractMetaVgcSlugs,
} from "../../../src/tools/metavgc/discover-scope";
import type { KnowledgeArticleClient } from "../../../src/tools/knowledge/article-client";

const FIXTURES = join(__dirname, "../../../fixtures/metavgc");
const SITEMAP = readFileSync(
  join(FIXTURES, "2026-05-08__sitemap.xml"),
  "utf8",
);

describe("metavgc discoverScope (META-T3..T8)", () => {
  it("META-T3. extractMetaVgcSlugs returns the 10 English /guides/<slug> entries from the captured sitemap", () => {
    const slugs = extractMetaVgcSlugs(SITEMAP);
    expect(slugs.size).toBe(10);
    expect(slugs.has("how-to-counter-incineroar-pokemon-champions")).toBe(true);
    expect(
      slugs.has("regulation-m-a-leads-opening-pokemon-champions"),
    ).toBe(true);
    expect(
      slugs.has(
        "anti-meta-underrated-megas-pokemon-champions-2026",
      ),
    ).toBe(true);
  });

  it("META-T4. extractMetaVgcSlugs excludes the Portuguese mirror under /pt/guias/", () => {
    const slugs = extractMetaVgcSlugs(SITEMAP);
    for (const s of slugs) {
      expect(s).not.toMatch(/^pt\//);
      expect(s).not.toMatch(/^guias\//);
    }
    // Sanity: a /pt/ sibling of a real guide is NOT in scope.
    // (The pt slug wouldn't include a /pt/ prefix once split — verify by raw
    // sitemap inspection.)
    expect(SITEMAP).toContain("/pt/guias/how-to-counter-incineroar");
  });

  it("META-T5. extractMetaVgcSlugs excludes the /guides hub root (listing page, not an article)", () => {
    const slugs = extractMetaVgcSlugs(SITEMAP);
    expect(slugs.has("")).toBe(false);
    expect(slugs.has("guides")).toBe(false);
  });

  it("META-T6. extractMetaVgcSlugs does NOT include /pokemon/<slug> species pages (deferred to Stage 6)", () => {
    const slugs = extractMetaVgcSlugs(SITEMAP);
    expect(slugs.has("aerodactyl")).toBe(false);
    expect(slugs.has("alakazam")).toBe(false);
    // No slug should contain a slash — they are flat guide slugs.
    for (const s of slugs) expect(s).not.toContain("/");
  });

  it("META-T7. extractMetaVgcSlugs does NOT include /teams/* or /team-builder pages", () => {
    const slugs = extractMetaVgcSlugs(SITEMAP);
    expect(slugs.has("team-builder")).toBe(false);
    expect(slugs.has("tournaments")).toBe(false);
    expect(slugs.has("featured")).toBe(false);
  });

  it("META-T8. discoverScope walks the sitemap via the injected client and returns the same 10 slugs", async () => {
    const client: KnowledgeArticleClient = {
      async fetchSitemap() {
        // The vgcguide-style client returns parsed URLs; metavgc's contract
        // is identical. Stage 5 may either re-fetch raw XML internally or
        // rely on a shared raw-XML accessor — this test asserts the
        // public contract (set of slugs) and not the internal mechanism.
        return [
          "https://metavgc.com",
          "https://metavgc.com/guides",
          "https://metavgc.com/guides/how-to-counter-incineroar-pokemon-champions",
          "https://metavgc.com/guides/regulation-m-a-leads-opening-pokemon-champions",
          "https://metavgc.com/guides/anti-meta-underrated-megas-pokemon-champions-2026",
          "https://metavgc.com/pt/guias/how-to-counter-incineroar-pokemon-champions",
          "https://metavgc.com/pokemon/aerodactyl",
        ];
      },
      async fetchArticleHtml() {
        throw new Error("discoverScope must not call fetchArticleHtml");
      },
    };
    const scope = await discoverScope(client);
    expect(scope.has("how-to-counter-incineroar-pokemon-champions")).toBe(
      true,
    );
    expect(
      scope.has("regulation-m-a-leads-opening-pokemon-champions"),
    ).toBe(true);
    expect(
      scope.has("anti-meta-underrated-megas-pokemon-champions-2026"),
    ).toBe(true);
    expect(scope.has("guides")).toBe(false);
    expect(scope.has("aerodactyl")).toBe(false);
    expect(scope.size).toBe(3);
  });
});
