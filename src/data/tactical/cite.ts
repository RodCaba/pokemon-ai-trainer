/**
 * Citation lookup for tactical scenarios.
 *
 * Pulls ≤ 3 `knowledge_chunks` whose species-tags overlap the scenario's
 * leads + opposing leads. Goes through the link-table reader
 * `listBySpeciesTags` from `src/db/knowledge.ts` — no vector relevance
 * ranking; the contract is "any chunk that mentions a relevant species,
 * most-recent first." Empty result when no chunk matches.
 */

import type { Db } from "../../db/open";
import { listBySpeciesTags } from "../../db/knowledge";
import type {
  ScenarioOverview,
  TacticalCitation,
} from "../../schemas/tactical";
import type { EmbedClient } from "../../tools/knowledge/embed";
import { createInsightStore } from "../../db/insights";

/**
 * One-line insight citation surfaced on `ScenarioOverview.insights`.
 *
 * **When to use it:** the agent quotes `claim` with `source_url`/timestamp
 * when explaining "why this lead?" / "what does the author say?". Distinct
 * from `TacticalCitation` (which links to a `knowledge_chunks` paragraph).
 */
export interface InsightCitation {
  insight_id: string;
  claim: string;
  claim_type: "matchup" | "set" | "lead" | "meta_trend" | "tech" | "counter";
  source_url: string;
  source_timestamp_seconds?: number;
  source_author?: string;
  score: number;
}

/** Threshold cosine score below which insight citations are dropped. */
export const INSIGHT_CITE_SCORE_THRESHOLD = 0.6;

/** Deps for {@link findInsightCitations}. */
export interface InsightCiteDeps {
  db: Db;
  embedClient: EmbedClient;
  /** Max insights to return per call. Default 3 per plan §2.3. */
  limit?: number;
  /** Score threshold (default {@link INSIGHT_CITE_SCORE_THRESHOLD}). */
  minScore?: number;
}

/**
 * Find ≤ `limit` insights whose `subjects.pokemon` overlap the scenario's
 * species AND whose cosine similarity to the scenario query meets the
 * threshold (default 0.6).
 *
 * **When to use it:** an additive companion to {@link findCitations}. Surfaces
 * atomic claim-level citations alongside paragraph-level chunk citations on
 * `ScenarioOverview.insights`.
 *
 * @param _scenario — Scenario context (the `description`/`reasoning` is used
 *   as the embedding query).
 * @param _speciesIds — Leads ∪ opposing leads. Empty array → empty result.
 * @param _deps — DB handle + embed client + optional limit/threshold.
 * @returns Up to `limit` {@link InsightCitation}s sorted by score descending.
 *          Empty array on no match or if all candidates fall below threshold.
 * @throws {RosterDbError} On SQLite I/O failure.
 *
 * @example
 *   const insights = await findInsightCitations(scenario, ["incineroar"], { db, embedClient });
 */
export async function findInsightCitations(
  _scenario: ScenarioOverview,
  _speciesIds: ReadonlyArray<string>,
  _deps: InsightCiteDeps,
): Promise<InsightCitation[]> {
  // Stage 4 stub — invokes the v2 store which throws "not implemented".
  // Stage 5 wires the real flow: embed query, search with subject filter,
  // threshold + map to InsightCitation.
  void _scenario;
  void _speciesIds;
  const _store = createInsightStore(_deps.db, { embedClient: _deps.embedClient });
  throw new Error("findInsightCitations: not implemented (Stage 5)");
}

/** Repository deps for {@link findCitations}. */
export interface CiteDeps {
  db: Db;
  /** Max chunks to return per call. Default 3 per flow §6.2. */
  limit?: number;
}

/**
 * Find ≤ `limit` knowledge_chunks whose `species_tags` overlap the given
 * leads / opposing leads. Returns most-recent first.
 *
 * **When to use it:** the tactical-overview orchestrator attaches citations
 * to each scenario via this helper. Direct callers in tests can also use it
 * to verify the link-table query plan.
 *
 * @param scenario — The scenario context (currently only its species help
 *   determine the filter; the field/weather is not used to rank citations).
 * @param speciesIds — Leads ∪ opposing leads. Duplicates allowed (de-duped
 *   internally before the SQL query). Empty array → empty result.
 * @param deps — DB handle + optional `limit` (default 3).
 * @returns Up to `limit` {@link TacticalCitation}s; empty array on no match.
 * @throws {RosterDbError} On SQLite I/O failure (propagated from the repo
 *   helper).
 *
 * @example
 *   const cites = findCitations(scenario, ["incineroar", "sneasler"], { db });
 *   for (const c of cites) console.log(c.source_site, c.article_title, c.excerpt);
 */
export function findCitations(
  _scenario: ScenarioOverview,
  speciesIds: ReadonlyArray<string>,
  deps: CiteDeps,
): TacticalCitation[] {
  const limit = deps.limit ?? 3;
  const dedup = Array.from(new Set(speciesIds));
  if (dedup.length === 0) return [];
  const rows = listBySpeciesTags(deps.db, dedup, limit);
  if (rows.length === 0) return [];
  return rows.map((r): TacticalCitation => {
    // Surface only species_tags that the scenario actually cared about
    // (the chunk may be tagged with more — keep the call-site signal tight).
    const filteredTags = r.species_tags.filter((s) => dedup.includes(s));
    const tagsToShow = filteredTags.length > 0 ? filteredTags : r.species_tags;
    return {
      knowledge_chunk_id: r.chunk.id,
      excerpt: r.chunk.chunk_text.slice(0, 280),
      source_url: r.chunk.article_url,
      species_ids: tagsToShow,
      source_site: r.chunk.source_site,
      article_title: r.chunk.article_title,
    };
  });
}
