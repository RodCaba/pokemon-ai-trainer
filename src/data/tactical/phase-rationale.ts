/**
 * Deterministic phase-rationale template builders (plan §7).
 *
 * No LLM. Mirrors the prose voice of `recommend-leads.ts`'s
 * `buildReasoning`: capitalized species names, top-calc snippet, terse
 * end clause. Each `rationale` is bounded at 300 chars; auxiliary
 * fields (`abandon_if` / `trigger` / `win_condition`) at 200. Strings
 * truncate on the last word boundary before the cap and append `…`.
 */

import type {
  CalcResultRef,
  RoleTagAssignment,
  ScenarioSkeleton,
} from "../../schemas/tactical";

export interface RationaleInput {
  scenario: ScenarioSkeleton;
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

const RATIONALE_CAP = 300;
const AUX_CAP = 200;

function capitalize(id: string): string {
  if (id.length === 0) return id;
  return id[0]!.toUpperCase() + id.slice(1);
}

function primaryRole(
  id: string,
  roles: ReadonlyMap<string, RoleTagAssignment>,
): string {
  return roles.get(id)?.primary ?? "untagged";
}

function calcSnippet(calc: CalcResultRef | null): string {
  if (calc === null) return "";
  return `${calc.move_id} OHKOs ${capitalize(calc.defender_species_id)} (${calc.max_roll_pct.toFixed(0)}% max).`;
}

function truncate(s: string, cap: number): string {
  if (s.length <= cap) return s;
  const cut = s.slice(0, cap - 1);
  const lastSpace = cut.lastIndexOf(" ");
  const trimmed = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
  return trimmed + "…";
}

/** Build the lead-phase rationale. ≤ 300 chars. */
export function buildLeadRationale(input: LeadRationaleInput): string {
  const [a, b] = input.leads;
  const roleA = primaryRole(a, input.roleAssignments);
  const roleB = primaryRole(b, input.roleAssignments);
  const calc = calcSnippet(input.topCalc);
  const body = `${capitalize(a)} (${roleA}) + ${capitalize(b)} (${roleB}) — turn-1 setup vs ${input.scenario.name}.${calc.length > 0 ? ` ${calc}` : ""}`;
  return truncate(body, RATIONALE_CAP);
}

/** Build the mid-phase rationale. ≤ 300 chars. */
export function buildMidRationale(input: MidRationaleInput): string {
  const role = primaryRole(input.pivot_in, input.roleAssignments);
  const calc = calcSnippet(input.topCalc);
  const body = `${capitalize(input.pivot_in)} (${role}) — pivots in to stabilize turns 3–4.${calc.length > 0 ? ` ${calc}` : ""}`;
  return truncate(body, RATIONALE_CAP);
}

/** Build the late-phase rationale. ≤ 300 chars. */
export function buildLateRationale(input: LateRationaleInput): string {
  const role = primaryRole(input.cleaner, input.roleAssignments);
  const calc = calcSnippet(input.topCalc);
  const body = `${capitalize(input.cleaner)} (${role}) — revenge-cleans surviving threats turn 5+.${calc.length > 0 ? ` ${calc}` : ""}`;
  return truncate(body, RATIONALE_CAP);
}

/** When to abandon the lead plan (≤ 200 chars). */
export function buildAbandonIf(input: LeadRationaleInput): string {
  const [a, b] = input.leads;
  const body = `${capitalize(a)} falls before turn 2 OR opposing weather negates the ${input.scenario.field.weather === "none" ? "field" : input.scenario.field.weather} plan around ${capitalize(b)}.`;
  return truncate(body, AUX_CAP);
}

/** What event opens the mid phase (≤ 200 chars). */
export function buildMidTrigger(input: MidRationaleInput): string {
  const body = `Lead pair takes ≥ 50% HP, OR a screen/weather effect expires, OR the opposing pivot threatens ${capitalize(input.pivot_in)}'s typing.`;
  return truncate(body, AUX_CAP);
}

/** The late-phase win condition (≤ 200 chars). */
export function buildWinCondition(input: LateRationaleInput): string {
  const body = `${capitalize(input.cleaner)} fires a STAB or priority move into the opposing survivor at <50% HP — typically a Choice Scarf or +1 boosted attacker line.`;
  return truncate(body, AUX_CAP);
}
