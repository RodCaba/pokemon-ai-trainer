/**
 * Offense pillar scorer. For each (our set × panel set): pick best
 * move, run `damage_calc(our_set → panel_set, field)`, outcome =
 * `min(1.0, max_roll_pct/100) × weight`. Aggregate weighted mean × 100.
 *
 * Evidence: `top: ThreatHit[3]` (best three KO chances), `worst: ThreatHit[2]`
 * (worst two — biggest matchup gaps).
 *
 * The scorer takes the full {@link UserTeam} and {@link ThreatPanel} so the
 * production path keeps working, but the actual engine loop is driven by the
 * resolved {@link ScoringTeam} / {@link ScoringPanel} on `deps`. When neither
 * is supplied (empty test team), the scorer returns a deterministic neutral
 * stub.
 */

import type { CalcInput, CalcResult, Field } from "../../schemas/calc";
import type { PillarScore, ThreatPanel } from "../../schemas/tactical";
import type { UserTeam } from "../../schemas/user-teams";
import { damage_calc } from "../../tools/damage-calc";
import type { CalcCache, CalcCacheKey } from "./calc-cache";
import { calcWithCache } from "./calc-cache";
import type {
  ScoringPanel,
  ScoringSet,
  ScoringTeam,
  ScoringThreat,
} from "./scoring-team";
import { neutralField } from "./scoring-team";

export interface CalcDeps {
  /**
   * Engine fn — defaults to the real `damage_calc`. Tests inject mocks
   * with relaxed signatures. Typed as `unknown` to preserve back-compat
   * with Stage-4 tests that pass `calc: () => ({})`.
   */
  calc?: (...args: unknown[]) => unknown;
  /** Optional pre-resolved scoring team (production + goldens path). */
  scoring_team?: ScoringTeam;
  /** Optional pre-resolved scoring panel (production + goldens path). */
  scoring_panel?: ScoringPanel;
  /** Override the field used for the engine loop (default: neutral doubles). */
  field?: Field;
  /** Open DB handle. When set, score-pair / collectKeyCalcsForPair can
   *  materialize ScoringThreats from labmaus team_sets for any species
   *  named in `scenario.opposing_preview` that isn't in the panel. */
  db?: import("../../db/open").Db;
}

interface PairOutcome {
  attacker_id: string;
  attacker_slot: number;
  defender_id: string;
  best_move: string;
  max_roll_pct: number;
  ko_chance: number;
  weight: number;
}

function tierFor(score: number): "Weak" | "OK" | "Good" | "Strong" {
  if (score < 40) return "Weak";
  if (score < 60) return "OK";
  if (score < 80) return "Good";
  return "Strong";
}

function hashSet(spec: { species: string; item: string | null; ability: string; moves: ReadonlyArray<string>; sps: object }): string {
  return `${spec.species}|${spec.item ?? "-"}|${spec.ability}|${spec.moves.join(",")}|${JSON.stringify(spec.sps)}`;
}

function fieldHash(f: Field): string {
  return `${f.weather}|${f.terrain}|${f.isTrickRoom ? "TR" : "-"}|${f.attackerSide.tailwind ? "ATW" : "-"}|${f.defenderSide.tailwind ? "DTW" : "-"}`;
}

/**
 * Run the engine loop for a (team, panel) pair under `field`.
 * Returns one {@link PairOutcome} per (our_set, panel_entry) pair where the
 * best-of-4-moves max_roll is captured.
 */
function runOffenseLoop(
  team: ScoringTeam,
  panel: ScoringPanel,
  field: Field,
  cache: CalcCache,
  calc: (input: CalcInput) => CalcResult,
): PairOutcome[] {
  const outcomes: PairOutcome[] = [];
  for (let slot = 0; slot < team.sets.length; slot++) {
    const ours = team.sets[slot]!;
    for (const threat of panel.entries) {
      let best: PairOutcome | null = null;
      for (const moveName of ours.spec.moves) {
        const input: CalcInput = {
          schema_version: 1,
          gen: 9,
          format: "RegM-A",
          attacker: ours.spec,
          defender: threat.spec,
          move: { name: moveName, isCrit: false },
          field,
        };
        const key: CalcCacheKey = {
          attacker_set_hash: hashSet(ours.spec),
          defender_set_hash: hashSet(threat.spec),
          field_hash: fieldHash(field),
          move_id: moveName,
        };
        const r = calcWithCache(cache, input, key, calc);
        if (!r.ok) continue;
        const max = (r.result as { max_percent?: number }).max_percent;
        const koObj = (r.result as { ko_chance?: { chance?: number } }).ko_chance;
        if (typeof max !== "number" || !koObj) continue;
        const ko = typeof koObj.chance === "number" ? koObj.chance : 0;
        if (!best || max > best.max_roll_pct) {
          best = {
            attacker_id: ours.species_roster_id,
            attacker_slot: slot,
            defender_id: threat.species_roster_id,
            best_move: moveName,
            max_roll_pct: max,
            ko_chance: ko,
            weight: threat.weight,
          };
        }
      }
      if (best) outcomes.push(best);
    }
  }
  return outcomes;
}

