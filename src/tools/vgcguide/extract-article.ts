/**
 * Pure-function HTML extractor. Given raw vgcguide article HTML, returns a
 * heading-tree intermediate suitable for chunking. Strict on the body
 * container (`.sqs-html-content`); permissive on heading structure (no h2 →
 * single implicit section).
 */

import * as cheerio from "cheerio";
import type { Element as DomElement } from "domhandler";
import { KnowledgeArticleParseError } from "../../schemas/errors";
import { inferSectionFromSlug } from "./section";

// `domhandler` is cheerio's DOM node library; importing `Element` directly
// gives us proper structural typing on the recursive walker (vs the prior
// `as unknown as never` cast). Stage 6 review item 7.

/** One section of an extracted article — h2 or h3 boundary. */
export interface ExtractedSection {
  heading_level: 2 | 3;
  /** Visible heading text. */
  section_heading: string;
  /** Whitespace-collapsed paragraph texts. */
  paragraphs: string[];
}

/** Heading-tree intermediate produced by {@link extractVgcGuideArticle}. */
export interface ExtractedArticle {
  article_title: string;
  article_section: "intro" | "teambuilding" | "battling";
  sections: ExtractedSection[];
  raw_warnings: string[];
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Extract the heading-tree from raw vgcguide HTML.
 *
 * **When to use it:** the contract between the vgcguide HTTP client and the
 * chunker. Tests pin against committed fixtures under `fixtures/vgcguide/`.
 *
 * @param input — `{ slug, html, article_section? }`. `article_section` is
 *   derived by the caller from the URL prefix; when omitted, falls back to
 *   a slug-prefix heuristic.
 * @returns An {@link ExtractedArticle}; section list is non-empty (single
 *   implicit section if the body has no h2/h3).
 * @throws {KnowledgeArticleParseError} If `.sqs-html-content` is missing.
 */
export function extractVgcGuideArticle(input: {
  slug: string;
  html: string;
  article_section?: "intro" | "teambuilding" | "battling";
}): ExtractedArticle {
  const $ = cheerio.load(input.html);
  // Squarespace pages typically render 3 `.sqs-html-content` divs per article:
  // (0) excerpt/summary blurb at the top, (1) breadcrumb navigation, (2) the
  // actual body. `.first()` picks the summary (verified empirically against
  // /predictions: 911 / 768 / 5840 chars). Pick the LONGEST container by raw
  // text length — the article body always dominates.
  const containers = $(".sqs-html-content").toArray();
  if (containers.length === 0) {
    throw new KnowledgeArticleParseError(
      `vgcguide article ${input.slug}: no .sqs-html-content container`,
      { article_slug: input.slug, source_site: "vgcguide" },
    );
  }
  const container = containers
    .map((el) => $(el))
    .reduce((best, c) => (c.text().length > best.text().length ? c : best));

  // Defensive: drop chrome we never want in chunks.
  container.find("script, style, figure, aside, noscript").remove();

  const titleFromH1 = collapseWhitespace($("h1").first().text());
  const titleFromTitle = collapseWhitespace($("title").first().text());
  const article_title =
    titleFromH1 || titleFromTitle || input.slug;

  const article_section =
    input.article_section ?? inferSectionFromSlug(input.slug);

  const sections: ExtractedSection[] = [];
  const raw_warnings: string[] = [];

  // Walk children of the container in document order, partitioning on h2/h3.
  let current: ExtractedSection | null = null;

  const flush = (): void => {
    if (current !== null) {
      sections.push(current);
      current = null;
    }
  };

  const children = container.children().toArray();

  // Recursive helper: walk an element subtree; when we see an h2/h3, flush
  // and start a new section. When we see a <p>, append its text. The walk
  // is shallow per top-level child, deep enough to handle wrapper divs.
  const walk = (el: DomElement): void => {
    const tag = el.tagName?.toLowerCase();
    if (tag === "h2" || tag === "h3") {
      flush();
      current = {
        heading_level: tag === "h2" ? 2 : 3,
        section_heading: collapseWhitespace($(el).text()) || article_title,
        paragraphs: [],
      };
      return;
    }
    // Block-level text containers — collect as a paragraph and DO NOT recurse.
    // This includes `<p>`, `<li>` (bullet/ordered list items, ~14 per article on
    // vgcguide), `<blockquote>`, and `<h4>` (treated as inline subheading text,
    // not a section boundary, since vgcguide's section structure is h2/h3 only).
    // Empirical: without `<li>` + `<h4>` collection, the predictions article
    // captured 28 `<p>` and silently dropped 14 `<li>` + 2 `<h4>` — roughly half
    // the body content went missing.
    if (tag === "p" || tag === "li" || tag === "blockquote" || tag === "h4") {
      const text = collapseWhitespace($(el).text());
      if (text.length === 0) return;
      if (current === null) {
        current = {
          heading_level: 2,
          section_heading: article_title,
          paragraphs: [],
        };
      }
      // h4 gets a leading marker so chunked text preserves the visual hierarchy
      // for the embedding model (and for human-readable citations).
      current.paragraphs.push(tag === "h4" ? `### ${text}` : text);
      return;
    }
    // For containers (divs, sections, ul, ol, etc.), recurse into element children.
    const kids = el.children ?? [];
    for (const child of kids) {
      if ((child as DomElement).tagName !== undefined) {
        walk(child as DomElement);
      }
    }
  };

  for (const child of children) {
    walk(child as DomElement);
  }
  flush();

  if (sections.length === 0) {
    // Fallback: no h2/h3, no p — try collecting any text in the container.
    const text = collapseWhitespace(container.text());
    if (text.length === 0) {
      raw_warnings.push("empty article body — no h2/h3, no paragraphs");
      sections.push({
        heading_level: 2,
        section_heading: article_title,
        paragraphs: [],
      });
    } else {
      raw_warnings.push("no h2/h3 found — single implicit section");
      sections.push({
        heading_level: 2,
        section_heading: article_title,
        paragraphs: [text],
      });
    }
  }

  return { article_title, article_section, sections, raw_warnings };
}
