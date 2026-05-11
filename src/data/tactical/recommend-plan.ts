/**
 * Stage 4 scaffold for the phase-aware planner (plan §5 + §6).
 *
 * Module replaces `recommend-leads.ts` per Q4 §17. Today the exports
 * are stubs so the RP-series tests fail at the assertion layer, not at
 * import. Stage 5 ships the real algorithm.
 */

import type { Db } from "../../db/open";
import type {
  CalcResultRef,
  RoleTag,
  RoleTagAssignment,
  ScenarioSkeleton,
  TeamPlanScenario,
  ThreatPanel,
} from "../../schemas/tactical";
import type { UserTeam } from "../../schemas/user-teams";
import type { CalcCache } from "./calc-cache";
import { createCalcCache } from "./calc-cache";
import type { ScoringTeam, ScoringPanel } from "./scoring-team";
import { scorePair, collectKeyCalcsForPair, computeSupportLift } from "./score-pair";
import { scoreMidPhase } from "./score-mid-phase";
import { scoreLatePhase } from "./score-late-phase";
import { deriveTurnFieldStates } from "./derive-turn-fields";
import { detectOpposingSetters } from "./opposing-setter";
import {
  buildLeadRationale,
  buildMidRationale,
  buildLateRationale,
  buildAbandonIf,
  buildMidTrigger,
  buildWinCondition,
} from "./phase-rationale";

/** Slot-index triple identifying one candidate (lead pair, mid pivot, cleaner). */
export interface PlanCandidate {
  leads: [number, number];
  mid: number;
  cleaner: number;
}

export interface RecommendPlanDeps {
  db: Db;
  scoring_team?: ScoringTeam;
  scoring_panel?: ScoringPanel;
  roleAssignments?: ReadonlyMap<string, RoleTagAssignment>;
  /** Pre-curated panel for late_phase_score's bulky-survivor query.
   *  When absent, late_phase_score sees an empty panel and contributes 0. */
  panel?: ThreatPanel;
  /** Stage C (optional): pre-computed opposing setters for the
   *  scenario's opposing_preview. When absent, the orchestrator calls
   *  `detectOpposingSetters(deps.db, scenario.opposing_preview)` once
   *  per scenario. Lets the overview level memoize per-scenario. */
  opposingSetters?: import("./opposing-setter").OpposingSetters;
}

/** Score bonus when a candidate plan hits all three chain links:
 *  setter in lead AND cleric/redirect in mid AND cleaner/setup_sweeper
 *  in late (the canonical setter → pivot → cleaner backbone).
 *  TODO(stage6-deferred): role-chain-bonus-calibration — retune across
 *  ≥ 5 saved teams in the Stage C+ calibration follow-up. */
export const FULL_CHAIN_BONUS = 15;
/** Score bonus when a candidate plan hits exactly 2 of the 3 chain
 *  links. Reflects partial structural coherence. */
export const PARTIAL_CHAIN_BONUS = 8;
/** Score penalty when the team carries a setter but the lead pair
 *  doesn't (the setter is "wasted on the bench"). */
export const SETTER_ON_BENCH_PENALTY = 20;

const SETTER_TAGS = new Set<RoleTag>([
  "screen_setter", "speed_control_setter", "weather_setter",
]);
const MID_CHAIN_TAGS = new Set<RoleTag>(["cleric", "redirect"]);
const LATE_CHAIN_TAGS = new Set<RoleTag>(["cleaner", "setup_sweeper"]);

function rolesOf(
  id: string,
  roles: ReadonlyMap<string, RoleTagAssignment>,
): ReadonlySet<RoleTag> {
  return new Set(roles.get(id)?.all ?? []);
}

function speciesAt(team: UserTeam, slot: number): string {
  const sets = (team as unknown as { sets?: Array<{ species_id?: string | null; species_roster_id?: string | null }> }).sets ?? [];
  return sets[slot]?.species_id ?? sets[slot]?.species_roster_id ?? "";
}

