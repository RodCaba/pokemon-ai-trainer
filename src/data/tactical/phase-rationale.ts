/**
 * Stage 4 scaffold for the phase-rationale template builders (plan §7).
 * Stage 5 ships the deterministic template strings; Stage 4 returns
 * empty placeholders so consumer tests fail at the assertion layer.
 */

import type {
  CalcResultRef,
  RoleTagAssignment,
  ScenarioOverview,
  TeamPlanScenario,
} from "../../schemas/tactical";

export interface RationaleInput {
  scenario: ScenarioOverview | TeamPlanScenario;
  roleAssignments: ReadonlyMap<string, RoleTagAssignment>;
  topCalc: CalcResultRef | null;
}

export interface LeadRationaleInput extends RationaleInput {
  leads: [string, string];
}
export interface MidRationaleInput extends RationaleInput {
  pivot_in: string;
}
export interface LateRationaleInput extends RationaleInput {
  cleaner: string;
}

export function buildLeadRationale(_input: LeadRationaleInput): string { return ""; }
export function buildMidRationale(_input: MidRationaleInput): string { return ""; }
export function buildLateRationale(_input: LateRationaleInput): string { return ""; }
export function buildAbandonIf(_input: LeadRationaleInput): string { return ""; }
export function buildMidTrigger(_input: MidRationaleInput): string { return ""; }
export function buildWinCondition(_input: LateRationaleInput): string { return ""; }
