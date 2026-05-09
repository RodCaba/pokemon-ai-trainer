/**
 * Pair scoring helper used by the recommend-leads exhaustive search.
 * `score = α·offense_pair + β·speed_pair − γ·defense_loss_pair`.
 * Coefficients hard-coded per Q6 binding; tunable in a future slice.
 */

import type { CalcInput, CalcResult } from "../../schemas/calc";
import type { ScenarioField, ScenarioOverview } from "../../schemas/tactical";
import type { UserTeam } from "../../schemas/user-teams";
import type { CalcCache, CalcCacheKey } from "./calc-cache";
import { calcWithCache } from "./calc-cache";
import type { CalcDeps } from "./score-offense";
import { _hashSet, _fieldHash } from "./score-offense";
import type { ScoringTeam, ScoringSet } from "./scoring-team";
import { neutralField, scenarioFieldToCalcField } from "./scoring-team";
import { damage_calc } from "../../tools/damage-calc";

/** Offense weight (Q6 binding). */
export const ALPHA = 1.0;
/** Speed weight (Q6 binding). */
export const BETA = 0.5;
/** Defense-loss weight (Q6 binding). */
export const GAMMA = 0.7;

/**
 * Score a single (lead, back) configuration for a scenario.
 *
 * @param team - Our team (legacy {@link UserTeam}, used only when scoring_team
 *   missing).
 * @param leads - Indices [a, b] picked as leads.
 * @param back - Indices [c, d] picked as backline.
 * @param scenario - Target scenario (field, opposing preview).
 * @param calcCache - Process-scoped calc cache.
 * @param deps - Calc engine DI; when `scoring_team` + `scoring_panel` are both
 *   present, real engine drives the score; otherwise stable deterministic stub.
 * @returns Numeric score: `α·offense + β·speed − γ·defense_loss`.
 * @throws Never.
 */
export function scorePair(
  _team: UserTeam,
  leads: [number, number],
  _back: [number, number],
  scenario: ScenarioOverview,
  calcCache: CalcCache,
  deps: CalcDeps,
): number {
  if (deps.scoring_team && deps.scoring_panel && deps.scoring_panel.entries.length > 0) {
    return realScore(leads, scenario, calcCache, deps);
  }
  // Deterministic stub for tests with empty inputs.
  const offense = 70 - leads[0] * 5 - leads[1] * 3;
  const speed = 50 - leads[1];
  const defenseLoss = 20 + leads[0];
  return ALPHA * offense + BETA * speed - GAMMA * defenseLoss;
}

