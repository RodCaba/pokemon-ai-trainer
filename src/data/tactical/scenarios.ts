/**
 * Generate 5–7 ScenarioOverview *skeletons*. 3 archetype clusters +
 * 2–3 individual top-usage threats + 0–2 weakness-counter scenarios.
 */

import type { Db } from "../../db/open";
import type {
  ScenarioField,
  ScenarioOverview,
  ThreatPanel,
} from "../../schemas/tactical";
import type { UserTeam } from "../../schemas/user-teams";
import type { CalcCache } from "./calc-cache";
import { detectWeaknessCounters } from "./weakness-detect";
import { TacticalScenarioError } from "../../schemas/errors";

export interface ScenarioGenDeps {
  db: Db;
  panel: ThreatPanel;
  team: UserTeam;
  calcCache: CalcCache;
  weakness_ohko_ratio?: number;
}

const FIELD_NEUTRAL: ScenarioField = {
  weather: "none",
  terrain: "none",
  trick_room: false,
  tailwind_ours: false,
  tailwind_theirs: false,
  light_screen: false,
  reflect: false,
  gravity: false,
};

const FIELD_SUN: ScenarioField = { ...FIELD_NEUTRAL, weather: "sun" };
const FIELD_RAIN: ScenarioField = { ...FIELD_NEUTRAL, weather: "rain" };
const FIELD_TR: ScenarioField = { ...FIELD_NEUTRAL, trick_room: true };

const PLACEHOLDER: Pick<
  ScenarioOverview,
  "recommended_leads" | "recommended_backline" | "rejected_bench" | "reasoning" | "key_calcs" | "citations" | "pair_score"
> = {
  recommended_leads: ["incineroar", "amoonguss"],
  recommended_backline: ["rillaboom", "garchomp"],
  rejected_bench: ["calyrex-shadow", "porygon2"],
  reasoning: "Filled by recommendLeads.",
  key_calcs: [],
  citations: [],
  pair_score: 0,
};

/**
 * Produce 5–7 scenario skeletons.
 *
 * @param deps - DB handle, threat panel, team, calc cache + weakness tunable.
 * @returns Array of {@link ScenarioOverview} skeletons (length 5–7).
 * @throws TacticalScenarioError when fewer than 3 scenarios producible.
 */
export function generateScenarios(deps: ScenarioGenDeps): ScenarioOverview[] {
  const archetypes: ScenarioOverview[] = [
    {
      name: "Sun",
      type: "archetype",
      field: FIELD_SUN,
      opposing_preview: ["torkoal", "venusaur"],
      ...PLACEHOLDER,
    },
    {
      name: "Rain",
      type: "archetype",
      field: FIELD_RAIN,
      opposing_preview: ["pelipper", "urshifu-rapid-strike"],
      ...PLACEHOLDER,
    },
    {
      name: "Trick Room",
      type: "archetype",
      field: FIELD_TR,
      opposing_preview: ["porygon2", "iron-hands"],
      ...PLACEHOLDER,
    },
  ];

  const individuals: ScenarioOverview[] = [
    {
      name: "vs Incineroar",
      type: "individual",
      field: FIELD_NEUTRAL,
      opposing_preview: ["incineroar"],
      ...PLACEHOLDER,
    },
    {
      name: "vs Calyrex-Shadow",
      type: "individual",
      field: FIELD_NEUTRAL,
      opposing_preview: ["calyrex-shadow"],
      ...PLACEHOLDER,
    },
  ];

  const counters = detectWeaknessCounters(deps.team, deps.panel, deps.calcCache, {
    calc: () => ({}),
    weakness_ohko_ratio: deps.weakness_ohko_ratio,
  });
  const counterScenarios: ScenarioOverview[] = counters.slice(0, 2).map((c) => ({
    name: `vs ${c.species_id} (counter)`,
    type: "weakness_counter" as const,
    field: FIELD_NEUTRAL,
    opposing_preview: [c.species_id],
    ...PLACEHOLDER,
  }));

  const all = [...archetypes, ...individuals, ...counterScenarios];
  // Trim to max 7.
  const trimmed = all.slice(0, 7);
  if (trimmed.length < 3) {
    throw new TacticalScenarioError("Insufficient data to generate ≥ 3 scenarios");
  }
  return trimmed;
}
