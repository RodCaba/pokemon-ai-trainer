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
    // Per Stage 6 review item 9 / minor 8: carry a structured cause so
    // debuggers stepping through the stack see the failed lookup context
    // (format + species_roster_id), not a bare message. The lookup itself
    // doesn't throw, so we synthesize the cause here.
    throw new PikalyticsInputError(
      `unknown roster id: ${parsed.data.species_roster_id}`,
      {
        species_roster_id: parsed.data.species_roster_id,
        cause: {
          kind: "roster_lookup_miss",
          format: parsed.data.format,
          species_roster_id: parsed.data.species_roster_id,
        },
      },
    );
  }

  // Pikalytics's URL slug is the Showdown-style hyphenated lowercase form
  // (e.g. `charizard-mega-y`, `ninetales-alola`), which corresponds to our
  // roster's `display_name` lowercased — NOT the no-hyphen `species_roster_id`.
  // Without this transform, single-token species (`garchomp`, `sneasler`)
  // happen to work but every Mega/regional/form variant would 404 in
  // production. Discovered via Stage 5 reviewer flag against `charizardmegay`
  // → `charizard-mega-y`.
  const slug = rosterEntry.display_name.toLowerCase();

  const fetched = await deps.client.fetchSpeciesMarkdown(slug);
  const result = transformPikalyticsMarkdown(
    {
      species_roster_id: parsed.data.species_roster_id,
      raw_markdown: fetched.body,
      source_url: fetched.source_url,
      ai_url: fetched.ai_url,
      // TODO(stage6-deferred): track upstream fetched_at in cache envelope; alongside pokepaste's same defer (memory: labmaus_pokepaste_deferred_todos.md)
      fetched_at: new Date().toISOString(),
    },
    deps.transform,
  );
  return result;
}

// Note: the Anthropic SDK tool definition for `pikalytics_fetch_species`
// lives canonically in `src/db/tool-definitions.ts` (alongside every other
// agent-callable tool). The orphan re-export that previously lived here
// was removed per Stage 6 review item 7.
