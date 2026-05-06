/**
 * Per-team pokepaste ingest hook called from `scripts/data/ingest-labmaus.ts`.
 * Per `docs/plans/pokepaste-sets.md` §13 — fetches the paste behind a labmaus
 * `team_url`, transforms it, upserts six `team_sets` rows. Per-team errors
 * (404, parse, network, ref-validation) accumulate into the run summary;
 * `PokepasteUnknownSpeciesError` is re-raised (fail-loud).
 */

import type { Db } from "../../src/db/open";
import type { PokepasteClient } from "../../src/tools/pokepaste/client";
import type { TransformDeps } from "../../src/tools/pokepaste/transform";
import { fetchPaste } from "../../src/tools/pokepaste/fetch-paste";
import * as sets from "../../src/db/sets";
import {
  PokepasteNetworkError,
  PokepasteNotFoundError,
  PokepasteParseError,
  PokepasteRefValidationError,
  PokepasteUnknownSpeciesError,
} from "../../src/schemas/errors";

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
 * Extract the hex paste id from a `https://pokepast.es/<id>` URL.
 *
 * @returns The paste id, or `null` if the URL is not a pokepaste link.
 */
export function extractPasteId(url: string): string | null {
  const m = /^https?:\/\/pokepast\.es\/([a-f0-9]{12,32})(?:\/.*)?$/i.exec(url);
  return m ? m[1]?.toLowerCase() ?? null : null;
}

/**
 * Process one labmaus team's pokepaste link: fetch, transform, upsert.
 *
 * **When to use it:** the labmaus ingest's per-team loop. Catches
 * `PokepasteNotFoundError`, `PokepasteParseError`, `PokepasteNetworkError`,
 * and `PokepasteRefValidationError` per-team and logs into the summary;
 * `PokepasteUnknownSpeciesError` is re-raised (fail-loud).
 *
 * @param args — see {@link ProcessTeamArgs}.
 * @throws {PokepasteUnknownSpeciesError} Re-raised so the parent run aborts.
 */
export async function processTeamPokepaste(args: ProcessTeamArgs): Promise<void> {
  const paste_id = extractPasteId(args.team_url);
  if (paste_id === null) {
    // Not a pokepaste URL — silently skip (per flow §6 Q4 the labmaus row
    // stays without sets; non-pokepaste team_url is a labmaus quirk, not
    // a pokepaste failure mode).
    return;
  }

  // Idempotency: if sets already exist for this team, no-op.
  if (sets.list(args.db, { tournament_team_id: args.team_id }).length > 0) {
    return;
  }

  try {
    const result = await fetchPaste(
      { paste_id },
      {
        client: args.client,
        transform: args.transform,
        tournament_team_id: args.team_id,
      },
    );
    sets.upsertTeamSets(args.db, result.sets);
    args.summary.team_sets += result.sets.length;
  } catch (e) {
    if (e instanceof PokepasteUnknownSpeciesError) {
      // Fail-loud: a missing roster entry is a data integrity issue.
      throw e;
    }
    if (e instanceof PokepasteNotFoundError) {
      args.summary.pokepaste_404s.push({ team_id: args.team_id, paste_id });
      return;
    }
    if (e instanceof PokepasteRefValidationError) {
      args.summary.ref_validation_failures.push({
        team_id: args.team_id,
        paste_id,
        kind: e.kind,
        value: e.value,
        slot: e.slot,
      });
      return;
    }
    if (e instanceof PokepasteParseError || e instanceof PokepasteNetworkError) {
      args.summary.pokepaste_failures.push({
        team_id: args.team_id,
        paste_id,
        message: (e as Error).message,
      });
      return;
    }
    // Anything else is fail-loud.
    throw e;
  }
}
