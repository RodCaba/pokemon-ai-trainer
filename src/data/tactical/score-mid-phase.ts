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

/**
 * Result of {@link scoreMidPhase}: numeric score plus the Stage D
 * mid → late HP echo.
 *
 * `mid_incoming_damage_pct.ours[0]` = max-roll % opposing leads deal to
 * the mid pivot under the mid-phase field. Stub path returns `[0, 0]`.
 */
export interface ScoreMidPhaseResult {
  score: number;
  mid_incoming_damage_pct: {
    ours: [number, number];
  };
}

/**
 * Score a mid-phase candidate slot AND surface the mid → late HP echo
 * (Stage D Q2).
 *
 * **When to use it:** called once per candidate per scenario by
 * `scorePlan` in `recommend-plan.ts`. The score in `[0, 150]` drives
 * candidate ranking; the echo seeds `deriveTurnStates.midIncomingDamagePct`.
 *
 * Stage 5 emits a deterministic role-bonus score; the real
 * `damage_calc`-driven survival sim is `TODO(stage6-deferred):
 * mid-phase-true-board-sim`.
 *
 * @param midSlot - The slot index picked as mid pivot.
 * @param scenario - Scenario skeleton (field + opposing_preview).
 * @param _calcCache - Process-scoped calc cache (unused on stub path).
 * @param deps - Calc engine DI. When `teamSlotSpeciesIds` +
 *   `roleAssignments` are present, role bonuses apply.
 * @returns `{ score, mid_incoming_damage_pct: { ours: [0, 0] } }` on the
 *   stub path. Always finite numbers.
 * @throws Never.
 */
export function scoreMidPhase(
  midSlot: number,
  scenario: ScenarioSkeleton,
  _calcCache: CalcCache,
  deps: CalcDeps,
): ScoreMidPhaseResult {
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
  const score = Math.max(0, Math.min(150, slotWeight + opponentBonus + roleBonus));
  return {
    score,
    mid_incoming_damage_pct: { ours: [0, 0] },
  };
}
