/**
 * Map a vgcguide article slug to its subtype. Hardcoded list of 3
 * battle-replay slugs per `docs/flows/vgc-knowledge-base.md` §6 Q4.
 *
 * Stage 4 stub: throws `not implemented (Stage 5)`.
 */

/**
 * Slugs of vgcguide articles that are full match-by-match battle replays
 * (high narrative density; agents typically want to exclude these on
 * principle-focused queries via `exclude_subtypes`).
 */
export const BATTLE_REPLAY_SLUGS = [
  "battling-example-alister-sandover-vs-edoardo-giunipero-ferraris",
  "battling-examples-diana-bros-vs-paul-chua-naic-2019",
  "battling-example-will-tansley-vs-nils-dunlop-worlds-2017",
] as const;

/**
 * Tag a vgcguide slug with its subtype, or `null` for principle articles.
 *
 * **When to use it:** during ingest, between the extractor and the chunker,
 * to populate `KnowledgeChunk.subtype`. Pure function — no I/O.
 *
 * @param slug — Canonical vgcguide article slug (lowercase, hyphenated).
 * @returns `"battle-replay"` for the 3 known battle-replay slugs; `null`
 *   for everything else.
 *
 * @example
 * ```ts
 * tagSubtype("speed-control");                                // null
 * tagSubtype("battling-examples-diana-bros-vs-paul-chua-naic-2019");
 * // "battle-replay"
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function tagSubtype(slug: string): null | "battle-replay" {
  throw new Error("not implemented (Stage 5)");
}
