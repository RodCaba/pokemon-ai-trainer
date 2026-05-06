/**
 * Per-team pokepaste ingest hook called from `scripts/data/ingest-labmaus.ts`.
 * Stage 4 stub — full implementation lands in Stage 5 per
 * `docs/plans/pokepaste-sets.md` §13.
 */

import type { Db } from "../../src/db/open";
import type { PokepasteClient } from "../../src/tools/pokepaste/client";
import type { TransformDeps } from "../../src/tools/pokepaste/transform";

/** Mutable accumulator for per-run failure summaries. */
export interface PokepasteRunSummary {
  team_sets: number;
  pokepaste_404s: Array<{ team_id: string; paste_id: string }>;
  pokepaste_failures: Array<{ team_id: string; paste_id: string; message: string }>;
  ref_validation_failures: Array<{
    team_id: string;
    paste_id: string;
    kind: "item" | "ability" | "move";
    value: string;
    slot: number;
  }>;
}

/** Inputs for {@link processTeamPokepaste}. */
export interface ProcessTeamArgs {
  db: Db;
  client: PokepasteClient;
  transform: TransformDeps;
  team_id: string;
  team_url: string;
  summary: PokepasteRunSummary;
}

/**
 * Process one labmaus team's pokepaste link: fetch, transform, upsert.
 *
 * Stub — throws "not implemented (Stage 5)".
 *
 * **When to use it:** the labmaus ingest's per-team loop. Catches
 * `PokepasteNotFoundError`, `PokepasteParseError`, `PokepasteNetworkError`,
 * and `PokepasteRefValidationError` per-team and logs into the summary;
 * `PokepasteUnknownSpeciesError` is re-raised (fail-loud).
 *
 * @throws Always (Stage 4 stub).
 */
export async function processTeamPokepaste(_args: ProcessTeamArgs): Promise<void> {
  throw new Error("not implemented (Stage 5)");
}
