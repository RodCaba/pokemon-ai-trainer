/**
 * The agent-callable `pokepaste.fetchPaste` tool — validates input,
 * fetches the raw paste body via the injected client, and hands it to
 * the transform layer. All errors propagate verbatim so callers (the
 * ingest hook) can dispatch on the concrete subclass.
 */

import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  PasteFetchResultSchema,
  PokepastePasteArgsSchema,
  type PasteFetchResult,
  type PokepastePasteArgs,
} from "../../schemas/team-set";
import { PokepasteInputError } from "../../schemas/errors";
import type { PokepasteClient } from "./client";
import { transformPaste, type TransformDeps } from "./transform";

/** Deps for {@link fetchPaste}. */
export interface FetchPasteDeps {
  client: PokepasteClient;
  transform: TransformDeps;
  /** `"labmaus:<tid>:<extTid>"` — used to mint stable `TeamSet.id`s. */
  tournament_team_id: string;
}

/**
 * Fetch + transform one pokepaste.
 *
 * **When to use it:** the labmaus ingest hook (per-team) calls this
 * after persisting a `tournament_teams` row to ingest the paste behind
 * the `team_url`. Agents may call it directly via the Anthropic SDK
 * tool for parsing-without-persistence use cases.
 *
 * @param args — `{ paste_id }`.
 * @param deps — see {@link FetchPasteDeps}.
 * @returns A validated {@link PasteFetchResult}.
 * @throws {PokepasteInputError} On schema-invalid input.
 * @throws {PokepasteNotFoundError} On HTTP 404.
 * @throws {PokepasteNetworkError} On HTTP exhaustion.
 * @throws {PokepasteParseError} On parser / completeness failure.
 * @throws {PokepasteRefValidationError} On unknown item/ability/move.
 * @throws {PokepasteUnknownSpeciesError} On unknown species.
 */
export async function fetchPaste(
  args: PokepastePasteArgs,
  deps: FetchPasteDeps,
): Promise<PasteFetchResult> {
  const parsed = PokepastePasteArgsSchema.safeParse(args);
  if (!parsed.success) {
    throw new PokepasteInputError("invalid pokepaste args", {
      cause: parsed.error,
    });
  }
  const fetched_at = new Date().toISOString();
  const raw_text = await deps.client.fetchRaw(parsed.data.paste_id);
  return transformPaste(
    {
      paste_id: parsed.data.paste_id,
      raw_text,
      fetched_at,
      tournament_team_id: deps.tournament_team_id,
    },
    deps.transform,
  );
}

/**
 * Anthropic SDK tool definition for `pokepaste_fetch_paste`. The agent
 * surface input is just `{ paste_id }`; persistence is performed by the
 * ingest hook (which supplies `tournament_team_id` as a dep, not an arg).
 */
export const fetchPasteToolDefinition: Tool = {
  name: "pokepaste_fetch_paste",
  description:
    "Fetch and parse a single pokepast.es Showdown export by paste id (hex hash from the URL). " +
    "Returns up to six per-Pokemon sets normalized to our domain shape — species, item, ability, " +
    "level, moves, optionally SPS/IVs/nature — plus a `completeness` tag (`minimal | partial | full`). " +
    "Strips the `Tera Type:` line unconditionally (Reg M-A has no Terastallization). Validates " +
    "item/ability/move against the Champions reference tables; throws PokepasteRefValidationError " +
    "on unknown values.",
  input_schema: zodToJsonSchema(PokepastePasteArgsSchema, {
    target: "openApi3",
    $refStrategy: "none",
  }) as Tool["input_schema"],
};

// Re-export the schema for callers that want to validate output payloads
// independently (e.g. tests, downstream tools).
export { PasteFetchResultSchema };
