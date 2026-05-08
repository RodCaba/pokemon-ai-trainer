/**
 * Pure-function HTML extractor for `metavgc.com` articles.
 *
 * Stage 5b rewrite: the previous Stage-5 extractor read the static `<article>`
 * tag, which only SSRs the first ~30–50% of body text — sections 2+ render
 * client-side from a streamed React Server Components (RSC) payload. The full
 * markdown body is already in the same HTML, embedded as one of many
 * `self.__next_f.push([1,"…"])` script calls. We now decode that payload and
 * emit the same `{ article_title, article_section: "intro", sections }` shape
 * the chunker already consumes. If RSC extraction fails (no payload, no
 * markdown), we fall back to the old cheerio path so we degrade gracefully if
 * metavgc changes its rendering.
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
import {
  findArticleMarkdown,
  parseMarkdownToSections,
} from "./extract-rsc-payload";

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
 * Resolve the article title. Prefer `<h1>`, fall back to `<title>` minus the
 * ` | MetaVGC` suffix, fall back to the slug.
 */
function resolveTitle(
  $: cheerio.CheerioAPI,
  slug: string,
): string {
  const fromH1 = collapseWhitespace($("h1").first().text());
  if (fromH1.length > 0) return fromH1;
  const fromTitle = collapseWhitespace($("title").first().text());
  if (fromTitle.length > 0) {
    return fromTitle.replace(/\s*\|\s*MetaVGC\s*$/i, "").trim() || slug;
  }
  return slug;
}

/**
 * Cheerio fallback: walks `<article>` (or longest `<main>` descendant) and
 * extracts h2/h3 boundaries with p/li/blockquote/h4 paragraph text. This is
 * the Stage-5 implementation kept as a graceful fallback for the case where
 * metavgc changes its rendering and the RSC payload disappears.
 */
function extractViaCheerio(input: {
  slug: string;
  html: string;
}): ExtractedMetaVgcArticle {
  const $ = cheerio.load(input.html);

  let container: cheerio.Cheerio<DomElement> | null = null;
  const articleEl = $("article").first();
  if (articleEl.length > 0) {
    container = articleEl as cheerio.Cheerio<DomElement>;
  } else {
    const mainEl = $("main").first();
    if (mainEl.length > 0) {
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

  container
    .find("script, style, figure, aside, nav, footer, noscript, [class*='toc' i]")
    .remove();

  const article_title = resolveTitle($, input.slug);

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

/**
 * Extract the heading-tree from raw metavgc article HTML.
 *
 * **When to use it:** the contract between the metavgc HTTP client and the
 * site-agnostic chunker. Tests pin against committed fixtures under
 * `fixtures/metavgc/`.
 *
 * Strategy (Stage 5b):
 *   1. **RSC pipeline (preferred).** Locate the longest `self.__next_f.push`
 *      payload containing a `\n## ` heading marker; JSON-decode it; walk the
 *      markdown via {@link parseMarkdownToSections}. This recovers the full
 *      body, including sections 2+ that render client-side and are missing
 *      from the static `<article>` tag.
 *   2. **Cheerio fallback.** If the RSC payload is missing or contains no
 *      markdown body, fall back to the Stage-5 cheerio walk over `<article>`
 *      / longest-`<main>`. Better degraded-mode coverage than throwing.
 *   3. **Hard failure.** If both pipelines fail, throw
 *      {@link KnowledgeArticleParseError}.
 *
 * The title still comes from `<h1>` (or `<title>` minus ` | MetaVGC`), which
 * the rendered HTML reliably ships even when the body is RSC-streamed.
 *
 * @param input — `{ slug, html }`. Section is pinned, so no `article_section`
 *   override is accepted.
 * @returns An {@link ExtractedMetaVgcArticle}; section list is non-empty
 *   (single implicit section if the body has no `## ` / `### ` headings).
 * @throws {KnowledgeArticleParseError} If neither the RSC pipeline nor the
 *   cheerio fallback can locate a non-empty body.
 *
 * @example
 * ```ts
 * const out = extractMetaVgcArticle({
 *   slug: "how-to-counter-incineroar-pokemon-champions",
 *   html: rawHtml,
 * });
 * // out.article_section === "intro"
 * // out.sections covers ALL h2/h3 sections, not just the SSR slice.
 * ```
 */
export function extractMetaVgcArticle(input: {
  slug: string;
  html: string;
}): ExtractedMetaVgcArticle {
  const $ = cheerio.load(input.html);
  const article_title = resolveTitle($, input.slug);

  // Try RSC first.
  let markdown: string | null = null;
  try {
    markdown = findArticleMarkdown(input.html);
  } catch (e) {
    if (e instanceof KnowledgeArticleParseError) {
      markdown = null;
    } else {
      throw e;
    }
  }

  if (markdown !== null) {
    const parsed = parseMarkdownToSections(markdown);
    const sections: ExtractedMetaVgcSection[] = parsed.sections
      .map<ExtractedMetaVgcSection>((s) => ({
        heading_level: s.depth,
        section_heading:
          s.heading.length > 0 ? s.heading : article_title,
        paragraphs: s.paragraphs,
      }))
      .filter((s) => s.paragraphs.length > 0 || s.section_heading.length > 0);

    if (sections.length > 0) {
      return {
        article_title,
        article_section: "intro",
        sections,
        raw_warnings: [],
      };
    }
    // Empty parse — fall through to cheerio.
  }

  // Cheerio fallback (also throws if the page has no body container at all).
  return extractViaCheerio(input);
}
