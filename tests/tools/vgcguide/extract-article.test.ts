/**
 * VGC-T7–VGC-T11 — vgcguide HTML extractor.
 * Stage 4: every test fails because `extractVgcGuideArticle` throws
 * "not implemented (Stage 5)".
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractVgcGuideArticle } from "../../../src/tools/vgcguide/extract-article";
import { VgcGuideParseError } from "../../../src/schemas/errors";

const FIXTURES = join(__dirname, "../../../fixtures/vgcguide");

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

describe("extractVgcGuideArticle (VGC-T7–VGC-T11)", () => {
  it("VGC-T7. pulls h2/h3/p tree from real Typing HTML", () => {
    const html = loadFixture("2026-05-06__teambuilding__typing.html");
    const out = extractVgcGuideArticle({
      slug: "typing",
      html,
      article_section: "teambuilding",
    });
    expect(out.article_section).toBe("teambuilding");
    expect(out.sections.length).toBeGreaterThan(0);
    // Every section has at least one paragraph or is recorded in raw_warnings.
    for (const s of out.sections) {
      expect(typeof s.section_heading).toBe("string");
      expect([2, 3]).toContain(s.heading_level);
    }
  });

  it("VGC-T8. throws VgcGuideParseError when .sqs-html-content missing", () => {
    const html = "<html><body><h1>No body</h1><p>nothing</p></body></html>";
    expect(() => extractVgcGuideArticle({ slug: "x", html })).toThrow(
      VgcGuideParseError,
    );
  });

  it("VGC-T9. handles article with no h2/h3 (single implicit section)", () => {
    const html = loadFixture("2026-05-06__synthetic-short.html");
    const out = extractVgcGuideArticle({
      slug: "synthetic-short",
      html,
      article_section: "intro",
    });
    expect(out.sections.length).toBe(1);
    expect(out.sections[0]?.paragraphs.length).toBeGreaterThanOrEqual(1);
  });

  it("VGC-T10. strips script/style/figure/aside", () => {
    const html = `<html><body>
      <div class="sqs-html-content">
        <h2>S</h2>
        <p>visible body text</p>
        <script>console.log("hidden script")</script>
        <style>body { color: red; }</style>
        <aside>aside chrome</aside>
        <figure><figcaption>fig caption</figcaption></figure>
      </div>
    </body></html>`;
    const out = extractVgcGuideArticle({ slug: "x", html, article_section: "intro" });
    const all = out.sections
      .flatMap((s) => s.paragraphs)
      .join(" ");
    expect(all).toContain("visible body text");
    expect(all).not.toContain("hidden script");
    expect(all).not.toContain("color: red");
  });

  it("VGC-T11. preserves heading-level discrimination (h2 vs h3)", () => {
    const html = `<html><body>
      <div class="sqs-html-content">
        <h2>Section A</h2>
        <p>a paragraph</p>
        <h3>Subsection A.1</h3>
        <p>another paragraph</p>
      </div>
    </body></html>`;
    const out = extractVgcGuideArticle({ slug: "x", html, article_section: "intro" });
    const levels = out.sections.map((s) => s.heading_level);
    expect(levels).toContain(2);
    expect(levels).toContain(3);
  });
});
