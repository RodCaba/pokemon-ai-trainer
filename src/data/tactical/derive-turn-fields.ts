/**
 * Stage 4 scaffold for the per-phase field-state resolver (plan §3.4
 * + §7.1). Stage 5 wires the duel + decay + priority-ability rules;
 * today the stub returns `scenario.field` verbatim for all three
 * phases so consumers compile.
 */

import type {
  RoleTagAssignment,
  ScenarioField,
  ScenarioSkeleton,
} from "../../schemas/tactical";
import type { UserTeam } from "../../schemas/user-teams";
import type { PlanCandidate } from "./recommend-plan";
import type { OpposingSetters } from "./opposing-setter";

/** Three derived field-state snapshots (lead T1, mid T2, late T4) for
 *  one candidate plan in one scenario. */
export interface TurnFieldStates {
  lead: ScenarioField;
  mid: ScenarioField;
  late: ScenarioField;
}

export interface DeriveTurnFieldsInput {
  team: UserTeam;
  scenario: ScenarioSkeleton;
  candidate: PlanCandidate;
  roleAssignments: ReadonlyMap<string, RoleTagAssignment>;
  opposingSetters: OpposingSetters;
}

/**
 * Resolve the field-state snapshot for each of the three phases.
 *
 * **When to use it:** called from `scorePlan` once per candidate plan
 * per scenario. Stage 5 implements the duel + decay + priority
 * promotion rules.
 *
 * Stage 4 stub returns `scenario.field` for every phase.
 */
export function deriveTurnFieldStates(input: DeriveTurnFieldsInput): TurnFieldStates {
  return {
    lead: input.scenario.field,
    mid: input.scenario.field,
    late: input.scenario.field,
  };
}
