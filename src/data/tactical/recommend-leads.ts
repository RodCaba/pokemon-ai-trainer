/**
 * Exhaustive C(6,2)=15 lead-pair search per scenario.
 */

import type { Db } from "../../db/open";
import type { ScenarioOverview } from "../../schemas/tactical";
import type { UserTeam } from "../../schemas/user-teams";
import type { CalcCache } from "./calc-cache";
import type { ScoringTeam, ScoringPanel } from "./scoring-team";
import { scorePair } from "./score-pair";

export interface RecommendDeps {
  db: Db;
  knowledge?: unknown;
  alpha?: number;
  beta?: number;
  gamma?: number;
  scoring_team?: ScoringTeam;
  scoring_panel?: ScoringPanel;
}

const DEFAULT_SLOT_IDS: ReadonlyArray<string> = [
  "incineroar", "amoonguss", "rillaboom", "garchomp", "calyrex-shadow", "porygon2",
];

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
  const slotIds = teamSets && teamSets.length === 6
    ? teamSets.map((s, i) => s.species_roster_id ?? s.species_id ?? DEFAULT_SLOT_IDS[i] ?? `slot${i}`)
    : deps.scoring_team
      ? deps.scoring_team.sets.map((s, i) => s.species_roster_id ?? DEFAULT_SLOT_IDS[i] ?? `slot${i}`)
      : [...DEFAULT_SLOT_IDS];

  // Pad to 6 with placeholders so we always have 6 slots to choose from.
  while (slotIds.length < 6) slotIds.push(`slot${slotIds.length}`);

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
    recommended_leads: [slotIds[bestPair[0]]!, slotIds[bestPair[1]]!] as [string, string],
    recommended_backline: [slotIds[back[0]]!, slotIds[back[1]]!] as [string, string],
    rejected_bench: [slotIds[rejected[0]]!, slotIds[rejected[1]]!] as [string, string],
    reasoning: scenario.reasoning ?? "Lead pair maximizes pair score per Q6 binding.",
    key_calcs: scenario.key_calcs ?? [],
    citations: scenario.citations ?? [],
    pair_score: bestScore,
  };
  void deps;
  return enriched;
}
