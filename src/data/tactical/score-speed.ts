/**
 * Speed pillar scorer. Per scenario `field`, applies Choice Scarf,
 * Tailwind, and Trick Room inversion to per-(our_slot × threat) speed
 * comparisons. Weighted mean × 100.
 *
 * TR inversion (Q3 binding): triggers iff team has TR setter ability +
 * ≥ 2 attackers with base spe < 60. Tunable via `tr_min_slow_attackers`.
 */

import type {
  PillarScore,
  ScenarioOverview,
  ThreatPanel,
} from "../../schemas/tactical";
import type { UserTeam } from "../../schemas/user-teams";
import type { SpeedTable, SpeedTableEntry } from "./speed-table";
import type { ScoringTeam, ScoringPanel, ScoringSet, ScoringThreat } from "./scoring-team";

export interface SpeedDeps {
  /** Default 2 per Q3 binding; override for tuning tests. */
  tr_min_slow_attackers?: number;
  /** Base-spe threshold for "slow attacker"; default 60. */
  tr_slow_base_spe?: number;
  /**
   * Force the TR-inversion-active state explicitly; overrides team-derived
   * detection. Used by the live demo path.
   */
  tr_inversion_active?: boolean;
  /** Optional pre-resolved scoring team (production + goldens path). */
  scoring_team?: ScoringTeam;
  /** Optional pre-resolved scoring panel (production + goldens path). */
  scoring_panel?: ScoringPanel;
  /** Whether tailwind is active for our team in the scenario(s) considered. */
  tailwind_active?: boolean;
}

function tierFor(score: number): "Weak" | "OK" | "Good" | "Strong" {
  if (score < 40) return "Weak";
  if (score < 60) return "OK";
  if (score < 80) return "Good";
  return "Strong";
}

const NATURE_PLUS_SPE = new Set([
  "Timid", "Hasty", "Jolly", "Naive",
]);
const NATURE_MINUS_SPE = new Set([
  "Brave", "Relaxed", "Quiet", "Sassy",
]);
// No ability sets Trick Room. The earlier "screen-cleaner / psychic-surge /
// magic-bounce / trace" set was incorrect — none of those abilities set TR.
// TR is set exclusively via the move "Trick Room"; rely on TR_SETTER_MOVES.
const TR_SETTER_ABILITIES: ReadonlySet<string> = new Set<string>();
const TR_SETTER_MOVES = new Set(["trick-room", "trick room", "trickroom"]);

/**
 * Compute final L50 speed: floor(((2*base + 31 + sps_spe) * 50) / 100) + 5,
 * applied with nature multiplier, Choice Scarf, and Tailwind.
 */
function finalSpeed(
  baseSpe: number,
  spsSpe: number,
  nature: string | null | undefined,
  item: string | null | undefined,
  tailwind: boolean,
): number {
  const baseStat = Math.floor(((2 * baseSpe + 31 + spsSpe) * 50) / 100) + 5;
  let mult = 1;
  if (nature && NATURE_PLUS_SPE.has(nature)) mult *= 1.1;
  else if (nature && NATURE_MINUS_SPE.has(nature)) mult *= 0.9;
  if (item && /choice scarf/i.test(item)) mult *= 1.5;
  if (tailwind) mult *= 2;
  return Math.floor(baseStat * mult);
}

function findBaseSpe(table: SpeedTable, speciesId: string): number | null {
  const e = table.entries.find((x) => x.species_id === speciesId);
  return e ? e.base_spe : null;
}

function entryWeightedSpeed(e: SpeedTableEntry): number {
  return e.primary_weighted_speed;
}

/**
 * Compute the speed pillar score (0..100) and emit speed-tier evidence.
 *
 * @param team - The saved {@link UserTeam} being scored.
 * @param panel - Curated {@link ThreatPanel}.
 * @param scenarios - Per-scenario fields (Tailwind/Sun/etc.).
 * @param speedTable - Loaded {@link SpeedTable} fixture.
 * @param deps - Tunables incl. TR-inversion thresholds + scoring inputs.
 * @returns A {@link PillarScore} with `pillar='speed'` + tr_inversion evidence.
 * @throws Never.
 */