function roleChainBonus(
  candidate: PlanCandidate,
  team: UserTeam,
  roles: ReadonlyMap<string, RoleTagAssignment>,
): number {
  const leadRoles = new Set<RoleTag>([
    ...rolesOf(speciesAt(team, candidate.leads[0]), roles),
    ...rolesOf(speciesAt(team, candidate.leads[1]), roles),
  ]);
  const midRoles = rolesOf(speciesAt(team, candidate.mid), roles);
  const lateRoles = rolesOf(speciesAt(team, candidate.cleaner), roles);
  const chainSetter = [...SETTER_TAGS].some((t) => leadRoles.has(t));
  const chainCleric = [...MID_CHAIN_TAGS].some((t) => midRoles.has(t));
  const chainCleaner = [...LATE_CHAIN_TAGS].some((t) => lateRoles.has(t));
  const hits = (chainSetter ? 1 : 0) + (chainCleric ? 1 : 0) + (chainCleaner ? 1 : 0);
  if (hits >= 3) return FULL_CHAIN_BONUS;
  if (hits >= 2) return PARTIAL_CHAIN_BONUS;
  return 0;
}

function setterOnBenchPenalty(
  candidate: PlanCandidate,
  team: UserTeam,
  roles: ReadonlyMap<string, RoleTagAssignment>,
): number {
  // Penalty when the team carries a setter but no setter is in the lead pair.
  let teamHasSetter = false;
  for (let i = 0; i < 6; i++) {
    const tags = rolesOf(speciesAt(team, i), roles);
    if ([...SETTER_TAGS].some((t) => tags.has(t))) { teamHasSetter = true; break; }
  }
  if (!teamHasSetter) return 0;
  const leadTags = new Set<RoleTag>([
    ...rolesOf(speciesAt(team, candidate.leads[0]), roles),
    ...rolesOf(speciesAt(team, candidate.leads[1]), roles),
  ]);
  const leadHasSetter = [...SETTER_TAGS].some((t) => leadTags.has(t));
  return leadHasSetter ? 0 : SETTER_ON_BENCH_PENALTY;
}

/**
 * Enumerate valid plan candidates for a team + scenario.
 *
 * **When to use it:** called by {@link recommendTeamPlan} as the first
 * stage of the lead/mid/late search. Stage 5 implements the role-tag
 * pruning rules from plan §5.
 *
 * @param _team - The saved {@link UserTeam}.
 * @param _scenario - One {@link ScenarioSkeleton} (Stage 4) or
 *   {@link TeamPlanScenario} skeleton (Stage 5).
 * @param _roleAssignments - Precomputed map from
 *   {@link import('./pillars').buildRoleAssignments}.
 * @returns Pruned list of candidates (typically 30–60 of the 180 raw triples).
 * @throws Never.
 */
/** Lead-eligible role tags. `setup_sweeper` is in (the payoff belongs in
 *  the lead behind its setter — e.g. Archaludon behind Sableye/Pelipper).
 *  `cleaner` is OUT: cleaner is a Choice-Scarf + Last-Respects/priority
 *  archetype whose payoff scales with the late-game board (Last Respects
 *  is +50 BP per fallen ally — effectively 0 BP turn 1, 200+ BP turn 5+).
 *  Putting a cleaner in lead wastes the scaling and burns the setup
 *  enabler. `pivot` is also OUT (pivot is a mid-phase concept). */
const LEAD_ELIGIBLE_TAGS = new Set<RoleTag>([
  "weather_setter", "speed_control_setter", "screen_setter",
  "redirect", "disruptor", "wallbreaker",
  "setup_sweeper",
]);
const MID_ELIGIBLE_TAGS = new Set<RoleTag>([
  "cleric", "redirect", "pivot", "wallbreaker", "setup_sweeper", "disruptor",
]);
const CLEANER_ROLE_TAGS = new Set<RoleTag>(["cleaner"]);
const CLEANER_FALLBACK_TAGS = new Set<RoleTag>(["setup_sweeper", "wallbreaker"]);

function tagsForSlot(
  team: UserTeam,
  slot: number,
  roleAssignments: ReadonlyMap<string, RoleTagAssignment>,
): ReadonlySet<RoleTag> {
  const sets = (team as unknown as { sets?: Array<{ species_id?: string | null; species_roster_id?: string | null }> }).sets ?? [];
  const id = sets[slot]?.species_id ?? sets[slot]?.species_roster_id;
  if (!id) return new Set();
  return new Set(roleAssignments.get(id)?.all ?? []);
}

