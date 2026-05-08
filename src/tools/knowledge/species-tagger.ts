/**
 * Site-agnostic species tagger. Given a chunk of text, return the canonical
 * Champions species ids the chunk references — whole-word match,
 * case-insensitive, longest-form-wins on overlapping spans.
 *
 * Used by the metavgc ingest pipeline as a pure pipeline stage between
 * `chunkExtractedArticle` and `embedClient.embed`. Also reused at backfill
 * time to populate `knowledge_chunk_species_tags` for existing vgcguide rows
 * (plan §19.4 / §19.6 deferred row #3).
 *
 * Per `db_orm_drizzle.md` we considered routing reads through `roster.get`
 * but rejected: 286 per-name lookups for the index build would be ~286 ×
 * prepared-statement calls when one bulk SELECT covers it. The tagger is an
 * in-process index, not a ref table, so `createSimpleRepo` doesn't apply.
 */

import type { Db } from "../../db/open";
import { SpeciesTaggerError } from "../../schemas/errors";

/**
 * Pre-built case-insensitive species lookup index.
 *
 * Each entry pairs a regex with the canonical species id and a length hint
 * used by {@link detectSpeciesTags} to resolve overlap conflicts (longest
 * match wins).
 */
export interface SpeciesIndex {
  entries: ReadonlyArray<{
    pattern: RegExp;
    speciesId: string;
    /** Char count of the surface form the pattern matches — used for longest-form-wins. */
    lengthHint: number;
  }>;
}

/** Escape a string for use as a literal in a RegExp. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface SpeciesRow {
  id: string;
  display_name: string;
  is_mega: number;
  aliases: string;
}

/**
 * Build the in-process species index from the DB.
 *
 * **When to use it:** at ingest start. Reads `species` joined to
 * `roster_membership` filtered to the active Reg M-A roster (`format =
 * 'RegM-A'`, `is_legal = 1`). Each row contributes regex patterns for its
 * canonical display name, every alias from `species.aliases` (JSON array),
 * and — for `is_mega = 1` rows — a synthesized `"Mega <Species>"` form
 * derived from the trailing `-Mega` segment of the display name when no
 * explicit alias already covers it.
 *
 * @param db — Open Drizzle DB handle.
 * @returns A {@link SpeciesIndex}; the entries are pre-compiled `RegExp`
 *   objects with global+ignoreCase flags so each call to
 *   {@link detectSpeciesTags} re-uses them without per-call allocation.
 * @throws {SpeciesTaggerError} If zero matching species rows are returned.
 *   Per flow §8 species-tagging is a contract — empty index means the
 *   roster table is missing or the slice can't run meaningfully.
 *
 * @example
 * ```ts
 * const idx = buildSpeciesIndex(db);
 * const tags = detectSpeciesTags("Sneasler punishes Incineroar", idx);
 * // tags === ["sneasler", "incineroar"]  (or order of first occurrence)
 * ```
 */
export function buildSpeciesIndex(db: Db): SpeciesIndex {
  const rows = db.$client
    .prepare(
      `SELECT s.id, s.display_name, s.is_mega, s.aliases
         FROM species s
         JOIN roster_membership m ON m.species_id = s.id
        WHERE m.format = 'RegM-A' AND m.is_legal = 1`,
    )
    .all() as SpeciesRow[];

  if (rows.length === 0) {
    throw new SpeciesTaggerError(
      "buildSpeciesIndex: no Reg-M-A-legal species found — refusing to tag",
    );
  }

  const entries: Array<{
    pattern: RegExp;
    speciesId: string;
    lengthHint: number;
  }> = [];

  for (const row of rows) {
    const surfaceForms = new Set<string>();
    surfaceForms.add(row.display_name);
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.aliases);
    } catch {
      parsed = [];
    }
    if (Array.isArray(parsed)) {
      for (const a of parsed) {
        if (typeof a === "string" && a.trim().length > 0) {
          surfaceForms.add(a);
        }
      }
    }

    if (row.is_mega === 1) {
      // Synthesize a "Mega <Species>" form from the canonical display name.
      // Examples: "Garchomp-Mega" → "Mega Garchomp"; "Charizard-Mega-X" →
      // "Mega Charizard X". Skip if an explicit alias already covers it.
      const m = /^(.*)-Mega(?:-([A-Z]))?$/.exec(row.display_name);
      if (m !== null) {
        const base = m[1] ?? "";
        const variant = m[2] ?? "";
        const synth =
          variant.length > 0 ? `Mega ${base} ${variant}` : `Mega ${base}`;
        if (synth.length > 4) surfaceForms.add(synth);
      }
    }

    for (const form of surfaceForms) {
      const escaped = escapeRegex(form);
      // `\b` is ASCII; species names are ASCII-only, so this is correct.
      entries.push({
        pattern: new RegExp(`\\b${escaped}\\b`, "gi"),
        speciesId: row.id,
        lengthHint: form.length,
      });
    }
  }

  return { entries };
}

