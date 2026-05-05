import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  LabmausGetArgsSchema,
  LabmausRawTournamentSchema,
  type LabmausGetArgs,
  type TournamentDetail,
} from "../../schemas/tournament";
import { LabmausInputError, LabmausSchemaError } from "../../schemas/errors";
import type { LabmausClient } from "./client";
import type { SpeciesMapDeps } from "./species-map";
import { transformTournament } from "./transform";

/**
 * Agent-callable tool: fetch one labmaus tournament's full payload.
 *
 * **When to use it:** after `labmaus_list_tournaments` returns ids you want to
 * drill into.
 *
 * @param args — Validated by {@link LabmausGetArgsSchema}.
 * @param deps — Injected `LabmausClient` and `SpeciesMapDeps`.
 * @returns A {@link TournamentDetail} (tournament + teams + species rows).
 * @throws {LabmausInputError} On bad input.
 * @throws {LabmausNetworkError} On HTTP exhaustion.
 * @throws {LabmausSchemaError} On upstream schema drift.
 * @throws {LabmausUnknownSpeciesError} On unmapped species id.
 */
export async function getTournament(
  args: LabmausGetArgs,
  deps: { client: LabmausClient; speciesMap: SpeciesMapDeps },
): Promise<TournamentDetail> {
  const parsedArgs = LabmausGetArgsSchema.safeParse(args);
  if (!parsedArgs.success) {
    throw new LabmausInputError("invalid getTournament args", {
      cause: parsedArgs.error,
      query: args,
    });
  }
  const rawJson = await deps.client.getTournament({ id: parsedArgs.data.id });
  const rawParsed = LabmausRawTournamentSchema.safeParse(rawJson);
  if (!rawParsed.success) {
    throw new LabmausSchemaError("getTournament response failed schema", {
      cause: rawParsed.error,
      query: args,
    });
  }
  const fetchedAt = new Date().toISOString();
  const out = transformTournament(rawParsed.data, fetchedAt, deps.speciesMap);
  return out;
}

/** Anthropic SDK tool definition for `labmaus_get_tournament`. */
export const getTournamentToolDefinition: Tool = {
  name: "labmaus_get_tournament",
  description:
    "Fetch the full payload for a single labmaus tournament: overview, all registered teams with placements/records/countries/pokepaste URLs, and per-team species composition mapped to canonical roster ids. Strips the tera_types field unconditionally (Reg M-A has no Terastallization). Does NOT fetch pokepaste set details.",
  input_schema: zodToJsonSchema(LabmausGetArgsSchema as unknown as z.ZodTypeAny, {
    $refStrategy: "none",
    target: "openApi3",
  }) as Tool["input_schema"],
};
