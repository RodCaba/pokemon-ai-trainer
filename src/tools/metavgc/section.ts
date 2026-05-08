/**
 * Stage 4 scaffold — signatures only. Stage 5 implements per
 * `docs/plans/metavgc-guides.md` §2.2.
 *
 * metavgc articles are pinned to article_section = "intro" per plan §19.
 */

/**
 * Always returns `"intro"` for every metavgc slug. The function exists for
 * symmetry with `inferSectionFromSlug` (vgcguide) so future per-site
 * abstractions can call a uniform surface.
 */
export function inferMetaVgcSection(_slug: string): "intro" {
  void _slug;
  throw new Error("not implemented (Stage 5)");
}
