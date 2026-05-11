/**
 * Anthropic-SDK tool definitions for the team-tactical-overview slice.
 *
 * Per Q8 binding: TWO read-only tools — `score_pillars` (cheap, ~5–8s)
 * and `recommend_leads` (expensive, ~10–15s, scenario-targeted).
 *
 * Stage-4 stub: tool definitions are exported but their handlers throw
 * "not implemented (Stage 5)".
 */

import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import type { Db } from "../db/open";
import type {
  RecommendTeamPlanInput,
  RecommendTeamPlanOutput,
  ScorePillarsInput,
  ScorePillarsOutput,
  TeamPlanScenario,
} from "../schemas/tactical";
import type { OverviewDeps } from "../data/tactical/overview";

/** Catalog of agent-callable tactical tools. */
export const scorePillarsTool: Tool = {
  name: "score_pillars",
  description:
    "Compute the four-pillar tactical assessment (Offense / Defense / Speed / Synergy, each 0–100) for a saved user team against the current Reg M-A meta. Returns scores + per-pillar evidence (top KO chances, weakest slot, fastest tier, detected archetypes). Use this BEFORE recommending leads — pillar scores tell you which scenarios are worth drilling into. Inexpensive (~5–8s); call once per user question about team strength. Do NOT use for matchup-specific lead picks (that's recommend_leads).",
  input_schema: {
    type: "object",
    properties: {
      team_id: {
        type: "string",
        description: "Saved user_team id (ULID).",
      },
    },
    required: ["team_id"],
    additionalProperties: false,
  },
};

/**
 * Stage B (Q8 §17): REPLACES `recommend_leads` with a 3-phase plan.
 * Returns one `TeamPlanScenario` per scenario, each carrying
 * `phases = [lead, mid, late]` instead of the legacy
 * `(leads, backline, bench)` triple.
 */
export const recommendTeamPlanTool: Tool = {
  name: "recommend_team_plan",
  description:
    "Generate a 3-phase plan (lead T1–T2 / mid T2–T4 / late T4+) for a saved user team against a scenario. Returns one TeamPlanScenario when `scenario_name` is set, all 5–10 otherwise. Each phase carries actor ids, deterministic rationale, top damage calcs, and per-phase trigger/abandon/win-condition strings. Use AFTER score_pillars to surface the actual play plan, not just the lead pair. Replaces the Stage-A `recommend_leads` tool.",
  input_schema: {
    type: "object",
    properties: {
      team_id: {
        type: "string",
        description: "Saved user_team id (ULID).",
      },
      scenario_name: {
        type: "string",
        description:
          "Optional. Exact scenario name from a previous score_pillars or overview call. Omit to return all scenarios.",
      },
    },
    required: ["team_id"],
    additionalProperties: false,
  },
};

export const TACTICAL_TOOL_DEFINITIONS: readonly Tool[] = [
  scorePillarsTool,
  recommendTeamPlanTool,
];

export interface TacticalToolDeps extends OverviewDeps {
  db: Db;
}

import { buildOverview } from "../data/tactical/overview";
import { TacticalOverviewError } from "../schemas/errors";

/**
 * Handler for `score_pillars`. Returns the four-pillar bundle for the team.
 *
 * @param input - `{ team_id }` from the agent.
 * @param deps - DB handle + DI bundle.
 * @returns A {@link ScorePillarsOutput}.
 * @throws TacticalOverviewError on draft / validation_errors / unknown id.
 */
export function handleScorePillars(
  input: ScorePillarsInput,
  deps: TacticalToolDeps,
): ScorePillarsOutput {
  const ov = buildOverview(input.team_id, deps);
  return {
    team_id: input.team_id,
    pillars: ov.pillars,
    threat_panel_as_of: ov.threat_panel_as_of,
  };
}

/**
 * Stage B handler for `recommend_team_plan`. Stage 4 stub returns the
/**
 * Stage B (Q8 §17) handler for the `recommend_team_plan` Anthropic
 * tool. Returns one `TeamPlanScenario` when `scenario_name` is set;
 * otherwise the full scenario array from `buildOverview`.
 *
 * **When to use it:** wired into the agent loop alongside
 * `handleScorePillars`. The agent calls `score_pillars` first to
 * understand the team, then `recommend_team_plan` once it knows which
 * scenario the user's question maps to. Don't loop over scenarios
 * client-side — the bundled overview is cheaper.
 *
 * @param input - `{ team_id, scenario_name? }` from the model.
 * @param deps - DB handle + OverviewDeps for `buildOverview`.
 * @returns A `RecommendTeamPlanOutput` validated by the schema.
 * @throws TacticalOverviewError when the team is draft / has
 *   validation_errors / scenario_name doesn't match any emitted name.
 *
 * @example
 *   const out = handleRecommendTeamPlan(
 *     { team_id: "01H..." , scenario_name: "Rain" },
 *     { db, calc: {}, speed: {}, synergy: { db } },
 *   );
 *   console.log(out.scenarios[0]!.phases[0]!.active);  // [string, string]
 */
export function handleRecommendTeamPlan(
  input: RecommendTeamPlanInput,
  deps: TacticalToolDeps,
): RecommendTeamPlanOutput {
  const ov = buildOverview(input.team_id, deps);
  // Stage 5: buildOverview emits TeamPlanScenarios directly.
  const scenarios = ov.scenarios as unknown as TeamPlanScenario[];
  if (input.scenario_name) {
    const match = scenarios.find((s) => s.name === input.scenario_name);
    if (!match) {
      const available = scenarios.map((s) => s.name).join(", ");
      throw new TacticalOverviewError(
        `scenario '${input.scenario_name}' not found; available: ${available}`,
        { team_id: input.team_id },
      );
    }
    return { team_id: input.team_id, scenarios: [match] };
  }
  return { team_id: input.team_id, scenarios };
}

/** In-process dispatcher used by tests + the agent loop. */
export const tacticalToolHandlers = {
  score_pillars: handleScorePillars,
  recommend_team_plan: handleRecommendTeamPlan,
} as const;
