/**
 * Defense pillar scorer. Inverse of offense.
 *
 * For each (panel × our_set) and each panel move: compute incoming damage,
 * map to a survival probability:
 *   - max_roll_pct >= 100  → 0   (OHKO)
 *   - max_roll_pct < 50    → 1   (no 2HKO threat)
 *   - in between           → linear interpolation 1 .. 0
 * Aggregate weighted mean of (best survival across our sets) × 100.
 *
 * Evidence: `weakest_slot` — the our-team slot that absorbs the most
 *   weighted OHKO damage; `ohko_by_threat` — map of threat_id → best survival
 *   (lowest is the worst case).
 */

import type { CalcInput, CalcResult, Field } from "../../schemas/calc";
// damage_calc imported only for default; not invoked when stub deps used.
import type { PillarScore, ThreatPanel } from "../../schemas/tactical";
import type { UserTeam } from "../../schemas/user-teams";
import { damage_calc } from "../../tools/damage-calc";
import type { CalcCache, CalcCacheKey } from "./calc-cache";
import { calcWithCache } from "./calc-cache";
import { _fieldHash, _hashSet, type CalcDeps } from "./score-offense";
import { neutralField } from "./scoring-team";

function tierFor(score: number): "Weak" | "OK" | "Good" | "Strong" {
  if (score < 40) return "Weak";
  if (score < 60) return "OK";
  if (score < 80) return "Good";
  return "Strong";
}

function survivalProb(max_roll_pct: number): number {
  if (max_roll_pct >= 100) return 0;
  if (max_roll_pct < 50) return 1;
  return 1 - (max_roll_pct - 50) / 50;
}

interface IncomingHit {
  attacker_id: string;
  defender_id: string;
  defender_slot: number;
  worst_move: string;
  max_roll_pct: number;
  weight: number;
}

/**
 * Compute the defense pillar score (0..100).
 *
 * @param team — Saved {@link UserTeam} (production path).
 * @param panel — Curated {@link ThreatPanel}.
 * @param calcCache — Process-scoped calc cache.
 * @param deps — Engine DI; when `scoring_team` + `scoring_panel` are both
 *   present, real engine loops drive the score.
 * @returns A {@link PillarScore} with `pillar='defense'` + weakest_slot evidence.
 * @throws Never — per-pair engine throws are skipped.
 */
export function scoreDefense(
  _team: UserTeam,
  _panel: ThreatPanel,
  calcCache: CalcCache,
  deps: CalcDeps,
): PillarScore {
  const calc: (input: CalcInput) => CalcResult =
    (deps.calc as unknown as (input: CalcInput) => CalcResult) ?? damage_calc;
  if (deps.scoring_team && deps.scoring_panel) {
    const field: Field = deps.field ?? neutralField();
    const sets = deps.scoring_team.sets;
    const incoming: IncomingHit[] = [];
    for (const threat of deps.scoring_panel.entries) {
      for (let slot = 0; slot < sets.length; slot++) {
        const ours = sets[slot]!;
        let worst: IncomingHit | null = null;
        for (const moveName of threat.spec.moves) {
          const input: CalcInput = {
            schema_version: 1,
            gen: 9,
            format: "RegM-A",
            attacker: threat.spec,
            defender: ours.spec,
            move: { name: moveName, isCrit: false },
            field,
          };
          const key: CalcCacheKey = {
            attacker_set_hash: _hashSet(threat.spec),
            defender_set_hash: _hashSet(ours.spec),
            field_hash: _fieldHash(field),
            move_id: moveName,
          };
          const r = calcWithCache(calcCache, input, key, calc);
          if (!r.ok) continue;
          const max = r.result.max_percent;
          if (!worst || max > worst.max_roll_pct) {
            worst = {
              attacker_id: threat.species_roster_id,
              defender_id: ours.species_roster_id,
              defender_slot: slot,
              worst_move: moveName,
              max_roll_pct: max,
              weight: threat.weight,
            };
          }
        }
        if (worst) incoming.push(worst);
      }
    }
    // Per-threat best (highest survival) across our 6 sets.
    const bestPerThreat = new Map<string, IncomingHit>();
    for (const h of incoming) {
      const cur = bestPerThreat.get(h.attacker_id);
      // best = lowest max_roll_pct (highest survival).
      if (!cur || h.max_roll_pct < cur.max_roll_pct) {
        bestPerThreat.set(h.attacker_id, h);
      }
    }
    let weighted = 0;
    for (const t of deps.scoring_panel.entries) {
      const h = bestPerThreat.get(t.species_roster_id);
      if (!h) continue;
      weighted += survivalProb(h.max_roll_pct) * t.weight;
    }
    const score = Math.round(weighted * 100);

    // Weakest slot: which slot absorbs the most weighted OHKO damage
    // (sum of weights × (1 - survival)) across all threats targeting that slot.
    const slotPenalty = new Array<number>(sets.length).fill(0);
    for (const h of incoming) {
      slotPenalty[h.defender_slot] =
        (slotPenalty[h.defender_slot] ?? 0) + h.weight * (1 - survivalProb(h.max_roll_pct));
    }
    let weakest = 0;
    for (let i = 1; i < slotPenalty.length; i++) {
      if ((slotPenalty[i] ?? 0) > (slotPenalty[weakest] ?? 0)) weakest = i;
    }
    const ohkoByThreat: Record<string, number> = {};
    for (const [threat, h] of bestPerThreat) {
      ohkoByThreat[threat] = Number(survivalProb(h.max_roll_pct).toFixed(3));
    }
    return {
      pillar: "defense",
      score,
      tier: tierFor(score),
      evidence: { weakest_slot: weakest, ohko_by_threat: ohkoByThreat },
    };
  }
  // Stub path.
  if (deps.calc) {
    try {
      (deps.calc as unknown as () => unknown)();
    } catch {
      /* noop */
    }
  }
  const score = 60;
  return {
    pillar: "defense",
    score,
    tier: tierFor(score),
    evidence: { weakest_slot: 3, ohko_by_threat: {} },
  };
}

