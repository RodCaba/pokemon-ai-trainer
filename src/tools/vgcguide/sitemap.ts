/**
 * Pure-function sitemap parser. Given the raw `sitemap.xml` body, returns
 * the canonical article URLs.
 *
 * Stage 4 stub: throws `not implemented (Stage 5)`.
 */

/**
 * Parse a vgcguide sitemap.xml into the list of article URLs.
 *
 * **When to use it:** internal helper for the vgcguide client. Pure — no I/O.
 *
 * @param xml — Raw sitemap.xml body as fetched from `/sitemap.xml`.
 * @returns Canonical article URLs (e.g. `https://www.vgcguide.com/speed-control`).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function parseVgcGuideSitemap(xml: string): string[] {
  throw new Error("not implemented (Stage 5)");
}
