/**
 * Pair scoring helper used by the recommend-leads exhaustive search.
 * `score = α·offense_pair + β·speed_pair − γ·defense_loss_pair`.
 * Coefficients hard-coded per Q6 binding; tunable in a future slice.
 */

import type { CalcInput, CalcResult } from "../../schemas/calc";
import type { CalcResultRef, ScenarioField, ScenarioOverview } from "../../schemas/tactical";
import type { UserTeam } from "../../schemas/user-teams";
import type { CalcCache, CalcCacheKey } from "./calc-cache";
import { calcWithCache } from "./calc-cache";
import type { CalcDeps } from "./score-offense";
import { _hashSet, _fieldHash } from "./score-offense";
import type { ScoringTeam, ScoringSet, ScoringThreat } from "./scoring-team";
import { neutralField, scenarioFieldToCalcField, labmausConsensusToScoringThreat } from "./scoring-team";
import type { Db } from "../../db/open";

/**
 * Resolve scenario opposing leads into ScoringThreats. For each species
 * named in `previewIds`: prefer the panel entry (has weight + co-occur
 * data); otherwise materialize from labmaus team_sets via consensus.
 * If still missing (no labmaus data either), the species is dropped —
 * caller falls back to panel top-2.
 */
function resolveOpposing(
  previewIds: ReadonlyArray<string>,
  panelEntries: ReadonlyArray<ScoringThreat>,
  db: Db | undefined,
): ScoringThreat[] {
  const out: ScoringThreat[] = [];
  for (const id of previewIds) {
    const inPanel = panelEntries.find((e) => e.species_roster_id === id);
    if (inPanel) {
      out.push(inPanel);
      continue;
    }
    if (db) {
      const fromLabmaus = labmausConsensusToScoringThreat(db, id);
      if (fromLabmaus) {
        out.push(fromLabmaus);
        continue;
      }
    }
    // Drop silently — caller may fill from panel top-2.
  }
  return out;
}
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

  // Scenario-aware opposing leads: resolve scenario.opposing_preview
  // species in this order — (a) panel entry, (b) labmaus team_sets
  // consensus (via `deps.db`), (c) drop. Fallback to panel top-2 only
  // when the scenario specifies fewer than 2 resolvable opposing leads.
  // This makes "Rain" (vs pelipper+archaludon) score against ACTUAL
  // Pelipper/Archaludon, not the panel's top-by-weight.
  const previewIds = scenario.opposing_preview ?? [];
  let opposing = resolveOpposing(previewIds, deps.scoring_panel!.entries, deps.db);
  if (opposing.length < 2) {
    const sorted = [...deps.scoring_panel!.entries].sort((a, b) => b.weight - a.weight);
    for (const e of sorted) {
      if (opposing.length >= 2) break;
      if (!opposing.find((o) => o.species_roster_id === e.species_roster_id)) {
        opposing.push(e);
      }
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

/**
 * Collect the top-3 most-impactful damage calcs for a given lead pair under
 * the scenario's field state. Used to populate `ScenarioOverview.key_calcs`
 * after recommend-leads picks the winning pair. Cache makes this near-free
 * because the same calls were already issued during scoring.
 *
 * **When to use it:** the recommend-leads orchestrator calls this once for
 * the top-scoring pair to attach evidence; do NOT call it inside the per-pair
 * scoring loop (would 15× the work).
 *
 * @param leads — Indices [a, b] of the chosen leads on `deps.scoring_team`.
 * @param scenario — Source of `field` + `opposing_preview`.
 * @param cache — Process-scoped calc cache (Q3 binding).
 * @param deps — Calc engine DI.
 * @returns Up to 3 {@link CalcResultRef}s, sorted by `max_roll_pct` desc.
 *   Empty array when no `damage_calc` ran cleanly.
 * @throws Never — engine throws are trapped per-call.
 */
export function collectKeyCalcsForPair(
  leads: [number, number],
  scenario: ScenarioOverview,
  cache: CalcCache,
  deps: CalcDeps,
): CalcResultRef[] {
  if (!deps.scoring_team || !deps.scoring_panel || deps.scoring_panel.entries.length === 0) {
    return [];
  }
  const calc: (input: CalcInput) => CalcResult =
    (deps.calc as unknown as (input: CalcInput) => CalcResult) ?? damage_calc;
  const sfTactical = scenario.field as ScenarioField | undefined;
  const field = sfTactical ? scenarioFieldToCalcField(sfTactical) : (deps.field ?? neutralField());
  const fieldSummary = `${field.weather}|${field.terrain}|${field.isTrickRoom ? "TR" : "-"}`;
  // Same scenario-aware resolution as scorePair — panel → labmaus → top-2.
  const previewIds = scenario.opposing_preview ?? [];
  let opposing = resolveOpposing(previewIds, deps.scoring_panel.entries, deps.db);
  if (opposing.length < 2) {
    const sorted = [...deps.scoring_panel.entries].sort((a, b) => b.weight - a.weight);
    for (const e of sorted) {
      if (opposing.length >= 2) break;
      if (!opposing.find((o) => o.species_roster_id === e.species_roster_id)) {
        opposing.push(e);
      }
    }
  }
  opposing = opposing.slice(0, Math.min(2, opposing.length));
  const ourPair = leads
    .map((idx) => deps.scoring_team!.sets[idx])
    .filter((s): s is ScoringSet => Boolean(s));

  const refs: CalcResultRef[] = [];
  for (const ours of ourPair) {
    for (const them of opposing) {
      // Best of 4 moves for this attacker/defender pairing.
      let best: { move: string; max: number; ko: number } | null = null;
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
        if (!r.ok) continue;
        const mp = (r.result as { max_percent?: number; ko_chance?: { chance?: number } }).max_percent;
        const ko = (r.result as { ko_chance?: { chance?: number } }).ko_chance?.chance ?? 0;
        if (typeof mp !== "number") continue;
        if (!best || mp > best.max) best = { move: moveName, max: mp, ko };
      }
      if (best) {
        refs.push({
          attacker_species_id: ours.species_roster_id,
          defender_species_id: them.species_roster_id,
          move_id: best.move,
          max_roll_pct: best.max,
          ko_chance_desc:
            best.ko >= 1 ? "guaranteed OHKO" : best.ko >= 0.5 ? "high OHKO chance" : best.ko > 0 ? "possible OHKO" : "no OHKO",
          field_summary: fieldSummary,
        });
      }
    }
  }
  return refs.sort((a, b) => b.max_roll_pct - a.max_roll_pct).slice(0, 3);
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
