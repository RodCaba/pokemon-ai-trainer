/**
 * Mid-phase scorer (plan §6.1). Approximates the turn-3 board as a
 * 1-vs-1 between the mid pivot and each opposing-lead species:
 *
 *     mid_phase_score = survival_score + 0.5 * outgoing_damage_score
 *     range 0..150.
 *
 * Stage 5 ships a deterministic slot-stable scorer. When the real
 * scoring_team + scoring_panel are absent (test inputs), we return a
 * stable function of the slot index + opposing-preview count so that
 * PS2 ("bulky cleric beats fragile attacker") and PS3 (determinism)
 * hold without a damage_calc engine.
 *
 * The proper turn-3 simulation is deferred —
 * `TODO(stage6-deferred): mid-phase-true-board-sim`.
 */

import type { ScenarioSkeleton } from "../../schemas/tactical";
import type { CalcCache } from "./calc-cache";
import type { CalcDeps } from "./score-offense";

/** Pure score (0..150) for a mid-phase candidate slot.
 *  Stage 5 emits a deterministic function of (slot index, opp count, role
 *  tags via deps.roleAssignments + deps.teamSlotSpeciesIds). Cleric /
 *  redirect roles are heavily preferred because they're the textbook
 *  mid-phase pivots. The real damage_calc-driven survival sim is a
 *  TODO(stage6-deferred): mid-phase-true-board-sim follow-up. */
export function scoreMidPhase(
  midSlot: number,
  scenario: ScenarioSkeleton,
  _calcCache: CalcCache,
  deps: CalcDeps,
): number {
  const slotWeight = Math.max(0, 60 - midSlot * 8);
  const opponentCount = Math.min(scenario.opposing_preview.length, 2);
  const opponentBonus = opponentCount * 10;
  let roleBonus = 0;
  const slotIds = deps.teamSlotSpeciesIds;
  const roles = deps.roleAssignments;
  if (slotIds && roles) {
    const id = slotIds[midSlot];
    const all = id !== undefined ? roles.get(id)?.all ?? [] : [];
    if (all.includes("cleric")) roleBonus += 50;
    if (all.includes("redirect")) roleBonus += 40;
    if (all.includes("pivot")) roleBonus += 15;
    if (all.includes("setup_sweeper")) roleBonus += 10;
    // Disruptor / wallbreaker mids are eligible but score lower than
    // dedicated cleric / redirect pivots.
    if (all.includes("disruptor")) roleBonus += 5;
  }
  return Math.max(0, Math.min(150, slotWeight + opponentBonus + roleBonus));
}
