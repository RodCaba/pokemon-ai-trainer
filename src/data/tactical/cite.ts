/**
 * Pulls 1–3 KnowledgeChunks via knowledge.search with
 * `species_id_filter = leads ∪ opposing_leads`. Empty result allowed
 * (flow §9). Stage-4 stub.
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

export function findCitations(
  _scenario: ScenarioOverview,
  _leads: [string, string],
  _deps: CiteDeps,
): TacticalCitation[] {
  throw new Error("not implemented (Stage 5)");
}
