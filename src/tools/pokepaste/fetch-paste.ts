/**
 * The agent-callable `pokepaste.fetchPaste` tool. Stage 4 stub.
 */

import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import type { PasteFetchResult, PokepastePasteArgs } from "../../schemas/team-set";
import type { PokepasteClient } from "./client";
import type { TransformDeps } from "./transform";

/** Deps for {@link fetchPaste}. */
export interface FetchPasteDeps {
  client: PokepasteClient;
  transform: TransformDeps;
  /** `"labmaus:<tid>:<extTid>"` — used to mint stable `TeamSet.id`s. */
  tournament_team_id: string;
}

/**
 * Fetch + transform one pokepaste. Stub — throws "not implemented (Stage 5)".
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
  _args: PokepastePasteArgs,
  _deps: FetchPasteDeps,
): Promise<PasteFetchResult> {
  throw new Error("not implemented (Stage 5)");
}

/**
 * Anthropic SDK tool definition for `pokepaste_fetch_paste`. Stage 4
 * placeholder — the real definition lands in Stage 5 alongside
 * `src/db/tool-definitions.ts` updates. Reading this property at module
 * load time throws (rather than at call time) so the import remains
 * valid for tests that import the function alone.
 */
export const fetchPasteToolDefinition: Tool = new Proxy({} as Tool, {
  get(): never {
    throw new Error("not implemented (Stage 5)");
  },
});
