/**
 * Recover full metavgc article markdown from the React Server Components (RSC)
 * payload embedded in the rendered HTML.
 *
 * Stage 5b context: metavgc's static `<article>` tag SSRs only ~30–50% of body
 * text — sections 2+ render client-side from RSC streamed payloads. The
 * complete markdown is already present in the same HTML as one of many
 * `self.__next_f.push([1,"<json-escaped-string>"])` script calls. We pick the
 * longest such push that contains at least one `\n## ` heading marker, decode
 * the JS string literal, and emit the markdown body.
 *
 * Pure functions, no DOM deps. Caller does the cheerio work for `<h1>` /
 * `<title>` if needed.
 */

import { KnowledgeArticleParseError } from "../../schemas/errors";

/** One section produced by {@link parseMarkdownToSections}. */
export interface MarkdownSection {
  /** Heading text without the leading `## ` / `### `. */
  heading: string;
  /** `2` for `##` headings, `3` for `###` headings (folded as own section). */
  depth: 2 | 3;
  /** Whitespace-collapsed paragraph texts. Lists/tables collapsed per spec. */
  paragraphs: string[];
}

/** Output of {@link parseMarkdownToSections}. */
export interface ParsedMarkdown {
  /** First-encountered `# ` heading, if any (rare in metavgc bodies). */
  title?: string;
  sections: MarkdownSection[];
}

/**
 * Match a single `self.__next_f.push([1,"…"])` script call. The captured group
 * is the raw JS-string-escaped payload (still escaped — JSON.parse it before
 * use). The pattern is greedy across `\\.` and any non-quote, non-backslash
 * char, which mirrors how Next.js emits these calls (single-line, double-quoted
 * JS string literal).
 */
const RSC_PUSH_REGEX =
  /self\.__next_f\.push\(\[1,"((?:\\.|[^"\\])*)"\]\)/g;

/**
 * Locate and decode the article-body markdown embedded in metavgc HTML's RSC
 * payload.
 *
 * **When to use it:** the RSC pipeline used by `extractMetaVgcArticle`. Pure;
 * call with the raw HTML string. The static `<article>` tag is only the first
 * SSR slice — this function recovers the full body.
 *
 * Strategy:
 *   1. Scan every `self.__next_f.push([1,"…"])` call.
 *   2. JSON-decode each payload (`JSON.parse('"' + raw + '"')`).
 *   3. Filter to those containing at least one `\n## ` heading marker.
 *   4. Pick the longest survivor — empirically this is the body push for all
 *      three Stage-5b fixtures (push 13 / 14 / 13). The exact index varies
 *      across articles; we never hard-code one.
 *   5. Trim leading whitespace and return.
 *
 * No chrome stripping is performed at this layer — every Stage-5b fixture's
 * winning push is end-to-end body text. If a future article ships chrome
 * inside the body push, {@link parseMarkdownToSections} will skip non-heading
 * preamble naturally (it only emits paragraphs after the first heading or
 * before any heading), so the bound is "no body data lost," not "exact
 * boundary."
 *
 * @param html — Raw HTML returned by the metavgc article fetcher.
 * @returns The decoded markdown body, leading whitespace trimmed.
 * @throws {KnowledgeArticleParseError} If no `self.__next_f.push` call carries
 *   a `\n## ` heading marker (i.e. the page rendered no body markdown).
 */
export function findArticleMarkdown(html: string): string {
  const candidates: string[] = [];
  // Reset regex lastIndex by constructing a fresh RegExp from the same source.
  const re = new RegExp(RSC_PUSH_REGEX.source, RSC_PUSH_REGEX.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const rawEscaped = m[1];
    if (rawEscaped === undefined) continue;
    let decoded: string;
    try {
      // The push payload is a single JS-string literal (double-quoted), so
      // `JSON.parse('"' + raw + '"')` round-trips its escapes (\\n, \\", \\u…).
      decoded = JSON.parse('"' + rawEscaped + '"') as string;
    } catch {
      continue;
    }
    if (decoded.includes("\n## ")) {
      candidates.push(decoded);
    }
  }

  if (candidates.length === 0) {
    throw new KnowledgeArticleParseError(
      "no RSC push payload with markdown body found",
      { source_site: "metavgc" },
    );
  }

  candidates.sort((a, b) => b.length - a.length);
  // The body push for all observed metavgc articles either starts with body
  // text directly (incineroar / leads) or with a leading newline (megas: a
  // `\n` precedes the intro). Trim leading whitespace so downstream parsers
  // don't see a phantom blank line.
  return candidates[0]!.replace(/^\s+/, "");
}

interface MutableSection {
  heading: string;
  depth: 2 | 3;
  paragraphs: string[];
}

const BOLD_ITALIC_RE = /\*{1,3}([^*]+)\*{1,3}/g;
const TABLE_PIPE_RE = /^\s*\|.*\|\s*$/;
const TABLE_DIVIDER_RE = /^\s*\|?\s*(?::?-{2,}:?\s*\|\s*)+:?-{2,}:?\s*\|?\s*$/;
const BULLET_RE = /^\s*(?:[-*+]|\d+\.)\s+(.*)$/;
const HR_RE = /^\s*-{3,}\s*$/;

function stripInlineEmphasis(s: string): string {
  return s.replace(BOLD_ITALIC_RE, "$1");
}

