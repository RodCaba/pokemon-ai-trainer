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
  RecommendLeadsInput,
  RecommendLeadsOutput,
  ScorePillarsInput,
  ScorePillarsOutput,
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

export const recommendLeadsTool: Tool = {
  name: "recommend_leads",
  description:
    "Generate scenario-specific lead recommendations for a saved user team. Returns the recommended lead pair, backline pair, rejected bench, ≤ 3 supporting damage calcs, and ≤ 3 knowledge_chunk citations per scenario. With scenario_name set, returns one scenario; without, returns all 5–7. Use AFTER score_pillars — this tool is more expensive (~10–15s for all scenarios) and the scores tell you which scenario the user's actual question maps to. Do NOT use to compare two teams (out of scope v1).",
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
  recommendLeadsTool,
];

export interface TacticalToolDeps extends OverviewDeps {
  db: Db;
}

/** Handler for `score_pillars`. Throws TacticalOverviewError on bad team. */
export function handleScorePillars(
  _input: ScorePillarsInput,
  _deps: TacticalToolDeps,
): ScorePillarsOutput {
  throw new Error("not implemented (Stage 5)");
}

/** Handler for `recommend_leads`. With `scenario_name`, returns one scenario. */
export function handleRecommendLeads(
  _input: RecommendLeadsInput,
  _deps: TacticalToolDeps,
): RecommendLeadsOutput {
  throw new Error("not implemented (Stage 5)");
}

/** In-process dispatcher used by tests + the agent loop. */
export const tacticalToolHandlers = {
  score_pillars: handleScorePillars,
  recommend_leads: handleRecommendLeads,
} as const;
