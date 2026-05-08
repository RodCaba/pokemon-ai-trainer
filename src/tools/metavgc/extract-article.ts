/**
 * Stage 4 scaffold — signatures only. Stage 5 implements per
 * `docs/plans/metavgc-guides.md` §2.2.
 */

/** One section of an extracted metavgc article — h2 or h3 boundary. */
export interface ExtractedMetaVgcSection {
  heading_level: 2 | 3;
  section_heading: string;
  paragraphs: string[];
}

/** Heading-tree intermediate produced by {@link extractMetaVgcArticle}. */
export interface ExtractedMetaVgcArticle {
  article_title: string;
  /** Always `"intro"` per plan §19 (article_section pinned). */
  article_section: "intro";
  sections: ExtractedMetaVgcSection[];
  raw_warnings: string[];
}

/**
 * Extract the heading-tree from raw metavgc article HTML.
 *
 * @throws KnowledgeArticleParseError if no body container can be located.
 */
export function extractMetaVgcArticle(_input: {
  slug: string;
  html: string;
}): ExtractedMetaVgcArticle {
  void _input;
  throw new Error("not implemented (Stage 5)");
}
