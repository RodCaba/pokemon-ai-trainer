/**
 * Agent-callable `pikalytics.fetchSpecies` tool. Validates input via
 * {@link PikalyticsFetchSpeciesArgsSchema}, derives the species slug from
 * `roster.get(species_roster_id).display_name` (lowercase), calls the
 * client, calls the transform, returns `{ snapshot, unknown_teammate_names }`.
 *
 * Per plan §17 Q1, the return shape is `{ snapshot, unknown_teammate_names }`
 * so callers (the ingest script in particular) can accumulate run-summary
 * diagnostics without re-deriving them.
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
import {
  transformPikalyticsMarkdown,
  type PikalyticsTransformDeps,
} from "./transform";

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
  args: PikalyticsFetchSpeciesArgs,
  deps: FetchSpeciesDeps,
): Promise<FetchSpeciesResult> {
  const parsed = PikalyticsFetchSpeciesArgsSchema.safeParse(args);
  if (!parsed.success) {
    throw new PikalyticsInputError("invalid args to pikalytics.fetchSpecies", {
      cause: parsed.error,
    });
  }

  const rosterEntry = deps.transform.rosterRepo.get(
    deps.transform.db,
    parsed.data.species_roster_id,
    parsed.data.format,
  );
  if (!rosterEntry) {
    throw new PikalyticsInputError(
      `unknown roster id: ${parsed.data.species_roster_id}`,
      { species_roster_id: parsed.data.species_roster_id },
    );
  }

  // Pikalytics's URL slug is the Showdown id (lowercase, hyphenated). The
  // roster id is already canonical Showdown form, so use it directly.
  const slug = parsed.data.species_roster_id;

  const fetched = await deps.client.fetchSpeciesMarkdown(slug);
  const result = transformPikalyticsMarkdown(
    {
      species_roster_id: parsed.data.species_roster_id,
      raw_markdown: fetched.body,
      source_url: fetched.source_url,
      ai_url: fetched.ai_url,
      fetched_at: new Date().toISOString(),
    },
    deps.transform,
  );
  return result;
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
