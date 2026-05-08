/**
 * Pure-function sitemap parser for `metavgc.com`. Given the raw `sitemap.xml`
 * body, returns the list of canonical absolute URLs in declaration order.
 *
 * The metavgc sitemap mixes English `/guides/<slug>` URLs with Portuguese
 * mirror entries `/pt/guias/<slug>` and species detail pages `/pokemon/<slug>`.
 * This parser surfaces every `<loc>` verbatim — the slug-extraction layer in
 * `discover-scope.ts` is responsible for filtering down to the in-scope set.
 */

const LOC_RE = /<loc>\s*([^<\s][^<]*?)\s*<\/loc>/g;

/**
 * Parse a metavgc sitemap.xml into the list of article URLs.
 *
 * **When to use it:** internal helper for the metavgc client's `fetchSitemap`.
 * Pure — no I/O.
 *
 * @param xml — Raw sitemap.xml body as fetched from `https://metavgc.com/sitemap.xml`.
 * @returns Canonical URLs (e.g. `https://metavgc.com/guides/<slug>`); the
 *   parser preserves `/pt/` and `/pokemon/` entries verbatim — filtering
 *   happens downstream in {@link extractMetaVgcSlugs}.
 *
 * @example
 * ```ts
 * const urls = parseMetaVgcSitemap(rawXml);
 * // urls.length ≈ 50+ (English guides + PT mirror + species detail pages)
 * ```
 */
export function parseMetaVgcSitemap(xml: string): string[] {
  const urls: string[] = [];
  let m: RegExpExecArray | null;
  LOC_RE.lastIndex = 0;
  while ((m = LOC_RE.exec(xml)) !== null) {
    const u = m[1]!.trim();
    if (/^https?:\/\/metavgc\.com\//i.test(u)) {
      urls.push(u);
    }
  }
  return urls;
}
