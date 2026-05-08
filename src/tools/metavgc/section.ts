/**
 * Article-section inference for metavgc.com. Per plan §19 Q4: pinned to
 * `"intro"` for every slug. metavgc has no editorial section structure
 * comparable to vgcguide's `intro` / `teambuilding` / `battling` split, so
 * extending the `knowledge_section_value` enum and backfilling vgcguide rows
 * for marginal retrieval value is deferred.
 */

/**
 * Always returns `"intro"` for every metavgc slug.
 *
 * **When to use it:** symmetry with {@link inferSectionFromSlug} (vgcguide).
 * Keeps every per-site adapter exporting the same surface so a future
 * site-agnostic ingest helper can call a uniform function. Pure, no I/O.
 *
 * @param slug — Canonical metavgc slug (case-insensitive). Unused beyond the
 *   signature contract.
 * @returns The literal `"intro"`.
 *
 * @example
 * ```ts
 * inferMetaVgcSection("how-to-counter-incineroar-pokemon-champions");
 * // → "intro"
 * ```
 */
export function inferMetaVgcSection(slug: string): "intro" {
  void slug;
  return "intro";
}