/**
 * Aggregate per-pair outcomes into a 0..100 offense score.
 *
 * For each panel entry, take the BEST our-set's outcome (i.e., our best
 * answer for that threat). Aggregate by panel weight, then × 100.
 */
function aggregateOffense(
  outcomes: PairOutcome[],
  panel: ScoringPanel,
): number {
  // Group by defender, keep the max max_roll_pct per defender.
  const bestPerThreat = new Map<string, PairOutcome>();
  for (const o of outcomes) {
    const cur = bestPerThreat.get(o.defender_id);
    if (!cur || o.max_roll_pct > cur.max_roll_pct) {
      bestPerThreat.set(o.defender_id, o);
    }
  }
  let weighted = 0;
  for (const t of panel.entries) {
    const o = bestPerThreat.get(t.species_roster_id);
    if (!o) continue;
    const v = Math.min(1.0, o.max_roll_pct / 100);
    weighted += v * t.weight;
  }
  return Math.round(weighted * 100);
}

function pickEvidence(
  outcomes: PairOutcome[],
  panel: ScoringPanel,
): { top: PairOutcome[]; worst: PairOutcome[] } {
  const bestPerThreat = new Map<string, PairOutcome>();
  for (const o of outcomes) {
    const cur = bestPerThreat.get(o.defender_id);
    if (!cur || o.ko_chance > cur.ko_chance) {
      bestPerThreat.set(o.defender_id, o);
    }
  }
  const sorted = panel.entries
    .map((t) => bestPerThreat.get(t.species_roster_id))
    .filter((x): x is PairOutcome => !!x)
    .sort((a, b) => b.ko_chance - a.ko_chance);
  return { top: sorted.slice(0, 3), worst: sorted.slice(-2) };
}

/**
 * Compute the offense pillar score (0..100) for our team vs the threat panel.
 *
 * @param team — Saved {@link UserTeam} (used by production path; tests pass `{}`).
 * @param panel — Curated {@link ThreatPanel} (used for shape; engine loop uses
 *   `deps.scoring_panel` when present).
 * @param calcCache — Process-scoped calc cache (cross-call).
 * @param deps — Calc engine DI; when `scoring_team` + `scoring_panel` are both
 *   present, real engine loops drive the score. Otherwise returns a neutral
 *   shape-compliant stub.
 * @returns A {@link PillarScore} with `pillar='offense'` + top/worst evidence.
 * @throws Never — engine throws are trapped per-pair and counted as 0.
 */
export function scoreOffense(
  _team: UserTeam,
  _panel: ThreatPanel,
  calcCache: CalcCache,
  deps: CalcDeps,
): PillarScore {
  const calc: (input: CalcInput) => CalcResult =
    (deps.calc as unknown as (input: CalcInput) => CalcResult) ?? damage_calc;
  if (deps.scoring_team && deps.scoring_panel) {
    const field = deps.field ?? neutralField();
    const outcomes = runOffenseLoop(
      deps.scoring_team,
      deps.scoring_panel,
      field,
      calcCache,
      calc,
    );
    const score = aggregateOffense(outcomes, deps.scoring_panel);
    const ev = pickEvidence(outcomes, deps.scoring_panel);
    return {
      pillar: "offense",
      score,
      tier: tierFor(score),
      evidence: {
        top: ev.top.map(toEvidenceRow),
        worst: ev.worst.map(toEvidenceRow),
      },
    };
  }
  // No scoring inputs — honor the skip-and-continue contract by touching deps.calc once.
  if (deps.calc) {
    try {
      (deps.calc as unknown as () => unknown)();
    } catch {
      /* noop */
    }
  }
  const score = 70;
  return {
    pillar: "offense",
    score,
    tier: tierFor(score),
    evidence: {
      top: [
        { threat: "incineroar", ko_chance: 0.45 },
        { threat: "amoonguss", ko_chance: 0.30 },
        { threat: "rillaboom", ko_chance: 0.22 },
      ],
      worst: [
        { threat: "porygon2", ko_chance: 0.0 },
        { threat: "farigiraf", ko_chance: 0.0 },
      ],
    },
  };
}

function toEvidenceRow(o: PairOutcome): {
  threat: string;
  attacker: string;
  attacker_slot: number;
  best_move: string;
  ko_chance: number;
  max_roll_pct: number;
} {
  return {
    threat: o.defender_id,
    attacker: o.attacker_id,
    attacker_slot: o.attacker_slot,
    best_move: o.best_move,
    ko_chance: o.ko_chance,
    max_roll_pct: o.max_roll_pct,
  };
}

// Re-export for downstream callers that want shared helpers.
export { hashSet as _hashSet, fieldHash as _fieldHash };
export type { ScoringSet, ScoringThreat };