export function scoreSpeed(
  team: UserTeam,
  _panel: ThreatPanel,
  _scenarios: ScenarioOverview[],
  speedTable: SpeedTable,
  deps: SpeedDeps,
): PillarScore {
  // TR inversion detection.
  let trActive: boolean;
  if (typeof deps.tr_inversion_active === "boolean") {
    trActive = deps.tr_inversion_active;
  } else {
    const hasSetter = teamHasTrSetter(team, deps.scoring_team, speedTable);
    const slow = countSlowAttackers(team, deps.scoring_team, speedTable, deps.tr_slow_base_spe ?? 60);
    const min = deps.tr_min_slow_attackers ?? 2;
    trActive = hasSetter && slow >= min;
  }

  // No scoring inputs → neutral 50 (test path keeps backward-compat for TAC-T16..T18).
  if (!deps.scoring_team || !deps.scoring_panel) {
    return {
      pillar: "speed",
      score: 50,
      tier: tierFor(50),
      evidence: {
        tr_inversion_active: trActive,
        fastest_tier: 0,
        outspeed_rate: 0,
        outspeed_rate_tailwind: 0,
      },
    };
  }

  const ourSets = deps.scoring_team.sets;
  const panel = deps.scoring_panel;

  // Compute per-our-set final speed (no tailwind), and with tailwind.
  // Compute per-threat final speed using speed-table primary_weighted_speed
  // (or fall back to base × nature-Jolly assumption when missing).
  const oursBaseline = ourSets.map((s) => oursFinalSpeed(s, speedTable, false));
  const oursTailwind = ourSets.map((s) => oursFinalSpeed(s, speedTable, true));
  const threatSpeeds = panel.entries.map((t) => threatSpeed(t, speedTable));

  // Fastest unmodified our-team speed tier.
  const fastest = oursBaseline.reduce((m, x) => Math.max(m, x), 0);

  // Aggregate weighted outcome.
  // Outcome per (slot × threat): 1 if outspeeds, 0.5 if ties, 0 otherwise.
  // For the team's outcome on this threat, take the BEST slot.
  function aggregateOutcome(theirsSpeeds: number[], oursList: number[], inverted: boolean): { score: number; outRate: number } {
    let weighted = 0;
    let outCountWeighted = 0;
    let totalWeight = 0;
    for (let i = 0; i < panel.entries.length; i++) {
      const t = panel.entries[i]!;
      const theirs = theirsSpeeds[i]!;
      let bestOutcome = 0;
      let outspeedsAny = false;
      for (const ours of oursList) {
        let outcome: number;
        if (inverted) {
          // TR: lower is better (we want to be slower).
          if (ours < theirs) outcome = 1;
          else if (ours === theirs) outcome = 0.5;
          else outcome = 0;
        } else {
          if (ours > theirs) outcome = 1;
          else if (ours === theirs) outcome = 0.5;
          else outcome = 0;
        }
        if (outcome > bestOutcome) bestOutcome = outcome;
        if (outcome === 1) outspeedsAny = true;
      }
      weighted += bestOutcome * t.weight;
      if (outspeedsAny) outCountWeighted += t.weight;
      totalWeight += t.weight;
    }
    return {
      score: totalWeight > 0 ? weighted / totalWeight : 0,
      outRate: totalWeight > 0 ? outCountWeighted / totalWeight : 0,
    };
  }

  const baselineAgg = aggregateOutcome(threatSpeeds, oursBaseline, trActive);
  const tailwindAgg = aggregateOutcome(threatSpeeds, oursTailwind, trActive);

  // Final score: weighted mean × 100, baseline (no tailwind).
  const score = Math.round(baselineAgg.score * 100);
  const outRate = Math.round(baselineAgg.outRate * 100);
  const outRateTw = Math.round(tailwindAgg.outRate * 100);

  return {
    pillar: "speed",
    score,
    tier: tierFor(score),
    evidence: {
      tr_inversion_active: trActive,
      fastest_tier: fastest,
      outspeed_rate: outRate,
      outspeed_rate_tailwind: outRateTw,
    },
  };
}

function oursFinalSpeed(s: ScoringSet, table: SpeedTable, tailwind: boolean): number {
  const baseSpe = findBaseSpe(table, s.species_roster_id) ?? 0;
  const spsSpe = s.spec.sps.spe ?? 0;
  return finalSpeed(baseSpe, spsSpe, s.spec.nature, s.spec.item, tailwind);
}

function threatSpeed(t: ScoringThreat, table: SpeedTable): number {
  const e = table.entries.find((x) => x.species_id === t.species_roster_id);
  if (e) return entryWeightedSpeed(e);
  // Fallback: compute from spec.
  const spsSpe = t.spec.sps.spe ?? 0;
  const baseSpe = e ? (e as { base_spe: number }).base_spe : 0;
  return finalSpeed(baseSpe, spsSpe, t.spec.nature, t.spec.item, false);
}

function teamHasTrSetter(
  team: UserTeam,
  scoring: ScoringTeam | undefined,
  _table: SpeedTable,
): boolean {
  if (scoring) {
    return scoring.sets.some((s) => {
      const a = (s.spec.ability ?? "").toLowerCase().replace(/\s+/g, "-");
      if (TR_SETTER_ABILITIES.has(a)) return true;
      return s.spec.moves.some((m) => TR_SETTER_MOVES.has((m ?? "").toLowerCase()));
    });
  }
  const sets = (team as unknown as { sets?: Array<{ ability?: string | null; moves?: string[]; move_1_id?: string; move_2_id?: string; move_3_id?: string; move_4_id?: string }> }).sets;
  if (!sets) return false;
  return sets.some((s) => {
    const a = (s.ability ?? "").toLowerCase().replace(/\s+/g, "-");
    if (TR_SETTER_ABILITIES.has(a)) return true;
    const moves = [s.move_1_id, s.move_2_id, s.move_3_id, s.move_4_id].filter(Boolean) as string[];
    return moves.some((m) => TR_SETTER_MOVES.has((m ?? "").toLowerCase()));
  });
}

function countSlowAttackers(
  team: UserTeam,
  scoring: ScoringTeam | undefined,
  table: SpeedTable,
  threshold: number,
): number {
  if (scoring) {
    return scoring.sets.filter((s) => {
      const baseSpe = findBaseSpe(table, s.species_roster_id) ?? 999;
      return baseSpe < threshold;
    }).length;
  }
  const sets = (team as unknown as { sets?: Array<{ base_spe?: number }> }).sets;
  if (!sets) return 0;
  return sets.filter((s) => typeof s.base_spe === "number" && s.base_spe < threshold).length;
}

