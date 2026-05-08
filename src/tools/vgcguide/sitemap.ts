/**
 * Pure-function sitemap parser. Given the raw `sitemap.xml` body, returns
 * the canonical article URLs.
 */

// TODO(stage6-deferred): harden against CDATA / comments if sitemap shape ever drifts
const LOC_RE = /<loc>\s*([^<\s][^<]*?)\s*<\/loc>/g;

/**
 * Parse a vgcguide sitemap.xml into the list of article URLs.
 *
 * **When to use it:** internal helper for the vgcguide client. Pure — no I/O.
 *
 * @param xml — Raw sitemap.xml body as fetched from `/sitemap.xml`.
 * @returns Canonical article URLs (e.g. `https://www.vgcguide.com/speed-control`).
 */
export function parseVgcGuideSitemap(xml: string): string[] {
  const urls: string[] = [];
  let m: RegExpExecArray | null;
  LOC_RE.lastIndex = 0;
  while ((m = LOC_RE.exec(xml)) !== null) {
    const u = m[1]!.trim();
    if (/^https?:\/\/(www\.)?vgcguide\.com\//i.test(u)) {
      urls.push(u);
    }
  }
  return urls;
}
