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
import type { ScoringTeam } from "./scoring-team";

export interface ScenarioGenDeps {
  db: Db;
  panel: ThreatPanel;
  team: UserTeam;
  calcCache: CalcCache;
  weakness_ohko_ratio?: number;
  /** Scoring team for engine-driven weakness detection (Stage 7). */
  scoring_team?: ScoringTeam;
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
  rejected_bench: ["porygon2", "pelipper"],
  reasoning: "Filled by recommendLeads.",
  key_calcs: [],
  citations: [],
  pair_score: 0,
};

/**
 * Author a scenario `description` (1–2 paragraphs, ≤ 800 chars) explaining
 * what the scenario tests and why it matters in Reg M-A. Plain text; no
 * markdown headers (the consumer picks formatting). Kept deterministic
 * (templated, not AI-generated) so re-runs produce identical output.
 */
function describeScenario(
  name: string,
  type: "archetype" | "individual" | "weakness_counter",
  field: ScenarioField,
  opposing_preview: ReadonlyArray<string>,
): string {
  const oppList = opposing_preview.slice(0, 3).join(", ");
  if (type === "archetype") {
    if (field.weather === "sun") {
      return (
        "Sun archetype scenario. Sun-setting cores typically pair a Drought/Drought-substitute setter (Torkoal, Ninetales) with sun-abusing hitters that benefit from 1.5× Fire damage and Solar Beam without a charge turn. " +
        `The recommended leads are scored against representative sun-side leads (${oppList || "Torkoal, Venusaur"}). Field is sun, weather damage applies, Solar Beam fires immediately. Bring leads that can break the setter on turn 1 or that ignore the sun bonus.`
      );
    }
    if (field.weather === "rain") {
      return (
        "Rain archetype scenario. Rain teams pair a Drizzle setter (Pelipper) with Swift Swim / Hydration sweepers that benefit from 1.5× Water damage and 100%-accurate Hurricane / Thunder. " +
        `Recommended leads are scored against representative rain-side leads (${oppList || "Pelipper, Barraskewda"}). Field is rain. Bring leads that pressure the setter or that resist the rain-boosted Water/Electric attacks; Choice Scarf users are especially valuable to win speed once swimmers double.`
      );
    }
    if (field.trick_room) {
      return (
        "Trick Room archetype scenario. TR teams flip the speed order — slow attackers (base spe < 60) move first while fast Pokémon move last, for the 5 turns TR is active. " +
        `Recommended leads are scored against typical TR-side leads (${oppList || "Porygon2, Farigiraf"}). Field has Trick Room active. Bring leads that can KO the setter before it sets up, or that thrive in inverted speed (your slowest hitters become priority threats while their fast attackers are stranded).`
      );
    }
    return (
      `Archetype scenario "${name}". Tests how the team holds up against representative meta-core opposing leads (${oppList}). Use the recommended leads as a default opener; the backline pair covers second-pivots after one or both leads has answered the immediate threat.`
    );
  }
  if (type === "weakness_counter") {
    return (
      `Weakness-counter scenario. The detector flagged ${oppList || "an unnamed niche threat"} as a species that OHKOs ≥ 50% of your team's slots — a structural hole worth a contingency plan. ` +
      `The recommended leads are the team's best answer to this specific threat: typically a fast attacker that can KO before the threat moves, plus a teammate that absorbs a hit. Treat this scenario as a build-time signal: if you can't comfortably address it, consider swapping a slot.`
    );
  }
  // individual
  return (
    `Specific-opponent scenario versus ${oppList || "an individual top-usage threat"}. Tests the team's response when the opponent leads or threatens to bring this exact mon. The recommended leads optimize the matchup against this single species; the backline pair covers follow-up turns where the threat may switch out or be replaced.`
  );
}

/** Threat panel entry shape we read for archetype filtering — duck-typed
 *  so the function still works with `{}`-shaped test fixtures. */
type PanelEntryLike = {
  species_id?: string;
  set?: { ability?: string; moves?: ReadonlyArray<string>; item?: string };
};

/**
 * Pick the first N species ids from the threat panel; falls back to a small
 * Reg-M-A-legal seed when the panel is empty (test paths). Memory
 * `regulation_m_a_roster.md`: never hardcode SV/VGC species like
 * urshifu-rapid-strike, calyrex-shadow, iron-hands.
 *
 * @param panel — The curated threat panel.
 * @param n — Max ids to return.
 * @param seed — Fallback ids when the panel doesn't yield enough.
 * @param accept — Optional predicate to filter panel entries (e.g. "Drizzle
 *   ability for Rain"). When set, panel entries that fail the predicate
 *   are skipped before the seed is consulted.
 */
function previewFromPanel(
  panel: ThreatPanel,
  n: number,
  seed: ReadonlyArray<string>,
  accept?: (entry: PanelEntryLike) => boolean,
): string[] {
  const out: string[] = [];
  const entries = (panel as { entries?: ReadonlyArray<PanelEntryLike> }).entries ?? [];
  for (const e of entries) {
    if (!e.species_id) continue;
    if (accept && !accept(e)) continue;
    out.push(e.species_id);
    if (out.length >= n) break;
  }
  for (const s of seed) {
    if (out.length >= n) break;
    if (!out.includes(s)) out.push(s);
  }
  return out.slice(0, n);
}

