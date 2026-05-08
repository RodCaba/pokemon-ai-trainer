/**
 * Slug-keyword heuristic for inferring a vgcguide article's
 * `article_section`. The vgcguide sitemap places every article at
 * root (`https://www.vgcguide.com/<slug>`) — there is no section
 * prefix in the URL, so the slug is the only structural signal we have.
 *
 * Single source of truth: both the extractor (`extract-article.ts`)
 * and the ingest script (`ingest-vgcguide.ts`) import from here. Two
 * call sites previously held duplicate constants; consolidated per
 * Stage 6 review item 6.
 */

const TEAMBUILDING_SLUG_HINTS = [
  "team",
  "speed-control",
  "typing",
  "items",
  "ability",
  "moves",
  "archetype",
];

const BATTLING_SLUG_HINTS = [
  "battling",
  "battle",
  "predict",
  "switching",
  "lead",
  "endgame",
  "matchup",
];

/** Discriminator for vgcguide articles. */
export type ArticleSection = "intro" | "teambuilding" | "battling";

/**
 * Infer the article section from a vgcguide slug via a keyword
 * heuristic. The order matters: `battling` keywords win over
 * `teambuilding` keywords (e.g. `lead` is checked first), and
 * everything that matches neither falls through to `"intro"`.
 *
 * **When to use it:** the only signal available for sectioning, since
 * the sitemap is flat. Ingest passes the result down to the chunker
 * via `extracted.article_section`; the extractor uses the same
 * function as a fallback when the caller does not pass an explicit
 * section.
 *
 * @param slug — Canonical vgcguide slug (the URL tail). Case-insensitive.
 * @returns One of `"intro" | "teambuilding" | "battling"`.
 *
 * @example
 * ```ts
 * inferSectionFromSlug("speed-control");        // → "teambuilding"
 * inferSectionFromSlug("predictions");          // → "battling"
 * inferSectionFromSlug("what-is-pokemon-showdown"); // → "intro"
 * ```
 */
export function inferSectionFromSlug(slug: string): ArticleSection {
  const s = slug.toLowerCase();
  for (const h of BATTLING_SLUG_HINTS) {
    if (s.includes(h)) return "battling";
  }
  for (const h of TEAMBUILDING_SLUG_HINTS) {
    if (s.includes(h)) return "teambuilding";
  }
  return "intro";
}

// Scope filtering used to live here as either an allowlist (53 hardcoded
// slugs) or a denylist (regex patterns). Both required hand-maintenance and
// drifted on every site update. As of 2026-05-08 the ingest derives scope
// from the site's own structural signals via `discover-scope.ts` —
// nav∩sitemap intersection, zero hardcoded lists. This module now owns only
// the slug → section inference used for tagging.
