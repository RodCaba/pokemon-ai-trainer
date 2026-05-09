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
    "Generate scenario-specific lead recommendations for a saved user team. Returns the recommended lead pair, backline pair, rejected bench, a `description` (1–2 paragraphs explaining what the scenario tests), `reasoning` (short rationale citing the top damage roll), `key_calcs` (≤ 3 CalcResultRefs from the engine), `citations` (≤ 3 knowledge_chunks tagged with the scenario species), `pair_score`, and `confidence` ('low'|'medium'|'high'). With scenario_name set, returns one scenario; without, returns all 5–7. Use AFTER score_pillars — this tool is more expensive (~10–15s for all scenarios) and the scores tell you which scenario the user's actual question maps to. **CONFIDENCE PROTOCOL:** when a scenario's `confidence='low'`, supplement with a `web_search` for the species/scenario before quoting the recommendation — our internal corpus may be incomplete. `'medium'` is acceptable to quote directly; `'high'` is strong enough to recommend without further research. Do NOT use to compare two teams (out of scope v1).",
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
 * Handler for `recommend_leads`. Returns one scenario (when `scenario_name`
 * provided) or all scenarios.
 *
 * @param input - `{ team_id, scenario_name? }` from the agent.
 * @param deps - DB handle + DI bundle.
 * @returns A {@link RecommendLeadsOutput}.
 * @throws TacticalOverviewError on draft / validation_errors / unknown id.
 */
export function handleRecommendLeads(
  input: RecommendLeadsInput,
  deps: TacticalToolDeps,
): RecommendLeadsOutput {
  const ov = buildOverview(input.team_id, deps);
  if (input.scenario_name) {
    const match = ov.scenarios.find((s) => s.name === input.scenario_name);
    if (!match) {
      const available = ov.scenarios.map((s) => s.name).join(", ");
      throw new TacticalOverviewError(
        `scenario '${input.scenario_name}' not found; available: ${available}`,
        { team_id: input.team_id },
      );
    }
    return { team_id: input.team_id, scenarios: [match] };
  }
  return { team_id: input.team_id, scenarios: ov.scenarios };
}

/** In-process dispatcher used by tests + the agent loop. */
export const tacticalToolHandlers = {
  score_pillars: handleScorePillars,
  recommend_leads: handleRecommendLeads,
} as const;
