/**
 * Site-agnostic article-fetching contract shared by every knowledge ingest
 * adapter (vgcguide, metavgc, future). See `docs/plans/metavgc-guides.md` §19.1.
 *
 * Stage 4 scaffold: interface only. Stage 5 implementations live under
 * `src/tools/<site>/client.ts`.
 */

/** One raw HTML fetch result. */
export interface KnowledgeArticleFetch {
  slug: string;
  html: string;
  /** Canonical absolute URL of the article on its source site. */
  article_url: string;
  /** ISO-8601 UTC fetch timestamp. */
  fetched_at: string;
}

/**
 * Article-class HTTP client contract every knowledge ingest adapter satisfies.
 *
 * **When to use it:** as the typed parameter for site-agnostic helpers like
 * `discoverScope(client)` and the metavgc/vgcguide ingest scripts.
 */
export interface KnowledgeArticleClient {
  fetchSitemap(): Promise<string[]>;
  fetchArticleHtml(slug: string): Promise<KnowledgeArticleFetch>;
}