/**
 * Enumerate (lead, lead, mid, cleaner) candidate plans for a team +
 * scenario, after role-tag pruning per plan §5.
 *
 * **When to use it:** the first stage of `recommendTeamPlan`. Stage B
 * tests construct synthetic teams to validate the pruning rules in
 * isolation (PG1..PG6).
 *
 * Rules:
 *   - Slots are disjoint (4 distinct slots across leads + mid + cleaner).
 *   - Both leads must carry a lead-eligible role tag (setter / redirect
 *     / disruptor / wallbreaker / setup_sweeper). `cleaner` is excluded
 *     so Last Respects' scaling isn't burned turn-1.
 *   - Mid must carry a mid-eligible tag and not be the pure cleaner.
 *   - Cleaner is the team's `cleaner` slot; falls back to
 *     `setup_sweeper`/`wallbreaker` when no cleaner exists (Q1 §17).
 *
 * @param team - The saved {@link UserTeam}.
 * @param _scenario - Scenario skeleton — currently unused by the
 *   generator, but reserved for future scenario-aware pruning.
 * @param roleAssignments - Map from `buildRoleAssignments` (Stage A).
 * @returns Pruned candidate list (typically 6–60 of the 180 raw
 *   triples on a 6-mon team). Empty when role data is missing.
 * @throws Never.
 */
export function generatePlanCandidates(
  team: UserTeam,
  _scenario: ScenarioSkeleton,
  roleAssignments: ReadonlyMap<string, RoleTagAssignment>,
): PlanCandidate[] {
  if (roleAssignments.size === 0) return [];
  const out: PlanCandidate[] = [];

  // Detect whether ANY slot satisfies the cleaner gate via `cleaner` role;
  // when none, fall back to setup_sweeper / wallbreaker (Q1 §17).
  const cleanerByRole = new Set<number>();
  const cleanerByFallback = new Set<number>();
  for (let i = 0; i < 6; i++) {
    const tags = tagsForSlot(team, i, roleAssignments);
    if ([...CLEANER_ROLE_TAGS].some((t) => tags.has(t))) cleanerByRole.add(i);
    if ([...CLEANER_FALLBACK_TAGS].some((t) => tags.has(t))) cleanerByFallback.add(i);
  }
  const cleanerSlots = cleanerByRole.size > 0 ? cleanerByRole : cleanerByFallback;
  if (cleanerSlots.size === 0) return [];

  for (let a = 0; a < 6; a++) {
    for (let b = a + 1; b < 6; b++) {
      const tagsA = tagsForSlot(team, a, roleAssignments);
      const tagsB = tagsForSlot(team, b, roleAssignments);
      // Both leads must be lead-eligible. Tightened from "at least one"
      // so that the team's `cleaner` (Basculegion-style Scarf revenge
      // killer) can't get pulled into the lead pair by a partner who
      // happens to be a setter — that would waste Last Respects'
      // scaling and burn the setter's screens/weather.
      const aEligible = [...LEAD_ELIGIBLE_TAGS].some((t) => tagsA.has(t));
      const bEligible = [...LEAD_ELIGIBLE_TAGS].some((t) => tagsB.has(t));
      if (!aEligible || !bEligible) continue;

      for (let mid = 0; mid < 6; mid++) {
        if (mid === a || mid === b) continue;
        const midTags = tagsForSlot(team, mid, roleAssignments);
        // Mid gate: must have a mid-eligible tag AND not be the team's
        // primary cleaner (pure cleaners belong in the late phase).
        if (!([...MID_ELIGIBLE_TAGS].some((t) => midTags.has(t)))) continue;
        if (cleanerByRole.has(mid) && midTags.size === 1) continue;

        for (const cleaner of cleanerSlots) {
          if (cleaner === a || cleaner === b || cleaner === mid) continue;
          out.push({ leads: [a, b], mid, cleaner });
        }
      }
    }
  }
  return out;
}

