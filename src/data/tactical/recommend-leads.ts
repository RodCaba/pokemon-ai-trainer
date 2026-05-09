/**
 * Exhaustive C(6,2)=15 lead-pair search per scenario.
 */

import type { Db } from "../../db/open";
import type { ScenarioOverview } from "../../schemas/tactical";
import type { UserTeam } from "../../schemas/user-teams";
import type { CalcCache } from "./calc-cache";
import type { ScoringTeam, ScoringPanel } from "./scoring-team";
import { scorePair, collectKeyCalcsForPair } from "./score-pair";
import { TacticalOverviewError } from "../../schemas/errors";
import type { CalcResultRef } from "../../schemas/tactical";

export interface RecommendDeps {
  db: Db;
  knowledge?: unknown;
  alpha?: number;
  beta?: number;
  gamma?: number;
  scoring_team?: ScoringTeam;
  scoring_panel?: ScoringPanel;
}

function pairs(): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let a = 0; a < 6; a++) for (let b = a + 1; b < 6; b++) out.push([a, b]);
  return out;
}

/**
 * Recommend leads for a scenario via exhaustive 15-pair search.
 *
 * @param team - Our saved team.
 * @param scenario - Scenario skeleton (mutated in-place with picks).
 * @param calcCache - Process-scoped calc cache.
 * @param deps - DB handle + optional knowledge namespace + α/β/γ overrides
 *   + optional scoring inputs (production path).
 * @returns The {@link ScenarioOverview} populated with leads / back / rejected
 *          / pair_score / reasoning.
 * @throws Never.
 */
export function recommendLeads(
  team: UserTeam,
  scenario: ScenarioOverview,
  calcCache: CalcCache,
  deps: RecommendDeps,
): ScenarioOverview {
  const teamSets = (team as unknown as { sets?: Array<{ species_roster_id?: string; species_id?: string }> }).sets;
  // Resolve 6 slot ids. Prefer the scoring team (production) — it's already
  // gated on the team being saved + validation-clean. Fallback to the raw
  // user-team sets when scoring inputs are absent (legacy stub paths).
  let slotIds: string[];
  if (deps.scoring_team && deps.scoring_team.sets.length === 6) {
    slotIds = deps.scoring_team.sets.map((s) => s.species_roster_id);
  } else if (teamSets && teamSets.length === 6) {
    slotIds = teamSets.map((s, i) => {
      const id = s.species_roster_id ?? s.species_id;
      if (!id) {
        throw new TacticalOverviewError(
          `team has < 6 filled slots; cannot recommend leads (slot ${i} empty)`,
        );
      }
      return id;
    });
  } else {
    throw new TacticalOverviewError(
      "team has < 6 filled slots; cannot recommend leads",
    );
  }

  // Score each of the 15 pairs. When scoring inputs are present, score-pair
  // uses the real `damage_calc` engine by default; otherwise the stub.
  const calcDeps = {
    ...(deps.scoring_team ? { scoring_team: deps.scoring_team } : { calc: () => ({}) }),
    ...(deps.scoring_panel ? { scoring_panel: deps.scoring_panel } : {}),
  };

  const scores: Array<{ pair: [number, number]; score: number }> = [];
  for (const p of pairs()) {
    const remaining = [0, 1, 2, 3, 4, 5].filter((i) => i !== p[0] && i !== p[1]);
    const back: [number, number] = [remaining[0]!, remaining[1]!];
    const s = scorePair(team, p, back, scenario, calcCache, calcDeps);
    scores.push({ pair: p, score: s });
  }
  // Pick highest; tie-break by lower pair indices for determinism.
  scores.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.pair[0] !== b.pair[0]) return a.pair[0] - b.pair[0];
    return a.pair[1] - b.pair[1];
  });
  const best = scores[0]!;
  const bestPair = best.pair;
  const bestScore = best.score;

  // Backline = next-best 2 from remaining 4 by individual contribution.
  // We rank the remaining 4 by "usefulness" — using average score they
  // achieved across the 5 pairs containing them.
  const remaining = [0, 1, 2, 3, 4, 5].filter((i) => i !== bestPair[0] && i !== bestPair[1]);
  const remainingRanked = remaining.slice().sort((a, b) => {
    const avg = (idx: number): number => {
      const involving = scores.filter((s) => s.pair[0] === idx || s.pair[1] === idx);
      if (involving.length === 0) return 0;
      return involving.reduce((acc, s) => acc + s.score, 0) / involving.length;
    };
    const da = avg(a);
    const db = avg(b);
    if (db !== da) return db - da;
    return a - b;
  });
  const back: [number, number] = [remainingRanked[0]!, remainingRanked[1]!];
  const rejected: [number, number] = [remainingRanked[2]!, remainingRanked[3]!];

  // Collect the top-3 most-impactful damage calcs for the winning pair —
  // re-runs the same loop scorePair already issued, hits the cache, near-zero
  // marginal cost. Empty array when scoring inputs absent (test stubs).
  const keyCalcs: CalcResultRef[] = collectKeyCalcsForPair(
    bestPair,
    scenario,
    calcCache,
    calcDeps,
  );

  // Score margin = winner − second-best. Used by `pickConfidence` below.
  const secondScore = scores[1]?.score ?? bestScore;
  const margin = bestScore - secondScore;

  const lead0 = slotIds[bestPair[0]]!;
  const lead1 = slotIds[bestPair[1]]!;
  const reasoning = buildReasoning(lead0, lead1, scenario, keyCalcs, bestScore);

  const enriched: ScenarioOverview = {
    ...scenario,
    name: scenario.name ?? "scenario",
    type: scenario.type ?? "individual",
    field: scenario.field ?? {
      weather: "none",
      terrain: "none",
      trick_room: false,
      tailwind_ours: false,
      tailwind_theirs: false,
      light_screen: false,
      reflect: false,
      gravity: false,
    },
    opposing_preview: scenario.opposing_preview ?? ["incineroar"],
    recommended_leads: [lead0, lead1] as [string, string],
    recommended_backline: [slotIds[back[0]]!, slotIds[back[1]]!] as [string, string],
    rejected_bench: [slotIds[rejected[0]]!, slotIds[rejected[1]]!] as [string, string],
    reasoning,
    key_calcs: keyCalcs,
    citations: scenario.citations ?? [],
    pair_score: bestScore,
    confidence: pickConfidence({
      citationCount: (scenario.citations ?? []).length,
      keyCalcCount: keyCalcs.length,
      margin,
      pairScore: bestScore,
    }),
    description: scenario.description,
  };
  void deps;
  return enriched;
}

