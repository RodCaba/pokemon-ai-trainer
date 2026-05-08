/**
 * Pure-function HTML extractor for `metavgc.com` articles.
 *
 * Unlike vgcguide (Squarespace + `.sqs-html-content`), metavgc serves
 * semantic HTML on a Next.js stack: the article body lives inside `<article>`
 * (preferred container) or, defensively, inside `<main>` (longest-text
 * descendant fallback when an `<article>` tag is absent).
 *
 * Per plan §19 Q4 the `article_section` is pinned to `"intro"` for every
 * metavgc article.
 *
 * TODO(stage6-deferred): lift `ExtractedMetaVgcArticle` / `ExtractedMetaVgcSection`
 * into `src/tools/knowledge/extracted.ts` so vgcguide and metavgc share one
 * intermediate (plan §19.6 deferred row #2).
 */

import * as cheerio from "cheerio";
import type { Element as DomElement } from "domhandler";
import { KnowledgeArticleParseError } from "../../schemas/errors";

/** One section of an extracted metavgc article — h2 or h3 boundary. */
export interface ExtractedMetaVgcSection {
  heading_level: 2 | 3;
  /** Visible heading text. */
  section_heading: string;
  /** Whitespace-collapsed paragraph texts. */
  paragraphs: string[];
}

/** Heading-tree intermediate produced by {@link extractMetaVgcArticle}. */
export interface ExtractedMetaVgcArticle {
  article_title: string;
  /** Always `"intro"` per plan §19 Q4. */
  article_section: "intro";
  sections: ExtractedMetaVgcSection[];
  raw_warnings: string[];
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Extract the heading-tree from raw metavgc article HTML.
 *
 * **When to use it:** the contract between the metavgc HTTP client and the
 * site-agnostic chunker. Tests pin against committed fixtures under
 * `fixtures/metavgc/`.
 *
 * Container strategy:
 *   1. Prefer `<article>` if present (one per page on metavgc per the live probe).
 *   2. Else longest-text `<main>` descendant by raw text length.
 *   3. Else throw {@link KnowledgeArticleParseError}.
 *
 * Walker (mirrors vgcguide for symmetry):
 *   - Section boundaries: `h2`, `h3`.
 *   - Block-text containers: `p`, `li`, `blockquote`, `h4` (treated as inline
 *     subheading prefixed with `### `).
 *   - Stripped chrome: `script`, `style`, `figure`, `aside`, `nav`, `footer`,
 *     `noscript`, plus any element whose class list contains `toc`.
 *
 * Title resolution: first `<h1>` text → `<title>` text → slug.
 *
 * @param input — `{ slug, html }`. Section is pinned, so no `article_section`
 *   override is accepted.
 * @returns An {@link ExtractedMetaVgcArticle}; section list is non-empty
 *   (single implicit section if the body has no h2/h3).
 * @throws {KnowledgeArticleParseError} If neither `<article>` nor any
 *   non-empty `<main>` descendant can be located.
 *
 * @example
 * ```ts
 * const out = extractMetaVgcArticle({
 *   slug: "how-to-counter-incineroar-pokemon-champions",
 *   html: rawHtml,
 * });
 * // out.article_section === "intro"
 * // out.sections.flatMap(s => s.paragraphs).join("\n") contains body text
 * ```
 */
export function extractMetaVgcArticle(input: {
  slug: string;
  html: string;
}): ExtractedMetaVgcArticle {
  const $ = cheerio.load(input.html);

  // Container selection: prefer <article>, else longest <main> descendant.
  let container: cheerio.Cheerio<DomElement> | null = null;
  const articleEl = $("article").first();
  if (articleEl.length > 0) {
    container = articleEl as cheerio.Cheerio<DomElement>;
  } else {
    const mainEl = $("main").first();
    if (mainEl.length > 0) {
      // Pick the longest-text direct or nested descendant.
      let bestText = collapseWhitespace(mainEl.text());
      let best = mainEl as cheerio.Cheerio<DomElement>;
      mainEl.find("*").each((_, el) => {
        const cand = $(el);
        const t = collapseWhitespace(cand.text());
        if (t.length > bestText.length) {
          bestText = t;
          best = cand as cheerio.Cheerio<DomElement>;
        }
      });
      if (bestText.length > 0) {
        container = best;
      }
    }
  }

  if (container === null) {
    throw new KnowledgeArticleParseError(
      `metavgc article ${input.slug}: no <article> or <main> body container`,
      { article_slug: input.slug, source_site: "metavgc" },
    );
  }

  // Defensive chrome strip — operates on a clone so we don't mutate the input.
  // cheerio shares the underlying DOM across $() calls; remove() is permanent
  // for this load context which is fine since the function returns a derived
  // representation.
  container
    .find("script, style, figure, aside, nav, footer, noscript, [class*='toc' i]")
    .remove();

  const titleFromH1 = collapseWhitespace($("h1").first().text());
  const titleFromTitle = collapseWhitespace($("title").first().text());
  const article_title = titleFromH1 || titleFromTitle || input.slug;

  const sections: ExtractedMetaVgcSection[] = [];
  const raw_warnings: string[] = [];

  let current: ExtractedMetaVgcSection | null = null;
  const flush = (): void => {
    if (current !== null) {
      sections.push(current);
      current = null;
    }
  };

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
      current.paragraphs.push(tag === "h4" ? `### ${text}` : text);
      return;
    }
    const kids = el.children ?? [];
    for (const child of kids) {
      if ((child as DomElement).tagName !== undefined) {
        walk(child as DomElement);
      }
    }
  };

  // Walk the container's descendants. Use `.contents()` to start with direct
  // children, then recurse through the walker for wrapper divs.
  for (const child of container.children().toArray()) {
    walk(child as DomElement);
  }
  flush();

  if (sections.length === 0) {
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

  return {
    article_title,
    article_section: "intro",
    sections,
    raw_warnings,
  };
}
