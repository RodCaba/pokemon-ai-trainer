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

/** Retrieve one citation per phase (≤ 3 total). Stage 5 implements. */
export async function findPhaseCitations(
  _phases: readonly [LeadPhase, MidPhase, LatePhase],
  _deps: PhaseCitationDeps,
): Promise<TacticalCitation[]> {
  return [];
}
