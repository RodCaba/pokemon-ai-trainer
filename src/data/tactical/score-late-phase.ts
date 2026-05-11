/**
 * Late-phase scorer (plan §6.2). Computes the cleaner's best max-roll %
 * against the 2 most-bulky panel members weighted by usage:
 *
 *     late_phase_score = Σ weight_i * best_max_roll_pct(cleaner vs bulky_i)
 *     range 0..100.
 *
 * Stage 5: when `panel.entries` is empty (test path) we return 0 (PS6
 * pins this). When the panel is populated, the proper bulky-cleaner
 * matchup arithmetic runs via `damage_calc` — but Stage 5 ships the
 * deterministic shortcut and defers the real engine call to the
 * calibration follow-up. The contract (return number in [0,100],
 * deterministic, no-throw) is what RP / OV / live demo depend on.
 *
 * `TODO(stage6-deferred): late-phase-engine-integration` — wire the
 * actual `damage_calc` call across the top-2 bulky panel members.
 */

import type { ScenarioSkeleton, ThreatPanel } from "../../schemas/tactical";
import type { CalcCache } from "./calc-cache";
import type { CalcDeps } from "./score-offense";

/** Pure score (0..100) for a cleaner slot vs the bulkiest panel members. */
export function scoreLatePhase(
  cleanerSlot: number,
  _scenario: ScenarioSkeleton,
  panel: ThreatPanel,
  _calcCache: CalcCache,
  _deps: CalcDeps,
): number {
  if (panel.entries.length === 0) return 0;
  // Deterministic baseline: cleaners in earlier slots (typically the
  // dedicated fast-attacker the user committed to) score higher than
  // bench fallbacks. Real engine integration is the calibration follow-up.
  const slotScore = Math.max(0, 80 - cleanerSlot * 8);
  const panelDepth = Math.min(panel.entries.length, 10);
  return Math.max(0, Math.min(100, slotScore + panelDepth * 2));
}
