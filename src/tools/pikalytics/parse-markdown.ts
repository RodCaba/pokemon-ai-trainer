/**
 * Stage 4 stub for the pikalytics markdown parser. Real implementation lands in
 * Stage 5 per `docs/plans/pikalytics.md` §2 / §3.
 */

/**
 * Intermediate raw shape produced by {@link parsePikalyticsMarkdown}. Roster-id
 * resolution and tera-strip happen in the transform layer; this layer only
 * extracts the structured data.
 */
export interface RawSnapshot {
  /** ISO date `YYYY-MM-DD` (mapped from Pikalytics's `YYYY-MM` Data-Date row). */
  as_of: string;
  /**
   * Overall species usage %. Nullable — the live AI-markdown endpoint doesn't
   * expose it (verified 2026-05-07; see fixtures/pikalytics/README.md).
   */
  usage_percent: number | null;
  teammates: Array<{ display_name: string; percent: number }>;
  items: Array<{ name: string; percent: number }>;
  abilities: Array<{ name: string; percent: number }>;
  moves: Array<{ name: string; percent: number }>;
  /** Notes about missing/unparseable optional sections. */
  raw_warnings: string[];
}

/**
 * Parse raw pikalytics AI-markdown into a {@link RawSnapshot}.
 *
 * **When to use it:** the only entry point into the structured representation.
 * Pure function — no I/O, no roster lookup, no schema validation.
 *
 * Permissive on optional sections (missing → empty arrays + warnings); strict on
 * `as_of` (missing → throw {@link PikalyticsParseError}).
 *
 * @param raw — Raw markdown body returned by the AI-markdown endpoint.
 * @returns A {@link RawSnapshot}.
 * @throws {PikalyticsParseError} On missing `as_of` (Data-Date row).
 */
export function parsePikalyticsMarkdown(_raw: string): RawSnapshot {
  void _raw;
  throw new Error("not implemented (Stage 5): parsePikalyticsMarkdown");
}