/**
 * Build a 1–3 sentence rationale from the winning pair + top calcs.
 *
 * Templates fold in:
 * - lead names + scenario name
 * - the strongest calc (attacker → defender, max-roll %)
 * - a hint about field state when notable (Sun/Rain/TR)
 *
 * Kept compact (≤ 400 chars) so `ScenarioOverviewSchema.reasoning` doesn't
 * truncate. Higher-fidelity narrative is the agent loop's job.
 */
function buildReasoning(
  lead0: string,
  lead1: string,
  scenario: ScenarioOverview,
  keyCalcs: ReadonlyArray<CalcResultRef>,
  pairScore: number,
): string {
  const fld = scenario.field;
  const weatherTag =
    fld?.trick_room ? " under Trick Room" :
    fld?.weather === "sun" ? " in Sun" :
    fld?.weather === "rain" ? " in Rain" :
    fld?.weather === "sand" ? " in Sand" :
    fld?.weather === "snow" ? " in Snow" : "";
  const top = keyCalcs[0];
  if (top !== undefined) {
    const koDesc = top.max_roll_pct >= 100 ? "OHKOs" : top.max_roll_pct >= 50 ? "knocks past 50%" : "lands";
    const second = keyCalcs[1];
    const second_clause = second
      ? ` ${capitalize(second.attacker_species_id)} ${koDesc} ${second.defender_species_id} (${second.max_roll_pct.toFixed(0)}% max).`
      : "";
    const out =
      `${capitalize(lead0)} + ${capitalize(lead1)} lead${weatherTag}: ` +
      `${capitalize(top.attacker_species_id)}'s ${top.move_id} ${koDesc} ${top.defender_species_id} ` +
      `(${top.max_roll_pct.toFixed(0)}% max).${second_clause} Pair score ${pairScore.toFixed(1)}.`;
    return out.length <= 400 ? out : out.slice(0, 397) + "…";
  }
  return `${capitalize(lead0)} + ${capitalize(lead1)} lead${weatherTag}; pair score ${pairScore.toFixed(1)}.`;
}

function capitalize(id: string): string {
  if (id.length === 0) return id;
  return id.charAt(0).toUpperCase() + id.slice(1).replace(/-([a-z])/g, (_, c: string) => "-" + c.toUpperCase());
}

/**
 * Compute a confidence signal for the agent loop.
 *
 * `"high"`: ≥ 2 citations AND ≥ 2 key calcs AND `pair_score` > 60 — strong
 *   citation backing AND a confident engine-driven pick.
 * `"low"`: 0 citations OR `pair_score` < 30 OR (margin between top and
 *   second-best pair < 1 AND key_calcs < 2). Agent should chain a
 *   `web_search` before quoting the pick.
 * `"medium"` otherwise.
 *
 * **When to use it:** computed inside `recommendLeads` from local signals.
 * Re-exported for `overview.ts` to recompute after citations attach (the
 * citation count is only known post-recommendLeads).
 */
export function pickConfidence(args: {
  citationCount: number;
  keyCalcCount: number;
  margin: number;
  pairScore: number;
}): "low" | "medium" | "high" {
  if (args.citationCount === 0) return "low";
  if (args.pairScore < 30) return "low";
  if (args.margin < 1 && args.keyCalcCount < 2) return "low";
  if (args.citationCount >= 2 && args.keyCalcCount >= 2 && args.pairScore > 60) return "high";
  return "medium";
}