const SUN_ABILITIES = new Set(["Drought", "Orichalcum Pulse"]);
const SUN_BENEFICIARIES = new Set(["Chlorophyll", "Solar Power", "Flower Gift"]);
const RAIN_ABILITIES = new Set(["Drizzle", "Primordial Sea"]);
const RAIN_BENEFICIARIES = new Set(["Swift Swim", "Rain Dish", "Hydration", "Dry Skin"]);
const SAND_ABILITIES = new Set(["Sand Stream", "Sand Spit"]);
const SAND_BENEFICIARIES = new Set(["Sand Rush", "Sand Force", "Sand Veil"]);
const SNOW_ABILITIES = new Set(["Snow Warning"]);
const SNOW_BENEFICIARIES = new Set(["Slush Rush", "Snow Cloak", "Ice Body"]);

function fitsArchetype(
  entry: PanelEntryLike,
  setterAbilities: ReadonlySet<string>,
  beneficiaryAbilities: ReadonlySet<string>,
): boolean {
  const a = entry.set?.ability ?? "";
  return setterAbilities.has(a) || beneficiaryAbilities.has(a);
}

function fitsTrickRoom(entry: PanelEntryLike): boolean {
  const moves = entry.set?.moves ?? [];
  return moves.some(
    (m) => m.toLowerCase().replace(/[^a-z]/g, "") === "trickroom",
  );
}

/**
 * Produce 5–7 scenario skeletons.
 *
 * @param deps - DB handle, threat panel, team, calc cache + weakness tunable.
 * @returns Array of {@link ScenarioOverview} skeletons (length 5–7).
 * @throws TacticalScenarioError when fewer than 3 scenarios producible.
 */
export function generateScenarios(deps: ScenarioGenDeps): ScenarioOverview[] {
  // Archetype previews: filter panel entries by ability / move signal so
  // a Rain scenario surfaces Pelipper-shaped opponents (not the meta's
  // most-popular mons regardless of weather). Falls back to the seed when
  // no panel entry fits — keeps the scenario defensible on a thin panel.
  const sunSeed = previewFromPanel(
    deps.panel,
    2,
    ["torkoal", "venusaur"],
    (e) => fitsArchetype(e, SUN_ABILITIES, SUN_BENEFICIARIES),
  );
  const rainSeed = previewFromPanel(
    deps.panel,
    2,
    ["pelipper", "barraskewda"],
    (e) => fitsArchetype(e, RAIN_ABILITIES, RAIN_BENEFICIARIES),
  );
  const trSeed = previewFromPanel(
    deps.panel,
    2,
    ["porygon2", "farigiraf"],
    fitsTrickRoom,
  );
  // Individual scenarios: top-usage mons, no archetype filter (we want the
  // most popular threats regardless of style).
  const indivSeed = previewFromPanel(deps.panel, 4, [
    "incineroar", "amoonguss", "rillaboom", "garchomp",
  ]);
  // Always emit two distinct individual scenarios (or fall back to the seed).
  const indiv1 = indivSeed[0] ?? "incineroar";
  const indiv2 = indivSeed[1] ?? "amoonguss";

  const archetypes: ScenarioOverview[] = [
    {
      name: "Sun",
      type: "archetype",
      field: FIELD_SUN,
      opposing_preview: sunSeed,
      description: describeScenario("Sun", "archetype", FIELD_SUN, sunSeed),
      ...PLACEHOLDER,
    },
    {
      name: "Rain",
      type: "archetype",
      field: FIELD_RAIN,
      opposing_preview: rainSeed,
      description: describeScenario("Rain", "archetype", FIELD_RAIN, rainSeed),
      ...PLACEHOLDER,
    },
    {
      name: "Trick Room",
      type: "archetype",
      field: FIELD_TR,
      opposing_preview: trSeed,
      description: describeScenario("Trick Room", "archetype", FIELD_TR, trSeed),
      ...PLACEHOLDER,
    },
  ];

  const individuals: ScenarioOverview[] = [
    {
      name: `vs ${indiv1}`,
      type: "individual",
      field: FIELD_NEUTRAL,
      opposing_preview: [indiv1],
      description: describeScenario(`vs ${indiv1}`, "individual", FIELD_NEUTRAL, [indiv1]),
      ...PLACEHOLDER,
    },
    {
      name: `vs ${indiv2}`,
      type: "individual",
      field: FIELD_NEUTRAL,
      opposing_preview: [indiv2],
      description: describeScenario(`vs ${indiv2}`, "individual", FIELD_NEUTRAL, [indiv2]),
      ...PLACEHOLDER,
    },
  ];

  const counters = detectWeaknessCounters(deps.team, deps.panel, deps.calcCache, {
    db: deps.db,
    scoring_team: deps.scoring_team,
    weakness_ohko_ratio: deps.weakness_ohko_ratio,
  });
  const counterScenarios: ScenarioOverview[] = counters.slice(0, 2).map((c) => ({
    name: `vs ${c.species_id} (counter)`,
    type: "weakness_counter" as const,
    field: FIELD_NEUTRAL,
    opposing_preview: [c.species_id],
    description: describeScenario(
      `vs ${c.species_id} (counter)`,
      "weakness_counter",
      FIELD_NEUTRAL,
      [c.species_id],
    ),
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
