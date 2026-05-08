/**
 * Subtype tagger for metavgc.com articles. metavgc has no battle-replay
 * subtype today (no per-game match writeups), so this function always returns
 * `null`. Kept symmetric with `tagSubtype` in `tools/vgcguide/tag-subtype.ts`
 * so a site-agnostic ingest helper can call the same surface across adapters.
 *
 * TODO(stage6-deferred): drop this file if metavgc never grows a subtype
 * (per plan §19.6 deferred row #5).
 */

/**
 * Tag a metavgc slug with its subtype, or `null` (the only value today).
 *
 * **When to use it:** during ingest, between the extractor and the chunker,
 * to populate `KnowledgeChunk.subtype`. Pure — no I/O.
 *
 * @param slug — Canonical metavgc slug. Unused beyond signature contract.
 * @returns Always `null`. metavgc has no subtypes in v1.
 *
 * @example
 * ```ts
 * tagSubtype("how-to-counter-incineroar-pokemon-champions"); // → null
 * ```
 */
export function tagSubtype(slug: string): null {
  void slug;
  return null;
}
