/**
 * META-T9..T15 — metavgc HTML extractor.
 * Stage 4: every test fails because `extractMetaVgcArticle` throws
 * "not implemented (Stage 5)".
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractMetaVgcArticle } from "../../../src/tools/metavgc/extract-article";
import { KnowledgeArticleParseError } from "../../../src/schemas/errors";

const FIXTURES = join(__dirname, "../../../fixtures/metavgc");
const INCINEROAR = readFileSync(
  join(FIXTURES, "2026-05-08__guides-incineroar-counters.html"),
  "utf8",
);
const MEGAS = readFileSync(
  join(FIXTURES, "2026-05-08__guides-anti-meta-megas.html"),
  "utf8",
);
const LEADS = readFileSync(
  join(FIXTURES, "2026-05-08__guides-leads-opening.html"),
  "utf8",
);

describe("extractMetaVgcArticle (META-T9..T15)", () => {
  it("META-T9. pulls article_title from the first <h1>", () => {
    const out = extractMetaVgcArticle({
      slug: "how-to-counter-incineroar-pokemon-champions",
      html: INCINEROAR,
    });
    expect(out.article_title).toMatch(/Counter\s+Incineroar/i);
  });

  it("META-T10. article_section is pinned to 'intro' regardless of slug or content", () => {
    const out = extractMetaVgcArticle({
      slug: "regulation-m-a-leads-opening-pokemon-champions",
      html: LEADS,
    });
    expect(out.article_section).toBe("intro");
  });

  it("META-T11. prefers <article> as the body container when present", () => {
    // Synthetic: both <main> and <article> exist; the extractor must pick <article>.
    const html = `<html><body>
      <main>
        <p>chrome paragraph from main</p>
        <article>
          <h1>Real Title</h1>
          <h2>Real Section</h2>
          <p>real article body paragraph</p>
        </article>
      </main>
    </body></html>`;
    const out = extractMetaVgcArticle({ slug: "synthetic", html });
    const allText = out.sections.flatMap((s) => s.paragraphs).join(" ");
    expect(allText).toContain("real article body paragraph");
    expect(allText).not.toContain("chrome paragraph from main");
  });

  it("META-T12. falls back to longest <main> descendant when no <article> tag is present", () => {
    const html = `<html><body>
      <main>
        <div><p>short chrome</p></div>
        <div>
          <h1>Long Title</h1>
          <h2>Section A</h2>
          <p>this is a much longer block of body content that should win the longest-text fallback</p>
          <p>another body paragraph adding length</p>
        </div>
      </main>
    </body></html>`;
    const out = extractMetaVgcArticle({ slug: "fallback", html });
    const allText = out.sections.flatMap((s) => s.paragraphs).join(" ");
    expect(allText).toContain("longer block of body content");
  });

  it("META-T13. throws KnowledgeArticleParseError when no article/main body container is found", () => {
    const html = "<html><body><p>orphan</p></body></html>";
    expect(() =>
      extractMetaVgcArticle({ slug: "broken", html }),
    ).toThrow(KnowledgeArticleParseError);
  });

  it("META-T14. body-coverage smoke: ≥80% of paragraph text is captured (Incineroar fixture)", () => {
    const out = extractMetaVgcArticle({
      slug: "how-to-counter-incineroar-pokemon-champions",
      html: INCINEROAR,
    });
    const captured = out.sections
      .flatMap((s) => s.paragraphs)
      .join("\n")
      .toLowerCase();
    // Sample of distinct phrases that appear in the published Incineroar guide
    // body. At least 4 of 5 must appear (≥80% coverage signal — extractor
    // can't drop entire paragraphs of body content).
    const phrases = [
      "intimidate",
      "fake out",
      "white herb",
      "mental herb",
      "armor tail",
    ];
    const hits = phrases.filter((p) => captured.includes(p)).length;
    expect(hits).toBeGreaterThanOrEqual(4);
    // The captured text must be substantial (real article body, not just a stub).
    expect(captured.length).toBeGreaterThan(2000);
  });

  it("META-T15. walker captures p/li/blockquote/h4 (Megas fixture has all four tags)", () => {
    const out = extractMetaVgcArticle({
      slug: "anti-meta-underrated-megas-pokemon-champions-2026",
      html: MEGAS,
    });
    const allText = out.sections
      .flatMap((s) => s.paragraphs)
      .join("\n");
    // We assert the body has non-trivial length and at least one section
    // contains list-item-derived content. Exact tag origin is asserted in
    // synthetic form below to avoid coupling to fixture details.
    expect(allText.length).toBeGreaterThan(1000);

    const synthetic = `<html><body><article>
      <h1>T</h1>
      <h2>Section</h2>
      <p>para one</p>
      <ul><li>list item one</li><li>list item two</li></ul>
      <blockquote>quoted block</blockquote>
      <h4>inline subheading</h4>
      <p>para two</p>
    </article></body></html>`;
    const so = extractMetaVgcArticle({ slug: "syn", html: synthetic });
    const text = so.sections.flatMap((s) => s.paragraphs).join(" ");
    expect(text).toContain("para one");
    expect(text).toContain("list item one");
    expect(text).toContain("list item two");
    expect(text).toContain("quoted block");
    expect(text).toContain("inline subheading");
    expect(text).toContain("para two");
  });
});