/**
 * Recommend the best 3-phase plan for a scenario.
 *
 * **When to use it:** drop-in successor to Stage A's `recommendLeads`.
 * Stage 5 emits a fully-populated {@link TeamPlanScenario}; today the
 * stub returns the input scenario coerced into a plan with empty phases
 * so tests fail at the assertion layer.
 *
 * @param _team - The saved {@link UserTeam}.
 * @param _scenario - Scenario skeleton (name, field, opposing_preview).
 * @param _calcCache - Process-scoped calc cache shared with the pillars.
 * @param _deps - DB handle + optional scoring team / panel / role map.
 * @returns A {@link TeamPlanScenario}.
 * @throws TacticalOverviewError when the team can't legally produce a plan.
 */
/**
 * Score a plan candidate per plan §6.
 *
 *   plan_score = 1.0 * pair_score(leads)
 *              + 0.6 * mid_phase_score(mid)
 *              + 0.8 * late_phase_score(cleaner)
 *              + role_chain_bonus(candidate)
 *              - setter_on_bench_penalty(candidate)
 */
function scorePlan(
  candidate: PlanCandidate,
  team: UserTeam,
  scenario: ScenarioSkeleton,
  calcCache: CalcCache,
  deps: RecommendPlanDeps,
): number {
  // Pair scoring reuses Stage A's `scorePair` verbatim. Tests pass empty
  // `deps` — the stub path inside `scorePair` returns a deterministic
  // baseline keyed off the lead indices, which is enough for the
  // ordering invariants we depend on here.
  const calcDeps = {
    db: deps.db,
    ...(deps.scoring_team ? { scoring_team: deps.scoring_team } : { calc: () => ({}) }),
    ...(deps.scoring_panel ? { scoring_panel: deps.scoring_panel } : {}),
    ...(deps.roleAssignments ? { roleAssignments: deps.roleAssignments } : {}),
    teamSlotSpeciesIds: [0, 1, 2, 3, 4, 5].map((i) => speciesAt(team, i)),
  };
  // Stage C: per-phase field-state derivation replaces Stage B's
  // unconditional ability-override. The phase scorers each consume a
  // ScenarioSkeleton whose `field` is the derived phase-specific state.
  const roles = deps.roleAssignments ?? new Map<string, RoleTagAssignment>();
  // Q11 binding: `recommendTeamPlan` precomputes opposing setters once
  // per scenario and threads them via `deps.opposingSetters`. Don't
  // re-query — the inner loop runs ~50× per scenario.
  const opposing = deps.opposingSetters ?? detectOpposingSetters(deps.db, scenario.opposing_preview);
  const turnFields = deriveTurnFieldStates({
    team, scenario, candidate, roleAssignments: roles, opposingSetters: opposing,
  });
  const leadScenario: ScenarioSkeleton = { ...scenario, field: turnFields.lead };
  const midScenario: ScenarioSkeleton = { ...scenario, field: turnFields.mid };
  const lateScenario: ScenarioSkeleton = { ...scenario, field: turnFields.late };

  const pair = scorePair(
    team,
    candidate.leads,
    [candidate.mid, candidate.cleaner],
    leadScenario,
    calcCache,
    calcDeps,
  );
  const mid = scoreMidPhase(candidate.mid, midScenario, calcCache, calcDeps);
  const late = scoreLatePhase(
    candidate.cleaner,
    lateScenario,
    deps.panel ?? { schema_version: 1, as_of: "1970-01-01", generated_at: "1970-01-01T00:00:00Z", entries: [] },
    calcCache,
    calcDeps,
  );
  const chain = roleChainBonus(candidate, team, deps.roleAssignments ?? new Map());
  const penalty = setterOnBenchPenalty(candidate, team, deps.roleAssignments ?? new Map());
  return 1.0 * pair + 0.6 * mid + 0.8 * late + chain - penalty;
}

