/**
 * Anthropic-SDK tool definitions for the user-teams agent surface.
 *
 * Per Stage-2 Q3 (BINDING): `create`, `setStatus`, AND `validateTeam`
 * ship as Anthropic-tool-callable in this slice. The other repo
 * methods (`update`, `upsertSet`, `delete`, `restoreRevision`,
 * `checkpoint`) await Slice 4's controlled write surface.
 *
 * Stage-4 stub: tool definitions are exported but their handlers throw
 * "not implemented (Stage 5)".
 */

import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { z } from "zod";
import type { Db } from "../db/open";
import type { ValidateDeps } from "../data/team-validate";
import type {
  UserTeam,
  UserTeamStatus,
  ValidationResult,
} from "../schemas/user-teams";

/** Input zod schema for `user_teams_create`. */
export const UserTeamsCreateToolInput = z
  .object({
    format: z.literal("RegM-A"),
    origin: z.enum([
      "paste",
      "builder",
      "ai_prompt",
      "duplicated_from_tournament",
    ]),
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    win_condition: z.string().nullable().optional(),
    origin_payload: z.string().nullable().optional(),
    source_tournament_team_id: z.string().nullable().optional(),
  })
  .strict();

/** Input zod schema for `user_teams_set_status`. */
export const UserTeamsSetStatusToolInput = z
  .object({
    format: z.literal("RegM-A"),
    id: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/),
    status: z.enum(["draft", "saved", "archived"]),
  })
  .strict();

/** Input zod schema for `user_teams_validate`. */
export const UserTeamsValidateToolInput = z
  .object({
    format: z.literal("RegM-A"),
    id: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/),
    target_status: z.enum(["draft", "saved"]).optional(),
  })
  .strict();

/**
 * The Anthropic tool catalog entry for `user_teams_create`.
 *
 * **When to use it:** the agent (Slice 4) creates a team from an AI
 * prompt without re-implementing the schema.
 */
export const userTeamsCreateTool: Tool = {
  name: "user_teams_create",
  description:
    "Create a new user-owned Reg M-A team. Returns the freshly-persisted UserTeam (status=draft). Auto-name unless `name` is provided. Use this as the entry point for AI-prompted team creation.",
  input_schema: {
    type: "object",
    properties: {
      format: { type: "string", const: "RegM-A" },
      origin: {
        type: "string",
        enum: [
          "paste",
          "builder",
          "ai_prompt",
          "duplicated_from_tournament",
        ],
      },
      name: { type: "string" },
      description: { type: ["string", "null"] },
      win_condition: { type: ["string", "null"] },
      origin_payload: { type: ["string", "null"] },
      source_tournament_team_id: { type: ["string", "null"] },
    },
    required: ["format", "origin"],
    additionalProperties: false,
  },
};

/** The Anthropic tool catalog entry for `user_teams_set_status`. */
export const userTeamsSetStatusTool: Tool = {
  name: "user_teams_set_status",
  description:
    "Transition a user team's status between draft / saved / archived. Saving requires zero validation errors (warnings are allowed); throws UserTeamValidationError otherwise. Entry into 'saved' creates a revision.",
  input_schema: {
    type: "object",
    properties: {
      format: { type: "string", const: "RegM-A" },
      id: { type: "string" },
      status: { type: "string", enum: ["draft", "saved", "archived"] },
    },
    required: ["format", "id", "status"],
    additionalProperties: false,
  },
};

/** The Anthropic tool catalog entry for `user_teams_validate`. */
export const userTeamsValidateTool: Tool = {
  name: "user_teams_validate",
  description:
    "Run validateTeam against a stored user team and return { errors, warnings }. Use to surface validation state without changing status. `target_status='saved'` promotes draft-only warnings to errors and emits slot_empty.",
  input_schema: {
    type: "object",
    properties: {
      format: { type: "string", const: "RegM-A" },
      id: { type: "string" },
      target_status: { type: "string", enum: ["draft", "saved"] },
    },
    required: ["format", "id"],
    additionalProperties: false,
  },
};

/** The full agent-callable user-teams tool catalog. */
export const USER_TEAMS_TOOL_DEFINITIONS: readonly Tool[] = [
  userTeamsCreateTool,
  userTeamsSetStatusTool,
  userTeamsValidateTool,
];

/** Arg shapes for each tool's invoke handler (typed for in-process callers). */
export type UserTeamsCreateInput = z.infer<typeof UserTeamsCreateToolInput>;
export type UserTeamsSetStatusInput = z.infer<typeof UserTeamsSetStatusToolInput>;
export type UserTeamsValidateInput = z.infer<typeof UserTeamsValidateToolInput>;

/**
 * In-process invocation handlers for each tool. Stage 5 wires these to
 * the repo + validator; Stage 4 throws.
 */
export interface UserTeamsToolHandlers {
  create(db: Db, input: UserTeamsCreateInput): UserTeam;
  setStatus(db: Db, input: UserTeamsSetStatusInput, deps: ValidateDeps): UserTeam;
  validate(db: Db, input: UserTeamsValidateInput, deps: ValidateDeps): ValidationResult;
}

/**
 * Default handlers (Stage-4 stubs).
 *
 * **When to use it:** the agent loop's tool dispatcher pulls a handler
 * by tool name and invokes it. Tests inject this object verbatim.
 */
export const userTeamsToolHandlers: UserTeamsToolHandlers = {
  create(_db, _input): UserTeam {
    throw new Error(
      "not implemented (Stage 5): src/agents/user-teams-tools.ts::create",
    );
  },
  setStatus(_db, _input, _deps): UserTeam {
    void (null as unknown as UserTeamStatus);
    throw new Error(
      "not implemented (Stage 5): src/agents/user-teams-tools.ts::setStatus",
    );
  },
  validate(_db, _input, _deps): ValidationResult {
    throw new Error(
      "not implemented (Stage 5): src/agents/user-teams-tools.ts::validate",
    );
  },
};
