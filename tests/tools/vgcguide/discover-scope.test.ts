/**
 * Tests for `src/tools/vgcguide/discover-scope.ts`. Asserts the
 * nav∩sitemap intersection on the captured 2026-05-08 fixtures.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  discoverScopeFromBodies,
  extractMainSlugs,
  extractSitemapSlugs,
} from "../../../src/tools/vgcguide/discover-scope";

const FIX = join(process.cwd(), "fixtures", "vgcguide");

function loadFixture(name: string): string {
  return readFileSync(join(FIX, name), "utf8");
}

describe("vgcguide discover-scope", () => {
  it("extractMainSlugs pulls only links inside <main> (excludes global header/footer chrome)", () => {
    const slugs = extractMainSlugs(loadFixture("2026-05-08__nav__intro.html"));
    // Articles known to be in the /intro section's main content.
    expect(slugs.has("preface")).toBe(true);
    expect(slugs.has("coming-from-single-battles")).toBe(true);
    expect(slugs.has("the-basics-of-watching-a-pokemon-match")).toBe(true);
    // Header/footer chrome links must NOT be present (they're outside <main>).
    expect(slugs.has("about-us")).toBe(false);
    expect(slugs.has("contact")).toBe(false);
    expect(slugs.has("site-map")).toBe(false);
    expect(slugs.has("support-us")).toBe(false);
  });

  it("extractSitemapSlugs reads the captured sitemap fixture", () => {
    const slugs = extractSitemapSlugs(loadFixture("2026-05-06__sitemap.xml"));
    // Sanity: a handful of well-known articles must be present, and the count
    // is in the documented ~132 ballpark.
    expect(slugs.has("typing")).toBe(true);
    expect(slugs.has("predictions")).toBe(true);
    expect(slugs.has("battling")).toBe(true);
    expect(slugs.size).toBeGreaterThan(100);
  });

  it("discoverScopeFromBodies intersects navs with sitemap and excludes section roots", () => {
    const scope = discoverScopeFromBodies(
      loadFixture("2026-05-08__nav__intro.html"),
      loadFixture("2026-05-08__nav__teambuilding.html"),
      loadFixture("2026-05-08__nav__battling.html"),
      loadFixture("2026-05-06__sitemap.xml"),
    );
    // Documented contract: ~63 articles on the 2026-05-08 capture.
    expect(scope.size).toBeGreaterThanOrEqual(50);
    expect(scope.size).toBeLessThanOrEqual(80);

    // Canonical articles from each section land in scope.
    expect(scope.has("preface")).toBe(true); // /intro
    expect(scope.has("typing")).toBe(true); // /teambuilding
    expect(scope.has("predictions")).toBe(true); // /battling

    // Section roots are excluded so we don't ingest the nav landing pages.
    expect(scope.has("intro")).toBe(false);
    expect(scope.has("teambuilding")).toBe(false);
    expect(scope.has("battling")).toBe(false);

    // Out-of-scope content NOT in any section's <main>.
    expect(scope.has("about-us")).toBe(false);
    expect(scope.has("contact")).toBe(false);
    expect(scope.has("circuit")).toBe(false);
    // Spanish translations NOT linked from the English section navs.
    expect(scope.has("spa-typing")).toBe(false);
    // Event-attendance pages NOT in any of the 3 section navs.
    expect(scope.has("attend-worlds")).toBe(false);
  });
});
