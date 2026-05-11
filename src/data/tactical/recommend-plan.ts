/**
 * Stage 4 scaffold for the phase-aware planner (plan §5 + §6).
 *
 * Module replaces `recommend-leads.ts` per Q4 §17. Today the exports
 * are stubs so the RP-series tests fail at the assertion layer, not at
 * import. Stage 5 ships the real algorithm.
 */

import type { Db } from "../../db/open";
import type {
  RoleTagAssignment,
  TeamPlanScenario,
  ScenarioOverview,
} from "../../schemas/tactical";
import type { UserTeam } from "../../schemas/user-teams";
import type { CalcCache } from "./calc-cache";
import type { ScoringTeam, ScoringPanel } from "./scoring-team";

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
}

/**
 * Enumerate valid plan candidates for a team + scenario.
 *
 * **When to use it:** called by {@link recommendTeamPlan} as the first
 * stage of the lead/mid/late search. Stage 5 implements the role-tag
 * pruning rules from plan §5.
 *
 * @param _team - The saved {@link UserTeam}.
 * @param _scenario - One {@link ScenarioOverview} (Stage 4) or
 *   {@link TeamPlanScenario} skeleton (Stage 5).
 * @param _roleAssignments - Precomputed map from
 *   {@link import('./pillars').buildRoleAssignments}.
 * @returns Pruned list of candidates (typically 30–60 of the 180 raw triples).
 * @throws Never.
 */
export function generatePlanCandidates(
  _team: UserTeam,
  _scenario: ScenarioOverview | TeamPlanScenario,
  _roleAssignments: ReadonlyMap<string, RoleTagAssignment>,
): PlanCandidate[] {
  return [];
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
export function recommendTeamPlan(
  _team: UserTeam,
  _scenario: ScenarioOverview | TeamPlanScenario,
  _calcCache: CalcCache,
  _deps: RecommendPlanDeps,
): TeamPlanScenario {
  // Stub: emit the minimum-shape TeamPlanScenario so consumers can compile.
  // Stage 5 fills in the real phases / plan_score / citations.
  return {
    name: _scenario.name,
    type: _scenario.type,
    field: _scenario.field,
    opposing_preview: _scenario.opposing_preview,
    phases: [
      {
        phase: "lead",
        turn_window: [1, 2],
        active: ["unknown", "unknown"],
        rationale: "",
        key_calcs: [],
        abandon_if: "",
      },
      {
        phase: "mid",
        turn_window: [2, 4],
        pivot_in: "unknown",
        pivot_out: null,
        rationale: "",
        key_calcs: [],
        trigger: "",
      },
      {
        phase: "late",
        turn_window: [4, 8],
        cleaner: "unknown",
        rationale: "",
        key_calcs: [],
        win_condition: "",
      },
    ],
    plan_score: 0,
    citations: [],
  };
}
