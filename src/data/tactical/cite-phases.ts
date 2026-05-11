/**
 * Stage 4 scaffold for phase-aware citation retrieval (plan §8).
 *
 * Stage 5 wires the per-phase `claim_type` + `phase_tag` filtered search,
 * the species_id filter per phase, and the no-hit fallback to a
 * non-phase-filtered retry that emits `phase_tag_source: "fallback"`.
 */

import type { Db } from "../../db/open";
import type {
  LeadPhase,
  MidPhase,
  LatePhase,
  TacticalCitation,
} from "../../schemas/tactical";
import type { EmbedClient } from "../../tools/knowledge/embed";

export interface PhaseCitationDeps {
  db: Db;
  embedClient: EmbedClient;
}

/**
 * Retrieve one citation per phase (≤ 3 total).
 *
 * **When to use it:** invoked by `buildOverview` for every plan
 * scenario. Stage B (Q6 §17) sets `phase_tag_source` on each emitted
 * citation so the agent loop can detect fallback retrievals.
 *
 * @param _phases - The three resolved phases [lead, mid, late].
 * @param _deps - DB + embedClient for the InsightStore search.
 * @returns Up to 3 citations, one per phase.
 * @throws Never.
 */
// TODO(stage6-deferred): cite-phases-empty-stub —
// Stage B ships a permanent empty-array stub. The Q6/Q9 design (phase
// filter → species filter → fallback to no-phase-filter with
// `phase_tag_source: "fallback"`) is the Stage C/D follow-up. Until
// the phase_tag backfill (Q12) repopulates the existing insights,
// even the proper implementation would mostly fall back, so the gap
// is documented in the plan §19 deferral list rather than partially
// implemented here.
export async function findPhaseCitations(
  _phases: readonly [LeadPhase, MidPhase, LatePhase],
  _deps: PhaseCitationDeps,
): Promise<TacticalCitation[]> {
  return [];
}
