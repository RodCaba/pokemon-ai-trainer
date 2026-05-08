/**
 * Stage 5b — RSC payload extractor unit tests.
 *
 * The metavgc static `<article>` tag SSRs only ~30–50% of body text. The full
 * markdown is recoverable from `self.__next_f.push([1, "..."])` script calls.
 * These tests pin the new pure-function pipeline against the three captured
 * fixtures.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  findArticleMarkdown,
  parseMarkdownToSections,
} from "../../../src/tools/metavgc/extract-rsc-payload";
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

describe("findArticleMarkdown — RSC payload recovery", () => {
  it("recovers ≥2500 chars of markdown from the incineroar fixture", () => {
    const md = findArticleMarkdown(INCINEROAR);
    expect(md.length).toBeGreaterThanOrEqual(2500);
    // Sections from past the SSR cutoff must appear.
    expect(md).toContain("Sneasler");
    expect(md).toContain("Armor Tail");
  });

  it("recovers ≥10000 chars of markdown from the megas fixture", () => {
    const md = findArticleMarkdown(MEGAS);
    expect(md.length).toBeGreaterThanOrEqual(10000);
    expect(md).toContain("## 1. Mega Glimmora");
  });

  it("recovers ≥3000 chars of markdown from the leads-opening fixture", () => {
    const md = findArticleMarkdown(LEADS);
    expect(md.length).toBeGreaterThanOrEqual(3000);
    expect(md).toMatch(/##\s+/);
  });

  it("throws KnowledgeArticleParseError when no RSC body push is present", () => {
    const html = "<html><body><p>no rsc here</p></body></html>";
    expect(() => findArticleMarkdown(html)).toThrow(
      KnowledgeArticleParseError,
    );
  });

  it("throws when RSC pushes exist but none have `\\n## ` markers", () => {
    const html =
      "<script>self.__next_f.push([1,\"just chrome no headings\"])</script>";
    expect(() => findArticleMarkdown(html)).toThrow(
      KnowledgeArticleParseError,
    );
  });
});

describe("parseMarkdownToSections", () => {
  it("returns ≥7 depth-2 sections for the megas body", () => {
    const md = findArticleMarkdown(MEGAS);
    const out = parseMarkdownToSections(md);
    const depth2 = out.sections.filter((s) => s.depth === 2);
    expect(depth2.length).toBeGreaterThanOrEqual(7);
  });

  it("strips bold/italic asterisks from paragraph text", () => {
    const md = "## S\n\nHello **world** and *friends*.\n";
    const out = parseMarkdownToSections(md);
    expect(out.sections[0]!.paragraphs[0]).toBe("Hello world and friends.");
  });

  it("emits one paragraph per bullet item", () => {
    const md = "## S\n\n- one\n- two\n- three\n";
    const out = parseMarkdownToSections(md);
    expect(out.sections[0]!.paragraphs).toEqual(["one", "two", "three"]);
  });

  it("collapses pipe-tables into a single paragraph (rows joined by \\n)", () => {
    const md =
      "## S\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n";
    const out = parseMarkdownToSections(md);
    expect(out.sections[0]!.paragraphs).toHaveLength(1);
    const para = out.sections[0]!.paragraphs[0]!;
    expect(para).toContain("| A | B |");
    expect(para).toContain("| 1 | 2 |");
    expect(para).not.toContain("---");
    // Rows are line-joined.
    expect(para.split("\n").length).toBe(3);
  });

  it("opens new sections on h2 and h3 (h3 not folded)", () => {
    const md = "## A\n\npara\n\n### Sub\n\nsubpara\n\n## B\n\nmore\n";
    const out = parseMarkdownToSections(md);
    expect(out.sections.map((s) => [s.heading, s.depth])).toEqual([
      ["A", 2],
      ["Sub", 3],
      ["B", 2],
    ]);
  });

  it("folds h4+ headings into the parent section as ### prefix paragraph", () => {
    const md = "## A\n\n#### deep\n\npara\n";
    const out = parseMarkdownToSections(md);
    expect(out.sections[0]!.paragraphs[0]).toBe("### deep");
    expect(out.sections[0]!.paragraphs[1]).toBe("para");
  });

  it("ignores horizontal rules (---)", () => {
    const md = "## S\n\nfirst\n\n---\n\nsecond\n";
    const out = parseMarkdownToSections(md);
    expect(out.sections[0]!.paragraphs).toEqual(["first", "second"]);
  });
});
