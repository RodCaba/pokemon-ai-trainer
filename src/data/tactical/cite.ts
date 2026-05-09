/**
 * Pulls 1–3 KnowledgeChunks via knowledge.search with
 * `species_id_filter = leads ∪ opposing_leads`. Empty result allowed.
 */

import type { Db } from "../../db/open";
import type {
  ScenarioOverview,
  TacticalCitation,
} from "../../schemas/tactical";

export interface CiteDeps {
  db: Db;
  knowledge?: unknown;
}

/**
 * Find ≤ 3 knowledge_chunks whose species_ids overlap the given leads /
 * opposing leads.
 *
 * @param scenario - The scenario context (unused in v1 stub).
 * @param speciesIds - Leads and opposing leads to filter on.
 * @param deps - DB handle + optional knowledge namespace.
 * @returns Up to 3 {@link TacticalCitation}s; empty array if no match.
 * @throws Never.
 */
export function findCitations(
  _scenario: ScenarioOverview,
  speciesIds: ReadonlyArray<string>,
  _deps: CiteDeps,
): TacticalCitation[] {
  // v1 stub: no real knowledge index yet — return ≤ 1 synthetic match
  // when any species id is in the canonical roster shortlist; else [].
  const knownShortlist = new Set([
    "incineroar", "amoonguss", "rillaboom", "garchomp", "calyrex-shadow",
    "porygon2", "iron-hands", "indeedee-f", "pelipper", "abomasnow",
    "tornadus", "landorus-therian", "ogerpon-hearthflame",
    "urshifu-rapid-strike", "farigiraf",
  ]);
  const overlap = speciesIds.filter((s) => knownShortlist.has(s));
  if (overlap.length === 0) return [];
  return [
    {
      knowledge_chunk_id: `synthetic:${overlap[0]}`,
      excerpt: `${overlap[0]} is a high-usage Reg M-A threat per recent meta snapshots.`,
      source_url: `https://example.com/meta/${overlap[0]}`,
      species_ids: overlap.slice(0, 4),
    },
  ];
}
