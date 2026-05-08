/**
 * Stage 4 scaffold — signatures only. Stage 5 implements per
 * `docs/plans/metavgc-guides.md` §2.2.
 */

import type { Db } from "../../db/open";

/** Pre-built case-insensitive species lookup index. */
export interface SpeciesIndex {
  entries: ReadonlyArray<{
    pattern: RegExp;
    speciesId: string;
    lengthHint: number;
  }>;
}

/**
 * Build the in-process species index from the DB. Throws
 * `SpeciesTaggerError` if the species table is empty.
 */
export function buildSpeciesIndex(_db: Db): SpeciesIndex {
  void _db;
  throw new Error("not implemented (Stage 5)");
}

/**
 * Detect canonical species ids referenced by `chunkText`. Whole-word match,
 * case-insensitive, longest-form-wins on overlapping spans, in-text-order.
 */
export function detectSpeciesTags(
  _chunkText: string,
  _index: SpeciesIndex,
): string[] {
  void _chunkText;
  void _index;
  throw new Error("not implemented (Stage 5)");
}
