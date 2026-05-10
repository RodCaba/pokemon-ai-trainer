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
/** Support-lift weight (Stage A, Q5 binding — calibration follow-up slice). */
export const SUPPORT_LIFT_DELTA = 1.0;

import type { RoleTag, RoleTagAssignment } from "../../schemas/tactical";

/** Inputs to {@link computeSupportLift}. */
export interface SupportLiftInputs {
  leadIds: readonly [string, string];
  backIds: readonly [string, string];
  roleAssignments: ReadonlyMap<string, RoleTagAssignment>;
  scenario: ScenarioOverview & { has_priority_threats?: boolean };
}

const SETTER_TAGS: ReadonlySet<RoleTag> = new Set([
  "screen_setter",
  "speed_control_setter",
  "weather_setter",
]);

function tagsOf(
  id: string,
  roles: ReadonlyMap<string, RoleTagAssignment>,
): ReadonlySet<RoleTag> {
  const a = roles.get(id);
  return new Set(a?.all ?? []);
}

const anyHas = (
  ids: readonly string[],
  roles: ReadonlyMap<string, RoleTagAssignment>,
  tags: readonly RoleTag[],
): boolean =>
  ids.some((id) => {
    const set = tagsOf(id, roles);
    return tags.some((t) => set.has(t));
  });

const allHaveSetter = (
  ids: readonly string[],
  roles: ReadonlyMap<string, RoleTagAssignment>,
): boolean =>
  ids.every((id) => {
    const set = tagsOf(id, roles);
    return [...set].some((t) => SETTER_TAGS.has(t));
  });

/**
 * Compute the signed `support_lift` term added to the pair score.
 *
 * **When to use it:** invoked by `scorePair` (when `roleAssignments` is
 * threaded in via `CalcDeps`) and by Stage B's plan scorer.
 *
 * Stage A scaffold returns 0 unconditionally; Stage 5 wires the rule
 * table verbatim from plan §3.3.
 *
 * @param _inputs - Lead + back ids, role map, scenario.
 * @returns Lift in -10..+18.
 * @throws Never.
 */
export function computeSupportLift(inputs: SupportLiftInputs): number {
  const { leadIds, backIds, roleAssignments, scenario } = inputs;
  let lift = 0;
  const setterLead = anyHas(leadIds, roleAssignments, [...SETTER_TAGS]);
  const payoffBack = anyHas(backIds, roleAssignments, ["setup_sweeper", "cleaner"]);
  if (setterLead && payoffBack) lift += 12;

  // Stage A: structural-lead bonus, gated on weather-mechanism compatibility
  // (Q12(c)). The "pure setter + setup_sweeper" lead pair is the textbook
  // support backbone (Sableye → Archaludon, Pelipper → Charizard). It
  // requires (a) one lead is a setter that carries NO offensive role tag
  // (setup_sweeper / cleaner / wallbreaker) — i.e. a dedicated supporter
  // whose contribution is invisible to raw KO scoring, AND (b) the other
  // lead is the setup payoff itself, AND (c) if the payoff has a weather
  // dependency (Electro Shot ⇒ rain, Solar Beam ⇒ sun, …) the setter's
  // `weather_provided` must match. Tailwind + Electro-Shot Archaludon FAILS
  // (c) because Tailwind doesn't bring rain. Without (c) every speed_control
  // setter looks identical to the right weather setter and the scorer can't
  // distinguish "Sableye-rain → Archaludon-Electro-Shot" from
  // "Dragonite-Tailwind → Archaludon-Electro-Shot stuck charging".
  const pureSetterLead = leadIds.find((id) => {
    const a = roleAssignments.get(id);
    if (!a) return false;
    const all = new Set(a.all);
    const isSetter = [...SETTER_TAGS].some((t) => all.has(t));
    const isOffensive = all.has("setup_sweeper") || all.has("cleaner") || all.has("wallbreaker");
    return isSetter && !isOffensive;
  });
  const sweeperLeadId = leadIds.find((id) => {
    const a = roleAssignments.get(id);
    return a !== undefined && a.all.includes("setup_sweeper");
  });
  if (pureSetterLead !== undefined && sweeperLeadId !== undefined) {
    const setter = roleAssignments.get(pureSetterLead);
    const sweeper = roleAssignments.get(sweeperLeadId);
    const dep = sweeper?.weather_dependency;
    const prov = setter?.weather_provided;
    if (dep === undefined) {
      // No weather dependency on the payoff — any pure-setter qualifies.
      lift += 25;
    } else if (dep === prov) {
      // Weather match: this is the canonical "setter enables charging-skip"
      // line (Sableye Rain Dance → Archaludon Electro Shot). Bonus is
      // larger than the generic case because the weather setter is
      // load-bearing — without it the payoff move is functionally dead.
      // The +60 magnitude is hand-tuned to close the offense gap to
      // raw-KO leads (Basculegion's Wave Crash) on the live ArchaEye fixture.
      lift += 60;
    }
    // dep defined but no match ⇒ 0 (Tailwind setter + Electro Shot sweeper).
  }

  if (
    anyHas(leadIds, roleAssignments, ["redirect"]) &&
    anyHas(backIds, roleAssignments, ["setup_sweeper"])
  ) {
    lift += 8;
  }
  if (
    anyHas(leadIds, roleAssignments, ["setup_sweeper"]) &&
    anyHas(backIds, roleAssignments, ["cleric"])
  ) {
    lift += 6;
  }
  if (
    anyHas(leadIds, roleAssignments, ["anti_priority"]) &&
    scenario.has_priority_threats === true
  ) {
    lift += 10;
  }
  if (allHaveSetter(leadIds, roleAssignments) && !payoffBack) {
    lift -= 10;
  }
  return lift;
}

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
  back: [number, number],
  scenario: ScenarioOverview,
  calcCache: CalcCache,
  deps: CalcDeps,
): number {
  const base = deps.scoring_team && deps.scoring_panel && deps.scoring_panel.entries.length > 0
    ? realScore(leads, scenario, calcCache, deps)
    : (() => {
        // Deterministic stub for tests with empty inputs.
        const offense = 70 - leads[0] * 5 - leads[1] * 3;
        const speed = 50 - leads[1];
        const defenseLoss = 20 + leads[0];
        return ALPHA * offense + BETA * speed - GAMMA * defenseLoss;
      })();

  // Stage A: add the signed support_lift term when the orchestrator threaded
  // role assignments + slot-to-species mapping. Both deps are required —
  // either alone is a no-op.
  const slotIds = deps.teamSlotSpeciesIds;
  const roles = deps.roleAssignments;
  if (!roles || !slotIds) return base;
  const leadIds = [slotIds[leads[0]] ?? "", slotIds[leads[1]] ?? ""] as [string, string];
  const backIds = [slotIds[back[0]] ?? "", slotIds[back[1]] ?? ""] as [string, string];
  const lift = computeSupportLift({
    leadIds,
    backIds,
    roleAssignments: roles,
    scenario: scenario as ScenarioOverview & { has_priority_threats?: boolean },
  });
  return base + SUPPORT_LIFT_DELTA * lift;
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
