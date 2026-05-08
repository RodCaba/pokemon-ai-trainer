/**
 * Stage 4 scaffold — signatures only. Stage 5 implements per
 * `docs/plans/metavgc-guides.md` §2.2.
 */

/**
 * Parse a metavgc sitemap.xml into the list of article URLs.
 *
 * @param _xml — Raw sitemap.xml body.
 * @returns Canonical absolute URLs from `<loc>` entries.
 */
export function parseMetaVgcSitemap(_xml: string): string[] {
  void _xml;
  throw new Error("not implemented (Stage 5)");
}