/**
 * Recommend the best 3-phase plan for a scenario. Stage B (Q4 §17)
 * replacement for Stage A's `recommendLeads`.
 *
 * **When to use it:** orchestration-side; consumed by
 * `buildOverview` once per scenario and by `handleRecommendTeamPlan`
 * end-to-end. Stage B's only entry point into the plan composer.
 *
 * Picks the highest-scoring `(lead, lead, mid, cleaner)` triple from
 * `generatePlanCandidates`, builds template rationales, and the top
 * damage calc for each phase. Stage C wires per-phase field-state
 * derivation via `deriveTurnFieldStates`: weather duel resolution
 * (slower setter wins, ties → theirs), priority-ability promotion
 * (Prankster Rain Dance / Gale Wings Tailwind), and decay schedules
 * (Tailwind 4T, TR/screens 5T) all flow into the per-phase
 * `ScenarioSkeleton` consumed by the phase scorers.
 *
 * @param team - The saved {@link UserTeam}.
 * @param scenario - Scenario skeleton (name, type, field, opposing_preview).
 * @param calcCache - Process-scoped calc cache (shared with pillars).
 * @param deps - DB handle + optional scoring_team / scoring_panel /
 *   roleAssignments / panel.
 * @returns A fully populated {@link TeamPlanScenario}.
 * @throws Never (defensive: when role pruning produces zero
 *   candidates, emits a low-confidence fallback plan).
 *
 * @example
 *   const plan = recommendTeamPlan(team, scenario, createCalcCache(), {
 *     db, roleAssignments,
 *   });
 *   console.log(plan.phases[0].active);  // ["archaludon", "pelipper"]
 */