/**
 * Detect canonical species ids referenced by `chunkText`.
 *
 * **When to use it:** the pipeline stage between `chunkExtractedArticle` and
 * `embedClient.embed`. Called once per chunk; the {@link SpeciesIndex} is
 * built once per ingest run.
 *
 * Algorithm:
 *   1. Run every entry's pattern against the text; collect all matches with
 *      their `[start, end)` spans, species id, and length hint.
 *   2. Sort by `start ASC, lengthHint DESC` so a longer-form match beats a
 *      shorter overlapping one (e.g. `Garchomp-Mega` beats `Garchomp` on the
 *      span "Mega Garchomp").
 *   3. Walk the sorted list and drop any match whose span overlaps an
 *      already-accepted longer match.
 *   4. Deduplicate by species id, preserving order of first occurrence.
 *
 * @param chunkText — The verbatim chunk text to scan.
 * @param index — Pre-built species index from {@link buildSpeciesIndex}.
 * @returns Canonical species ids in order of first occurrence in the text.
 *   Returns `[]` when no roster species is mentioned.
 *
 * @example
 * ```ts
 * detectSpeciesTags("Mega Garchomp shreds with Outrage.", index);
 * // → ["garchomp-mega"]   (NOT ["garchomp","garchomp-mega"])
 *
 * detectSpeciesTags("the meta has an incineroarish smell", index);
 * // → []                  (word-boundary blocks substring matches)
 * ```
 */
export function detectSpeciesTags(
  chunkText: string,
  index: SpeciesIndex,
): string[] {
  interface Match {
    start: number;
    end: number;
    speciesId: string;
    lengthHint: number;
  }
  const matches: Match[] = [];
  for (const e of index.entries) {
    e.pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = e.pattern.exec(chunkText)) !== null) {
      matches.push({
        start: m.index,
        end: m.index + m[0].length,
        speciesId: e.speciesId,
        lengthHint: e.lengthHint,
      });
      // Avoid zero-length-match infinite loops (shouldn't happen with our
      // patterns but defensive).
      if (m[0].length === 0) e.pattern.lastIndex += 1;
    }
  }

  // Sort: earliest start first; on tie, longest-form first.
  matches.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return b.lengthHint - a.lengthHint;
  });

  // Drop overlapping matches that aren't the longest at their position.
  const accepted: Match[] = [];
  for (const m of matches) {
    let overlapsLonger = false;
    for (const acc of accepted) {
      if (m.start < acc.end && m.end > acc.start) {
        if (acc.lengthHint >= m.lengthHint) {
          overlapsLonger = true;
          break;
        }
      }
    }
    if (!overlapsLonger) accepted.push(m);
  }

  // Order-preserving dedup by speciesId.
  accepted.sort((a, b) => a.start - b.start);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of accepted) {
    if (!seen.has(m.speciesId)) {
      seen.add(m.speciesId);
      out.push(m.speciesId);
    }
  }
  return out;
}
