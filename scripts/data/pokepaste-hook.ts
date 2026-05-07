/**
 * Per-team pokepaste ingest hook called from `scripts/data/ingest-labmaus.ts`.
 * Per `docs/plans/pokepaste-sets.md` §13 — fetches the paste behind a labmaus
 * `team_url`, transforms it, upserts six `team_sets` rows. Per-team errors
 * (404, parse, network, ref-validation, unknown-species) all accumulate into
 * the run summary; the parent ingest never aborts on per-team failures.
 *
 * The original design re-raised `PokepasteUnknownSpeciesError` on the
 * assumption that an unknown species meant a roster gap (our bug). Real
 * labmaus data shows it can also mean a format-illegal team that an
 * unofficial organizer accepted — single bad teams shouldn't reject the
 * other 19 teams in their tournament. The run summary is now the operator's
 * audit log; recurring unknowns indicate a real roster gap.
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
  /**
   * Teams rejected because a parsed species name didn't resolve in the
   * roster (after `normalizeSpeciesName` + alias lookup). Often a
   * format-illegal team an unofficial organizer let through; recurring
   * entries for the same name across multiple paste_ids indicate a real
   * roster gap to fix in `data/reg-m-a/aliases.json` or upstream.
   */
  unknown_species: Array<{ team_id: string; paste_id: string; species: string }>;
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
 * **When to use it:** the labmaus ingest's per-team loop. All known
 * pokepaste error classes (`PokepasteNotFoundError`, `PokepasteParseError`,
 * `PokepasteNetworkError`, `PokepasteRefValidationError`,
 * `PokepasteUnknownSpeciesError`) accumulate into the run summary; the
 * parent ingest does not abort on per-team failures. Unknown error classes
 * still propagate (likely a programmer bug).
 *
 * @param args — see {@link ProcessTeamArgs}.
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
      args.summary.unknown_species.push({
        team_id: args.team_id,
        paste_id,
        species: e.species,
      });
      return;
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