export function recommendTeamPlan(
  team: UserTeam,
  scenario: ScenarioSkeleton,
  calcCache: CalcCache,
  deps: RecommendPlanDeps,
): TeamPlanScenario {
  const roleAssignments = deps.roleAssignments ?? new Map<string, RoleTagAssignment>();
  const cache = calcCache ?? createCalcCache();
  const candidates = generatePlanCandidates(team, scenario, roleAssignments);

  // Q11 binding: memoize opposing-setter detection ONCE per scenario.
  // Without this, the inner `scorePlan` loop re-queries the DB roughly
  // 50× per scenario × 10 scenarios = 500× per overview. Compute once;
  // thread to scorePlan via a stable `depsWithOpposing` object so the
  // memoized value reaches the inner derivation calls.
  const opposingSetters = deps.opposingSetters
    ?? detectOpposingSetters(deps.db, scenario.opposing_preview);
  const depsWithOpposing: RecommendPlanDeps = { ...deps, opposingSetters };

  // Fall-through: if no candidates pass the role pruning, surface a
  // confidence: "low" plan that picks the first three slots. This
  // preserves the schema contract for downstream callers; the live
  // demo doesn't hit this branch (ArchaEye has both setters and
  // sweepers).
  if (candidates.length === 0) {
    // Stage C: emit a fallback per-phase field that just passes the
    // scenario field through with our-side decay applied for late.
    const fallbackOpposing = opposingSetters;
    const fallbackFields = deriveTurnFieldStates({
      team, scenario,
      candidate: { leads: [0, 1], mid: 2, cleaner: 3 },
      roleAssignments, opposingSetters: fallbackOpposing,
    });
    return {
      name: scenario.name,
      type: scenario.type,
      field: scenario.field,
      opposing_preview: scenario.opposing_preview,
      phases: [
        {
          phase: "lead",
          turn_window: [1, 2],
          active: [speciesAt(team, 0) || "unknown", speciesAt(team, 1) || "unknown"],
          rationale: "Insufficient role coverage for a structured plan.",
          key_calcs: [],
          abandon_if: "Re-evaluate team composition.",
          support_lift: 0,
          field: fallbackFields.lead,
        },
        {
          phase: "mid",
          turn_window: [2, 4],
          pivot_in: speciesAt(team, 2) || "unknown",
          pivot_out: null,
          rationale: "No mid-eligible role detected.",
          key_calcs: [],
          trigger: "Re-evaluate team composition.",
          field: fallbackFields.mid,
        },
        {
          phase: "late",
          turn_window: [4, 8],
          cleaner: speciesAt(team, 3) || "unknown",
          rationale: "No cleaner detected.",
          key_calcs: [],
          win_condition: "Re-evaluate team composition.",
          field: fallbackFields.late,
        },
      ],
      plan_score: 0,
      citations: [],
      confidence: "low",
    };
  }

  // Score every candidate; pick highest with deterministic tiebreak on
  // the (leads, mid, cleaner) tuple.
  const scored = candidates.map((c) => ({ c, s: scorePlan(c, team, scenario, cache, depsWithOpposing) }));
  scored.sort((a, b) => {
    if (b.s !== a.s) return b.s - a.s;
    if (a.c.leads[0] !== b.c.leads[0]) return a.c.leads[0] - b.c.leads[0];
    if (a.c.leads[1] !== b.c.leads[1]) return a.c.leads[1] - b.c.leads[1];
    if (a.c.mid !== b.c.mid) return a.c.mid - b.c.mid;
    return a.c.cleaner - b.c.cleaner;
  });
  const winner = scored[0]!;
  const c = winner.c;

  // Pull the top calc for each phase from `collectKeyCalcsForPair` —
  // when a real scoring_team is plumbed in, this hits warm cache.
  const stageAScenario = scenario as ScenarioSkeleton;
  let leadCalcs: CalcResultRef[] = [];
  try {
    leadCalcs = collectKeyCalcsForPair(c.leads, stageAScenario, cache, {
      db: deps.db,
      ...(deps.scoring_team ? { scoring_team: deps.scoring_team } : { calc: () => ({}) }),
      ...(deps.scoring_panel ? { scoring_panel: deps.scoring_panel } : {}),
    });
  } catch {
    leadCalcs = [];
  }
  const topLeadCalc = leadCalcs[0] ?? null;

  // Support_lift on the lead phase (Q9 §17): re-derive from the existing
  // helper. Stage A's `computeSupportLift` reads role tags; same inputs.
  let support_lift: number | undefined;
  if (deps.roleAssignments) {
    const leadIds = [speciesAt(team, c.leads[0]), speciesAt(team, c.leads[1])] as [string, string];
    const backIds = [speciesAt(team, c.mid), speciesAt(team, c.cleaner)] as [string, string];
    support_lift = computeSupportLift({
      leadIds, backIds,
      roleAssignments: deps.roleAssignments,
      scenario: stageAScenario as ScenarioSkeleton & { has_priority_threats?: boolean },
    });
  }

  const leadActive: [string, string] = [
    speciesAt(team, c.leads[0]),
    speciesAt(team, c.leads[1]),
  ];
  const pivotIn = speciesAt(team, c.mid);
  const cleanerId = speciesAt(team, c.cleaner);

  // Stage C: derive per-phase field states for the winning candidate so
  // the emitted phases can introspect them.
  const winnerOpposing = opposingSetters;
  const winnerFields = deriveTurnFieldStates({
    team, scenario, candidate: c, roleAssignments, opposingSetters: winnerOpposing,
  });

  const rationaleCommon = { scenario, roleAssignments };
  return {
    name: scenario.name,
    type: scenario.type,
    field: scenario.field,
    opposing_preview: scenario.opposing_preview,
    phases: [
      {
        phase: "lead",
        turn_window: [1, 2],
        active: leadActive,
        rationale: buildLeadRationale({ ...rationaleCommon, leads: leadActive, topCalc: topLeadCalc }),
        key_calcs: topLeadCalc ? [topLeadCalc].slice(0, 2) : [],
        abandon_if: buildAbandonIf({ ...rationaleCommon, leads: leadActive, topCalc: topLeadCalc }),
        ...(support_lift !== undefined ? { support_lift } : {}),
        field: winnerFields.lead,
      },
      {
        phase: "mid",
        turn_window: [2, 4],
        pivot_in: pivotIn,
        pivot_out: leadActive[0],
        rationale: buildMidRationale({ ...rationaleCommon, pivot_in: pivotIn, topCalc: null }),
        key_calcs: [],
        trigger: buildMidTrigger({ ...rationaleCommon, pivot_in: pivotIn, topCalc: null }),
        field: winnerFields.mid,
      },
      {
        phase: "late",
        turn_window: [4, 8],
        cleaner: cleanerId,
        rationale: buildLateRationale({ ...rationaleCommon, cleaner: cleanerId, topCalc: null }),
        key_calcs: [],
        win_condition: buildWinCondition({ ...rationaleCommon, cleaner: cleanerId, topCalc: null }),
        field: winnerFields.late,
      },
    ],
    plan_score: winner.s,
    citations: [],
    confidence: "medium",
  };
}
