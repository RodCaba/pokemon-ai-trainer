/**
 * Site-author-driven scope discovery for `metavgc.com`.
 *
 * Per memory `scope_discovery_via_site_signals.md`: every adapter exports
 * `discoverScope(client): Promise<Set<string>>` so scope flows from the
 * upstream's organizational signals, not a hand-curated list.
 *
 * Algorithm (sitemap-only — simpler than vgcguide's nav∩sitemap because the
 * metavgc sitemap is hand-authored and canonical):
 *
 *     scope = { slug for url in sitemap.xml
 *                  if url.path matches /^\/guides\/[a-z0-9-]+$/ }
 *
 * Excluded by construction:
 *   - the `/guides` hub root (listing page, not an article).
 *   - the `/pt/guias/<slug>` Portuguese mirror.
 *   - `/pokemon/<slug>` species detail pages (deferred to a later slice).
 *   - everything else under `/teams`, `/featured`, `/team-builder`, etc.
 */

import type { KnowledgeArticleClient } from "../knowledge/article-client";

const GUIDES_PATH_RE =
  /^https?:\/\/metavgc\.com\/guides\/([a-z0-9][a-z0-9-]*)\/?$/i;

/**
 * Extract the canonical English `/guides/<slug>` slugs from a metavgc
 * sitemap.xml body.
 *
 * **When to use it:** the pure half of {@link discoverScope}. Test surface —
 * production callers reach for {@link discoverScope}.
 *
 * @param sitemapXml — Raw sitemap.xml body.
 * @returns Set of slugs (`/guides/<slug>` URLs only). Excludes the hub root,
 *   the `/pt/guias/` Portuguese mirror, `/pokemon/` species pages, and any
 *   other non-guide path. Never contains the empty string.
 *
 * @example
 * ```ts
 * const slugs = extractMetaVgcSlugs(rawXml);
 * // slugs.has("how-to-counter-incineroar-pokemon-champions") === true
 * // slugs.has("guides") === false
 * // slugs.has("aerodactyl") === false
 * ```
 */
export function extractMetaVgcSlugs(sitemapXml: string): Set<string> {
  const slugs = new Set<string>();
  const re = /<loc>\s*([^<\s][^<]*?)\s*<\/loc>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sitemapXml)) !== null) {
    const u = m[1]!.trim();
    const match = GUIDES_PATH_RE.exec(u);
    if (match && typeof match[1] === "string" && match[1].length > 0) {
      slugs.add(match[1].toLowerCase());
    }
  }
  return slugs;
}

/**
 * Extract slugs from an already-parsed list of canonical URLs (returned by
 * {@link KnowledgeArticleClient.fetchSitemap}).
 */
function extractSlugsFromUrls(urls: ReadonlyArray<string>): Set<string> {
  const slugs = new Set<string>();
  for (const u of urls) {
    const m = GUIDES_PATH_RE.exec(u);
    if (m && typeof m[1] === "string" && m[1].length > 0) {
      slugs.add(m[1].toLowerCase());
    }
  }
  return slugs;
}

/**
 * Walk the metavgc sitemap via the injected client and return the in-scope
 * guide slugs.
 *
 * **When to use it:** the metavgc ingest script's startup phase. Reads only
 * the sitemap (no per-article fetches), so on a warm cache it's one cheap
 * fetch.
 *
 * @param client — A {@link KnowledgeArticleClient} (any implementation that
 *   serves the metavgc sitemap; tests inject a mock with `fetchSitemap`).
 * @returns Set of canonical English `/guides/<slug>` slugs.
 * @throws {KnowledgeArticleNetworkError} If the underlying client fails after
 *   retries.
 *
 * @example
 * ```ts
 * const scope = await discoverScope(metaVgcClient);
 * for (const slug of scope) {
 *   await ingestArticle(slug);
 * }
 * ```
 */
export async function discoverScope(
  client: KnowledgeArticleClient,
): Promise<Set<string>> {
  const urls = await client.fetchSitemap();
  return extractSlugsFromUrls(urls);
}
