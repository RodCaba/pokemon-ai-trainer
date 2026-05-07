/**
 * Stage 4 stub for the agent-callable `pikalytics.fetchSpecies` tool. Real
 * implementation lands in Stage 5 per `docs/plans/pikalytics.md` §2 / §4.1.
 */

import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  PikalyticsFetchSpeciesArgsSchema,
  type PikalyticsFetchSpeciesArgs,
  type PikalyticsSnapshot,
} from "../../schemas/pikalytics";
import { PikalyticsInputError } from "../../schemas/errors";
import type { PikalyticsClient } from "./client";
import type { PikalyticsTransformDeps } from "./transform";

const _ERROR_REFS = [PikalyticsInputError];
void _ERROR_REFS;

/** Deps for {@link fetchSpecies}. */
export interface FetchSpeciesDeps {
  client: PikalyticsClient;
  transform: PikalyticsTransformDeps;
}

/** Result of {@link fetchSpecies} — snapshot + unresolved teammate names (per plan §17 Q1). */
export interface FetchSpeciesResult {
  snapshot: PikalyticsSnapshot;
  unknown_teammate_names: string[];
}

/**
 * Fetch + parse one species's pikalytics snapshot.
 *
 * **When to use it:** the agent surface for "give me the current pikalytics
 * snapshot for X." The ingest script also calls this. Per plan §17 Q1, the
 * return shape is `{ snapshot, unknown_teammate_names }` so callers can
 * accumulate run-summary diagnostics.
 *
 * @param args — `{ format: "RegM-A", species_roster_id }`.
 * @param deps — see {@link FetchSpeciesDeps}.
 * @returns A {@link FetchSpeciesResult}.
 * @throws {PikalyticsInputError} On schema-invalid input or unknown roster id.
 * @throws {PikalyticsNotFoundError} On HTTP 404.
 * @throws {PikalyticsNetworkError} On HTTP exhaustion.
 * @throws {PikalyticsParseError} On parser failure.
 * @throws {PikalyticsTeraLeakError} On `tera_*` leak (programmer bug).
 */
export async function fetchSpecies(
  _args: PikalyticsFetchSpeciesArgs,
  _deps: FetchSpeciesDeps,
): Promise<FetchSpeciesResult> {
  void _args;
  void _deps;
  throw new Error("not implemented (Stage 5): pikalytics.fetchSpecies");
}

/** Anthropic SDK tool definition for `pikalytics_fetch_species`. */
export const pikalyticsFetchSpeciesToolDefinition: Tool = {
  name: "pikalytics_fetch_species",
  description:
    "Fetch and parse the current Pikalytics aggregate-usage snapshot for one Reg M-A species. " +
    "Returns the species's overall usage % (nullable), top teammates with co-occurrence %, and " +
    "frequency breakdowns of items / abilities / moves, all keyed to Pikalytics's own `as_of` " +
    "publication date. Strips any Tera-shaped field unconditionally (Reg M-A has no Terastallization). " +
    "Use this when you need to see a single species's current ladder behavior end-to-end; for ranked " +
    "subsets prefer pikalytics_teammates or pikalytics_usage.",
  input_schema: zodToJsonSchema(PikalyticsFetchSpeciesArgsSchema, {
    target: "openApi3",
    $refStrategy: "none",
  }) as Tool["input_schema"],
};
