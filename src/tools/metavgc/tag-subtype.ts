/**
 * Stage 4 scaffold — signatures only. Stage 5 implements per
 * `docs/plans/metavgc-guides.md` §2.2.
 *
 * metavgc has no battle-replay subtype today; this function always returns
 * `null`. Kept symmetric with vgcguide for future expansion.
 */

export function tagSubtype(_slug: string): null {
  void _slug;
  throw new Error("not implemented (Stage 5)");
}