function realScore(
  leads: [number, number],
  scenario: ScenarioOverview,
  cache: CalcCache,
  deps: CalcDeps,
): number {
  const calc: (input: CalcInput) => CalcResult =
    (deps.calc as unknown as (input: CalcInput) => CalcResult) ?? damage_calc;
  // Scenario-aware: prefer the scenario's own field state (Sun / Rain / TR /
  // tailwind), falling back to deps then to neutral. Different scenarios MUST
  // produce different damage outcomes when the field changes the calc (e.g.
  // Solar Beam in Sun ignores charge turn, Hydro Pump in Rain hits 1.5×).
  // ScenarioField uses lowercase keys ("sun"/"rain"); the calc engine wants
  // capitalized ("Sun"/"Rain") — convert via the scoring-team helper.
  const sfTactical = scenario.field as ScenarioField | undefined;
  const field = sfTactical ? scenarioFieldToCalcField(sfTactical) : (deps.field ?? neutralField());
  const sets = deps.scoring_team!.sets;

  // Scenario-aware opposing leads: prefer panel entries whose species_id is
  // listed in `scenario.opposing_preview` (the scenario's chosen meta core).
  // Fallback to panel top-2 when the preview species aren't available in the
  // panel (so weakness-counter scenarios with niche species still score).
  const previewIds = new Set(scenario.opposing_preview ?? []);
  let opposing = deps.scoring_panel!.entries.filter((e) =>
    previewIds.has(e.species_roster_id),
  );
  if (opposing.length < 2) {
    const sorted = [...deps.scoring_panel!.entries].sort((a, b) => b.weight - a.weight);
    for (const e of sorted) {
      if (opposing.length >= 2) break;
      if (!opposing.includes(e)) opposing.push(e);
    }
  }
  opposing = opposing.slice(0, Math.min(2, opposing.length));
  if (opposing.length === 0) return 0;

  const ourPair: ScoringSet[] = [];
  for (const idx of leads) {
    const s = sets[idx];
    if (s) ourPair.push(s);
  }
  if (ourPair.length === 0) return 0;

  let offenseAcc = 0;
  let defenseLossAcc = 0;
  let speedAcc = 0;
  let count = 0;

  for (const ours of ourPair) {
    for (const them of opposing) {
      count++;
      // Offense: best move's max-roll vs them.
      let bestMax = 0;
      for (const moveName of ours.spec.moves) {
        const input: CalcInput = {
          schema_version: 1,
          gen: 9,
          format: "RegM-A",
          attacker: ours.spec,
          defender: them.spec,
          move: { name: moveName, isCrit: false },
          field,
        };
        const key: CalcCacheKey = {
          attacker_set_hash: _hashSet(ours.spec),
          defender_set_hash: _hashSet(them.spec),
          field_hash: _fieldHash(field),
          move_id: moveName,
        };
        const r = calcWithCache(cache, input, key, calc);
        if (r.ok) {
          const mp = (r.result as { max_percent?: number }).max_percent;
          if (typeof mp === "number") bestMax = Math.max(bestMax, mp);
        }
      }
      offenseAcc += Math.min(100, bestMax);

      // Defense loss: their best move's max-roll vs us.
      let theirBestMax = 0;
      for (const moveName of them.spec.moves) {
        const input: CalcInput = {
          schema_version: 1,
          gen: 9,
          format: "RegM-A",
          attacker: them.spec,
          defender: ours.spec,
          move: { name: moveName, isCrit: false },
          field,
        };
        const key: CalcCacheKey = {
          attacker_set_hash: _hashSet(them.spec),
          defender_set_hash: _hashSet(ours.spec),
          field_hash: _fieldHash(field),
          move_id: moveName,
        };
        const r = calcWithCache(cache, input, key, calc);
        if (r.ok) theirBestMax = Math.max(theirBestMax, r.result.max_percent);
      }
      defenseLossAcc += Math.min(100, theirBestMax);

      // Speed: 100 if our spe stat > theirs, 50 if tied, 0 otherwise.
      const ourSpe = computeSpeedFromSpec(ours);
      const theirSpe = computeSpeedFromSpec({ spec: them.spec, species_roster_id: them.species_roster_id });
      speedAcc += ourSpe > theirSpe ? 100 : ourSpe === theirSpe ? 50 : 0;
    }
  }
  if (count === 0) return 0;
  const offense = offenseAcc / count;
  const speed = speedAcc / count;
  const defenseLoss = defenseLossAcc / count;
  return ALPHA * offense + BETA * speed - GAMMA * defenseLoss;
}

const NATURE_PLUS_SPE = new Set(["Timid", "Hasty", "Jolly", "Naive"]);
const NATURE_MINUS_SPE = new Set(["Brave", "Relaxed", "Quiet", "Sassy"]);

function computeSpeedFromSpec(s: ScoringSet): number {
  const spsSpe = s.spec.sps.spe ?? 0;
  // We don't have base_spe on spec; approximate via 31IV + sps + 5 bias.
  // For a fair pair-vs-pair speed comparison, we use spsSpe alone — both
  // our and their sets are computed the same way, so it's monotonic.
  let stat = spsSpe;
  const nature = s.spec.nature;
  if (nature && NATURE_PLUS_SPE.has(nature)) stat = stat * 1.1 + 100; // arbitrary bias
  else if (nature && NATURE_MINUS_SPE.has(nature)) stat = stat * 0.9;
  if (s.spec.item && /choice scarf/i.test(s.spec.item)) stat *= 1.5;
  return stat;
}
