/**
 * Pure-function HTML extractor. Given raw vgcguide article HTML, returns a
 * heading-tree intermediate suitable for chunking. Strict on the body
 * container (`.sqs-html-content`); permissive on heading structure (no h2 →
 * single implicit section).
 */

import * as cheerio from "cheerio";
import { VgcGuideParseError } from "../../schemas/errors";

// Cheerio's DOM nodes — we only need a structural duck-type with `tagName`
// and `children` for the recursive walker; full domhandler types aren't a
// direct dep, so the local interface mirrors the subset we touch.
interface DomElement {
  tagName?: string;
  children?: DomNode[];
}
type DomNode = DomElement;

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

const TEAMBUILDING_SLUG_HINTS = [
  "team",
  "speed-control",
  "typing",
  "items",
  "ability",
  "moves",
  "archetype",
];
const BATTLING_SLUG_HINTS = [
  "battling",
  "battle",
  "predict",
  "switching",
  "lead",
  "endgame",
  "matchup",
];

function inferSectionFromSlug(slug: string): "intro" | "teambuilding" | "battling" {
  const s = slug.toLowerCase();
  for (const h of BATTLING_SLUG_HINTS) {
    if (s.includes(h)) return "battling";
  }
  for (const h of TEAMBUILDING_SLUG_HINTS) {
    if (s.includes(h)) return "teambuilding";
  }
  return "intro";
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
 * @throws {VgcGuideParseError} If `.sqs-html-content` is missing.
 */
export function extractVgcGuideArticle(input: {
  slug: string;
  html: string;
  article_section?: "intro" | "teambuilding" | "battling";
}): ExtractedArticle {
  const $ = cheerio.load(input.html);
  const container = $(".sqs-html-content").first();
  if (container.length === 0) {
    throw new VgcGuideParseError(
      `vgcguide article ${input.slug}: no .sqs-html-content container`,
      { article_slug: input.slug },
    );
  }

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
        section_heading: collapseWhitespace($(el as unknown as never).text()) || article_title,
        paragraphs: [],
      };
      return;
    }
    if (tag === "p") {
      const text = collapseWhitespace($(el as unknown as never).text());
      if (text.length === 0) return;
      if (current === null) {
        current = {
          heading_level: 2,
          section_heading: article_title,
          paragraphs: [],
        };
      }
      current.paragraphs.push(text);
      return;
    }
    // For containers (divs, sections, ul, etc.), recurse into element children.
    const kids = (el.children ?? []) as DomNode[];
    for (const child of kids) {
      if (child.tagName) walk(child);
    }
  };

  for (const child of children as unknown as DomElement[]) {
    walk(child);
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