function pushParagraph(section: MutableSection, text: string): void {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length > 0) {
    section.paragraphs.push(stripInlineEmphasis(collapsed));
  }
}

/**
 * Walk a markdown body line-by-line and produce a section tree compatible with
 * the vgcguide chunker's `ExtractedArticle` shape.
 *
 * **When to use it:** the second half of the metavgc RSC pipeline. Output
 * feeds straight into `chunkExtractedArticle` via the metavgc extractor.
 *
 * Walker rules (verbatim contract — locked by Stage-5b tests):
 *   - `# Heading` opens the {@link ParsedMarkdown.title} (first occurrence
 *     wins; subsequent `#` lines emit as their own depth-2 section to avoid
 *     data loss).
 *   - `## Heading` starts a new depth-2 section.
 *   - `### Heading` starts a new depth-3 section (own entry, NOT folded into
 *     the parent — matches how vgcguide treats `h3` boundaries).
 *   - `#### Heading` and below collapse into a paragraph prefixed with the
 *     literal `### ` marker (precedent: vgcguide chunker's `h4` handling).
 *   - Bullets (`- `, `* `, `+ `, `1. …`) → one paragraph per bullet, leading
 *     marker stripped.
 *   - Pipe-tables: contiguous `|`-prefixed lines collapsed into one paragraph,
 *     rows joined with `\n`. The `| --- | --- |` divider row is dropped.
 *   - Horizontal rules (`---`) act as paragraph separators only.
 *   - Bold/italic asterisks stripped (`**bold**` → `bold`).
 *   - Code spans (`\`code\``) kept literal.
 *
 * Empty paragraphs are dropped silently. A markdown body with no `##` / `###`
 * heading produces a single implicit depth-2 section titled `""` so the
 * downstream chunker still receives a non-empty section list.
 *
 * @param md — Markdown body text (already JSON-decoded).
 * @returns Title (if a `# ` heading was seen) and ordered sections.
 *
 * @example
 * ```ts
 * const md = "## Intro\n\nHello **world**.\n\n## Next\n\n- one\n- two\n";
 * const out = parseMarkdownToSections(md);
 * // out.sections[0] = { heading: "Intro", depth: 2, paragraphs: ["Hello world."] }
 * // out.sections[1] = { heading: "Next", depth: 2, paragraphs: ["one", "two"] }
 * ```
 */
export function parseMarkdownToSections(md: string): ParsedMarkdown {
  const lines = md.split(/\r?\n/);
  const sections: MutableSection[] = [];
  let title: string | undefined;
  let current: MutableSection | null = null;
  let para: string[] = [];
  let tableBuf: string[] = [];

  const ensureSection = (): MutableSection => {
    if (current === null) {
      current = { heading: "", depth: 2, paragraphs: [] };
      sections.push(current);
    }
    return current;
  };

  const flushPara = (): void => {
    if (para.length === 0) return;
    const text = para.join(" ");
    const sec = ensureSection();
    pushParagraph(sec, text);
    para = [];
  };

  const flushTable = (): void => {
    if (tableBuf.length === 0) return;
    const rows = tableBuf
      .filter((r) => !TABLE_DIVIDER_RE.test(r))
      .map((r) => r.trim())
      .filter((r) => r.length > 0);
    tableBuf = [];
    if (rows.length === 0) return;
    const sec = ensureSection();
    sec.paragraphs.push(stripInlineEmphasis(rows.join("\n")));
  };

  const flushAll = (): void => {
    flushPara();
    flushTable();
  };

  for (const rawLine of lines) {
    const line = rawLine;

    // Pipe table accumulation.
    if (TABLE_PIPE_RE.test(line)) {
      flushPara();
      tableBuf.push(line);
      continue;
    } else if (tableBuf.length > 0) {
      flushTable();
    }

    // Blank line → paragraph break.
    if (line.trim() === "") {
      flushPara();
      continue;
    }

    // Horizontal rule.
    if (HR_RE.test(line)) {
      flushPara();
      continue;
    }

    // Heading detection.
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushAll();
      const hashes = headingMatch[1]!.length;
      const text = stripInlineEmphasis(headingMatch[2]!.trim());
      if (hashes === 1) {
        if (title === undefined) {
          title = text;
        } else {
          current = { heading: text, depth: 2, paragraphs: [] };
          sections.push(current);
        }
        continue;
      }
      if (hashes === 2 || hashes === 3) {
        current = { heading: text, depth: hashes as 2 | 3, paragraphs: [] };
        sections.push(current);
        continue;
      }
      // h4+ → inline subheading paragraph.
      const sec = ensureSection();
      sec.paragraphs.push(`### ${text}`);
      continue;
    }

    // Bullet list item — one paragraph each.
    const bulletMatch = line.match(BULLET_RE);
    if (bulletMatch) {
      flushPara();
      const sec = ensureSection();
      pushParagraph(sec, bulletMatch[1]!);
      continue;
    }

    // Default: paragraph accumulation.
    para.push(line.trim());
  }

  flushAll();

  if (sections.length === 0) {
    sections.push({ heading: "", depth: 2, paragraphs: [] });
  }

  return {
    title,
    sections: sections.map((s) => ({
      heading: s.heading,
      depth: s.depth,
      paragraphs: s.paragraphs,
    })),
  };
}
