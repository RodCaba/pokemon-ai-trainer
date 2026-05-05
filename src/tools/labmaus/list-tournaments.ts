import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  LabmausListArgsSchema,
  type LabmausListArgs,
  type TournamentSummary,
} from "../../schemas/tournament";
import type { LabmausClient } from "./client";

/**
 * Agent-callable tool: list completed Reg M-A tournaments in a date range.
 *
 * **When to use it:** to discover tournament ids in a window. Drill into one
 * with {@link getTournament}.
 *
 * @param args — Validated by {@link LabmausListArgsSchema}.
 * @param deps — Injected `LabmausClient`.
 * @returns Array of tournament summaries.
 * @throws {LabmausInputError} On bad input.
 * @throws {LabmausNetworkError} On HTTP exhaustion.
 * @throws {LabmausSchemaError} On upstream schema drift.
 */
export async function listTournaments(
  args: LabmausListArgs,
  deps: { client: LabmausClient },
): Promise<TournamentSummary[]> {
  void args;
  void deps;
  throw new Error("not implemented (Stage 5)");
}

/** Anthropic SDK tool definition for `labmaus_list_tournaments`. */
export const listTournamentsToolDefinition: Tool = {
  name: "labmaus_list_tournaments",
  description:
    "List completed Pokemon Champions Reg M-A tournaments in a date range, sourced from labmaus.net. Returns tournament summaries (id, date, name, division, num_players, status). Use this BEFORE labmaus_get_tournament to discover tournament ids in a window.",
  input_schema: zodToJsonSchema(LabmausListArgsSchema as unknown as z.ZodTypeAny, {
    $refStrategy: "none",
    target: "openApi3",
  }) as Tool["input_schema"],
};
