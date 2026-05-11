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
}

const FULL_CHAIN_BONUS = 15;
const PARTIAL_CHAIN_BONUS = 8;
const SETTER_ON_BENCH_PENALTY = 20;

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
const LEAD_ELIGIBLE_TAGS = new Set<RoleTag>([
  "weather_setter", "speed_control_setter", "screen_setter",
  "redirect", "disruptor", "wallbreaker",
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
      const leadEligible =
        [...LEAD_ELIGIBLE_TAGS].some((t) => tagsA.has(t)) ||
        [...LEAD_ELIGIBLE_TAGS].some((t) => tagsB.has(t));
      if (!leadEligible) continue;

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
  const stageAScenario = scenario as ScenarioSkeleton;
  const pair = scorePair(
    team,
    candidate.leads,
    [candidate.mid, candidate.cleaner],
    stageAScenario,
    calcCache,
    calcDeps,
  );
  const mid = scoreMidPhase(candidate.mid, scenario, calcCache, calcDeps);
  const late = scoreLatePhase(
    candidate.cleaner,
    scenario,
    deps.panel ?? { schema_version: 1, as_of: "1970-01-01", generated_at: "1970-01-01T00:00:00Z", entries: [] },
    calcCache,
    calcDeps,
  );
  const chain = roleChainBonus(candidate, team, deps.roleAssignments ?? new Map());
  const penalty = setterOnBenchPenalty(candidate, team, deps.roleAssignments ?? new Map());
  return 1.0 * pair + 0.6 * mid + 0.8 * late + chain - penalty;
}

export function recommendTeamPlan(
  team: UserTeam,
  scenario: ScenarioSkeleton,
  calcCache: CalcCache,
  deps: RecommendPlanDeps,
): TeamPlanScenario {
  const roleAssignments = deps.roleAssignments ?? new Map<string, RoleTagAssignment>();
  const cache = calcCache ?? createCalcCache();
  const candidates = generatePlanCandidates(team, scenario, roleAssignments);

  // Fall-through: if no candidates pass the role pruning, surface a
  // confidence: "low" plan that picks the first three slots. This
  // preserves the schema contract for downstream callers; the live
  // demo doesn't hit this branch (ArchaEye has both setters and
  // sweepers).
  if (candidates.length === 0) {
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
        },
        {
          phase: "mid",
          turn_window: [2, 4],
          pivot_in: speciesAt(team, 2) || "unknown",
          pivot_out: null,
          rationale: "No mid-eligible role detected.",
          key_calcs: [],
          trigger: "Re-evaluate team composition.",
        },
        {
          phase: "late",
          turn_window: [4, 8],
          cleaner: speciesAt(team, 3) || "unknown",
          rationale: "No cleaner detected.",
          key_calcs: [],
          win_condition: "Re-evaluate team composition.",
        },
      ],
      plan_score: 0,
      citations: [],
      confidence: "low",
    };
  }

  // Score every candidate; pick highest with deterministic tiebreak on
  // the (leads, mid, cleaner) tuple.
  const scored = candidates.map((c) => ({ c, s: scorePlan(c, team, scenario, cache, deps) }));
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
      },
      {
        phase: "mid",
        turn_window: [2, 4],
        pivot_in: pivotIn,
        pivot_out: leadActive[0],
        rationale: buildMidRationale({ ...rationaleCommon, pivot_in: pivotIn, topCalc: null }),
        key_calcs: [],
        trigger: buildMidTrigger({ ...rationaleCommon, pivot_in: pivotIn, topCalc: null }),
      },
      {
        phase: "late",
        turn_window: [4, 8],
        cleaner: cleanerId,
        rationale: buildLateRationale({ ...rationaleCommon, cleaner: cleanerId, topCalc: null }),
        key_calcs: [],
        win_condition: buildWinCondition({ ...rationaleCommon, cleaner: cleanerId, topCalc: null }),
      },
    ],
    plan_score: winner.s,
    citations: [],
    confidence: "medium",
  };
}
