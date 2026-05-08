/**
 * Site-author-driven scope discovery for vgcguide.com.
 *
 * The flow doc scopes ingest to "the three top-level sections" — `/intro`,
 * `/teambuilding`, `/battling`. Rather than maintain a hand-edited allowlist
 * (drifts on every site update) or a denylist of out-of-scope categories
 * (overlapping patterns, brittle), we **derive scope from the site's own
 * structural signals**:
 *
 *     scope = (links in <main> of /intro)
 *           ∪ (links in <main> of /teambuilding)
 *           ∪ (links in <main> of /battling)
 *           ∩ (URLs in sitemap.xml)
 *
 * The `<main>` filter excludes the global nav header/footer chrome
 * (`/about-us`, `/contact`, `/site-map`, `/support-us`, `/home-1`, `/circuit`)
 * that appears on every page. The sitemap intersection eliminates broken /
 * cart / UUID links that exist in the navigation but not in the published
 * URL list. The result is whatever the site authors chose to link from a
 * section's main content area AND chose to publish — zero hand-maintenance.
 *
 * Generalization for future sites: each adapter exports its own
 * `discoverScope(client)` returning the canonical set of in-scope IDs. The
 * implementation strategy is per-site (labmaus uses a format query param,
 * pikalytics iterates the roster, vgcguide does nav∩sitemap). The contract
 * is consistent: a `Promise<Set<string>>` of canonical identifiers.
 */

import * as cheerio from "cheerio";
import type { VgcGuideClient } from "./client";

const SLUG_HREF_RE = /^\/([a-z][a-z0-9-]+)\/?$/i;
const SECTION_LANDING_SLUGS = ["intro", "teambuilding", "battling"] as const;

/**
 * Extract every root-level slug linked from the `<main>` element of a
 * section landing page's HTML.
 *
 * **When to use it:** the building block of {@link discoverScope}. Test-only
 * surface — production callers reach for `discoverScope(client)`. Exported
 * for unit testing against captured fixtures.
 *
 * @param html — Full HTML body of a section landing page.
 * @returns The set of root-level slugs (`<a href="/some-slug">`) found inside
 *   the page's `<main>` element. Returns an empty set if `<main>` is absent.
 */
export function extractMainSlugs(html: string): Set<string> {
  const $ = cheerio.load(html);
  const main = $("main").first();
  if (main.length === 0) return new Set();
  const slugs = new Set<string>();
  main.find("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const m = SLUG_HREF_RE.exec(href);
    if (m && typeof m[1] === "string") slugs.add(m[1].toLowerCase());
  });
  return slugs;
}

/**
 * Extract every vgcguide article slug from a sitemap.xml body.
 *
 * **When to use it:** the second half of {@link discoverScope}'s
 * intersection. Exported for unit testing.
 *
 * @param sitemapXml — Raw sitemap XML body.
 * @returns The set of article slugs (root-level URL tails) present in the
 *   sitemap.
 */
export function extractSitemapSlugs(sitemapXml: string): Set<string> {
  const slugs = new Set<string>();
  const re = /<loc>\s*https?:\/\/(?:www\.)?vgcguide\.com\/([a-z0-9][a-z0-9-]*?)\/?\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sitemapXml)) !== null) {
    if (m[1]) slugs.add(m[1].toLowerCase());
  }
  return slugs;
}

/**
 * Pure-function variant of {@link discoverScope}. Computes the
 * `(intro ∪ teambuilding ∪ battling) ∩ sitemap` intersection from
 * already-fetched page bodies.
 *
 * **When to use it:** unit tests. Production callers use
 * {@link discoverScope}, which fetches via the client.
 *
 * @param introHtml — Body of `/intro`.
 * @param teambuildingHtml — Body of `/teambuilding`.
 * @param battlingHtml — Body of `/battling`.
 * @param sitemapXml — Body of `/sitemap.xml`.
 * @returns The set of in-scope article slugs.
 */
export function discoverScopeFromBodies(
  introHtml: string,
  teambuildingHtml: string,
  battlingHtml: string,
  sitemapXml: string,
): Set<string> {
  const navUnion = new Set<string>();
  for (const html of [introHtml, teambuildingHtml, battlingHtml]) {
    for (const slug of extractMainSlugs(html)) navUnion.add(slug);
  }
  // The 3 section roots themselves are landing pages, not articles. Drop
  // them from scope so we don't double-ingest the navigation index.
  for (const root of SECTION_LANDING_SLUGS) navUnion.delete(root);

  const sitemap = extractSitemapSlugs(sitemapXml);
  const scope = new Set<string>();
  for (const slug of navUnion) {
    if (sitemap.has(slug)) scope.add(slug);
  }
  return scope;
}

/**
 * Discover the in-scope article slugs by asking the site itself: walk the
 * 3 section landing pages' `<main>` content + intersect with sitemap.xml.
 *
 * **When to use it:** the ingest script's startup phase. Produces the set of
 * slugs to iterate. Cached + throttled per the underlying client; on a warm
 * cache this is 4 cheap reads.
 *
 * @param client — A {@link VgcGuideClient}.
 * @returns The set of article slugs the site authors include in any of the
 *   3 section navigations AND publish in the sitemap.
 */
export async function discoverScope(client: VgcGuideClient): Promise<Set<string>> {
  const [intro, teambuilding, battling] = await Promise.all([
    client.fetchArticleHtml("intro"),
    client.fetchArticleHtml("teambuilding"),
    client.fetchArticleHtml("battling"),
  ]);
  // Fetch sitemap via the same client (it already exposes `fetchSitemap`,
  // which returns parsed URLs — but we need the raw XML for slug extraction
  // since the slug list isn't directly exposed). For now go through the
  // parsed list and reverse-derive the slugs.
  const sitemapUrls = await client.fetchSitemap();
  const sitemapSlugs = new Set<string>();
  for (const url of sitemapUrls) {
    const m = /^https?:\/\/(?:www\.)?vgcguide\.com\/([a-z0-9][a-z0-9-]*?)\/?$/i.exec(url);
    if (m && m[1]) sitemapSlugs.add(m[1].toLowerCase());
  }

  const navUnion = new Set<string>();
  for (const fetched of [intro, teambuilding, battling]) {
    for (const slug of extractMainSlugs(fetched.html)) navUnion.add(slug);
  }
  for (const root of SECTION_LANDING_SLUGS) navUnion.delete(root);

  const scope = new Set<string>();
  for (const slug of navUnion) {
    if (sitemapSlugs.has(slug)) scope.add(slug);
  }
  return scope;
}
