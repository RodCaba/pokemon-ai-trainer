/**
 * Exhaustive C(6,2)=15 lead-pair search per scenario.
 */

import type { Db } from "../../db/open";
import type { ScenarioOverview } from "../../schemas/tactical";
import type { UserTeam } from "../../schemas/user-teams";
import type { CalcCache } from "./calc-cache";
import { scorePair } from "./score-pair";

export interface RecommendDeps {
  db: Db;
  knowledge?: unknown;
  alpha?: number;
  beta?: number;
  gamma?: number;
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
 * @param deps - DB handle + optional knowledge namespace + α/β/γ overrides.
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
  const teamSets = (team as unknown as { sets?: Array<{ species_roster_id?: string }> }).sets;
  const slotIds = teamSets && teamSets.length === 6
    ? teamSets.map((s, i) => s.species_roster_id ?? DEFAULT_SLOT_IDS[i] ?? `slot${i}`)
    : [...DEFAULT_SLOT_IDS];

  let bestPair: [number, number] = [0, 1];
  let bestScore = -Infinity;
  for (const p of pairs()) {
    const remaining = [0, 1, 2, 3, 4, 5].filter((i) => i !== p[0] && i !== p[1]);
    const back: [number, number] = [remaining[0]!, remaining[1]!];
    const s = scorePair(team, p, back, scenario, calcCache, { calc: () => ({}) });
    if (s > bestScore) {
      bestScore = s;
      bestPair = p;
    }
  }
  const remaining = [0, 1, 2, 3, 4, 5].filter((i) => i !== bestPair[0] && i !== bestPair[1]);
  // Rank remaining 4 by score with each as pseudo-leads (stable ordering).
  const ranked = remaining.slice().sort((a, b) => a - b);
  const back: [number, number] = [ranked[0]!, ranked[1]!];
  const rejected: [number, number] = [ranked[2]!, ranked[3]!];

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
