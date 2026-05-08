/**
 * Pure-function HTML extractor. Given raw vgcguide article HTML, returns a
 * heading-tree intermediate suitable for chunking. Strict on the body
 * container (`.sqs-html-content`); permissive on heading structure (no h2 →
 * single implicit section).
 *
 * Stage 4 stub: throws `not implemented (Stage 5)`. Full implementation
 * lands alongside `tests/tools/vgcguide/extract-article.test.ts`.
 */

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

/**
 * Extract the heading-tree from raw vgcguide HTML.
 *
 * **When to use it:** the contract between the vgcguide HTTP client and the
 * chunker. Tests pin against committed fixtures under `fixtures/vgcguide/`.
 *
 * @param input — `{ slug, html, article_section }`. `article_section` is
 *   derived by the caller (sitemap groups `/intro/*`, `/teambuilding/*`,
 *   `/battling/*`); when omitted, the extractor defaults to the slug-prefix
 *   heuristic.
 * @returns An {@link ExtractedArticle}; section list is non-empty (single
 *   implicit section if the body has no h2/h3).
 * @throws {VgcGuideParseError} If `.sqs-html-content` is missing.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function extractVgcGuideArticle(input: {
  slug: string;
  html: string;
  article_section?: "intro" | "teambuilding" | "battling";
}): ExtractedArticle {
  throw new Error("not implemented (Stage 5)");
}
