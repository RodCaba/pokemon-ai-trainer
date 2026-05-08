/**
 * Stage 4 scaffold — signatures only. Stage 5 implements per
 * `docs/plans/metavgc-guides.md` §2.2.
 */

import type { KnowledgeArticleClient } from "../knowledge/article-client";

/**
 * Pure-function: extract canonical metavgc guide slugs from sitemap.xml.
 * Excludes `/pt/` mirror, the `/guides` hub root, and species pages.
 */
export function extractMetaVgcSlugs(_sitemapXml: string): Set<string> {
  void _sitemapXml;
  throw new Error("not implemented (Stage 5)");
}

/**
 * Walk the metavgc sitemap via the client and return in-scope guide slugs.
 */
export async function discoverScope(
  _client: KnowledgeArticleClient,
): Promise<Set<string>> {
  void _client;
  throw new Error("not implemented (Stage 5)");
}
