/**
 * Markdown parser for Pikalytics's AI-markdown endpoint. Pure function — no
 * I/O, no roster lookup, no schema validation.
 *
 * Per `docs/plans/pikalytics.md` §2 / §3 and the Stage 4 fixture-driven
 * deviations:
 *
 *   - `as_of` is sourced from the Quick-Info table row
 *     `| **Data Date** | YYYY-MM |` and normalized to ISO `YYYY-MM-01`.
 *     Required — missing → throw {@link PikalyticsParseError}.
 *   - The live AI-markdown endpoint does NOT expose a species-level usage %.
 *     `usage_percent` is `null` when no `## Usage` section is present
 *     (verified 2026-05-07; see fixtures/pikalytics/README.md).
 *   - Optional sections (`Common Teammates`, `Common Items`, `Common
 *     Abilities`, `Common Moves`) may be absent — empty arrays + a warning,
 *     not a throw.
 *   - Tera-shaped lines (`Common Tera Types`, `> Tera Type:`, etc.) are
 *     IGNORED at parse time. Defense-in-depth tera-strip happens in the
 *     transform layer.
 */

import { PikalyticsParseError } from "../../schemas/errors";

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

const DATA_DATE_RE = /\|\s*\*\*Data Date\*\*\s*\|\s*(\d{4})-(\d{2})\s*\|/;
const USAGE_RE = /^##\s+Usage\s*\n+\s*([\d.]+)\s*%/m;
// Per-section bullet item: `- **<Name>**: <number>%`
// Name allowed: any non-`*` chars (preserves hyphens, apostrophes).
const ITEM_RE = /^-\s+\*\*([^*]+)\*\*\s*:\s*([\d.]+)\s*%/gm;

const SECTION_HEADERS: Record<string, "teammates" | "items" | "abilities" | "moves"> = {
  "Common Teammates": "teammates",
  "Common Items": "items",
  "Common Abilities": "abilities",
  "Common Moves": "moves",
};

/**
 * Locate a section by its level-2 heading and return only its body (lines
 * between the heading and the next `##` heading or EOF).
 *
 * JS regex doesn't support `\Z` (Perl/Python end-of-string) — use a lookahead
 * that matches either the next `##` heading at line-start or true end-of-input
 * (`$` in the multiline + dotAll-equivalent form). Per Stage 6 review item 8.
 */
function extractSection(raw: string, header: string): string | null {
  const re = new RegExp(`^##\\s+${header}\\s*\\n([\\s\\S]*?)(?=^##\\s|$(?![\\s\\S]))`, "m");
  const m = re.exec(raw);
  return m ? (m[1] ?? "") : null;
}

function parseSectionItems(body: string): Array<{ name: string; percent: number }> {
  const out: Array<{ name: string; percent: number }> = [];
  ITEM_RE.lastIndex = 0;
  for (let m = ITEM_RE.exec(body); m !== null; m = ITEM_RE.exec(body)) {
    const name = (m[1] ?? "").trim();
    const percent = Number.parseFloat(m[2] ?? "");
    if (!name || !Number.isFinite(percent)) continue;
    out.push({ name, percent });
  }
  return out;
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
export function parsePikalyticsMarkdown(raw: string): RawSnapshot {
  const dataDate = DATA_DATE_RE.exec(raw);
  if (!dataDate) {
    throw new PikalyticsParseError("missing required Data Date row in pikalytics markdown");
  }
  const as_of = `${dataDate[1]}-${dataDate[2]}-01`;

  const usageMatch = USAGE_RE.exec(raw);
  const usage_percent = usageMatch ? Number.parseFloat(usageMatch[1] ?? "") : null;

  const raw_warnings: string[] = [];
  const sections: Record<"teammates" | "items" | "abilities" | "moves", Array<{ name: string; percent: number }>> = {
    teammates: [],
    items: [],
    abilities: [],
    moves: [],
  };

  for (const [header, key] of Object.entries(SECTION_HEADERS)) {
    const body = extractSection(raw, header);
    if (body === null) {
      raw_warnings.push(`missing optional section: ${header}`);
      continue;
    }
    sections[key] = parseSectionItems(body);
  }

  return {
    as_of,
    usage_percent: usage_percent !== null && Number.isFinite(usage_percent) ? usage_percent : null,
    teammates: sections.teammates.map((s) => ({ display_name: s.name, percent: s.percent })),
    items: sections.items,
    abilities: sections.abilities,
    moves: sections.moves,
    raw_warnings,
  };
}
