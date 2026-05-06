/**
 * Raw Showdown plaintext → `TeamSet[]`.
 *
 * 1. Parse via `Teams.importTeam` from `@pkmn/sets`.
 * 2. Strip `teraType` from every parsed `PokemonSet` (Reg M-A has no Tera).
 * 3. Rename `evs → sps` at this boundary (Champions domain naming).
 * 4. Validate species/item/ability/moves against the Champions ref tables.
 *    Reject-and-fail per `docs/plans/pokepaste-sets.md` §8.1 — the transform
 *    throws and refuses to produce partial output. Callers (the ingest
 *    hook) catch per-team and continue.
 * 5. Compute the `completeness` tag (`minimal | partial | full`).
 */

import { Teams } from "@pkmn/sets";
import type { PokemonSet } from "@pkmn/sets";
import type { Db } from "../../db/open";
import {
  PokepasteParseError,
  PokepasteRefValidationError,
  PokepasteUnknownSpeciesError,
} from "../../schemas/errors";
import {
  PasteFetchResultSchema,
  type Completeness,
  type Ivs,
  type PasteFetchResult,
  type Sps,
  type TeamSet,
} from "../../schemas/team-set";

/** Repository deps the transform needs to validate every parsed value. */
export interface TransformDeps {
  db: Db;
  rosterRepo: {
    has(db: Db, name: string, format: "RegM-A"): boolean;
    get(db: Db, name: string, format: "RegM-A"): { id: string } | null;
  };
  itemsRepo: {
    has(db: Db, name: string, format: "RegM-A"): boolean;
  };
  abilitiesRepo: {
    has(db: Db, name: string, format: "RegM-A"): boolean;
  };
  movesRepo: {
    has(db: Db, name: string, format: "RegM-A"): boolean;
  };
}

/** Inputs for {@link transformPaste}. */
export interface TransformInput {
  paste_id: string;
  raw_text: string;
  fetched_at: string;
  /** `"labmaus:<tournament_id>:<team_id>"` — used to mint `TeamSet.id`. */
  tournament_team_id: string;
}

/**
 * Test whether a string is non-empty after trimming.
 */
function nonEmpty(s: string | undefined | null): s is string {
  return typeof s === "string" && s.trim().length > 0;
}

/**
 * Compute the completeness tag for a parsed set.
 *
 * - `minimal`: species + item + ≥1 move (ability is recommended but not
 *   load-bearing — fixtures observed in the wild include Sneasler/Aerodactyl
 *   sets with the `Ability:` line omitted).
 * - `partial`: minimal + (sps OR nature).
 * - `full`: minimal + sps + nature.
 *
 * @returns `null` when the set falls below `minimal` (caller must throw).
 */
function classifyCompleteness(args: {
  hasSpecies: boolean;
  hasItem: boolean;
  moveCount: number;
  hasSps: boolean;
  hasNature: boolean;
}): Completeness | null {
  if (!args.hasSpecies || !args.hasItem || args.moveCount < 1) {
    return null;
  }
  if (args.hasSps && args.hasNature) return "full";
  if (args.hasSps || args.hasNature) return "partial";
  return "minimal";
}

function evsToSps(evs: PokemonSet["evs"] | undefined): Sps | null {
  if (!evs) return null;
  return {
    hp: evs.hp ?? 0,
    atk: evs.atk ?? 0,
    def: evs.def ?? 0,
    spa: evs.spa ?? 0,
    spd: evs.spd ?? 0,
    spe: evs.spe ?? 0,
  };
}

function ivsCopy(ivs: PokemonSet["ivs"] | undefined): Ivs | null {
  if (!ivs) return null;
  return {
    hp: ivs.hp ?? 31,
    atk: ivs.atk ?? 31,
    def: ivs.def ?? 31,
    spa: ivs.spa ?? 31,
    spd: ivs.spd ?? 31,
    spe: ivs.spe ?? 31,
  };
}

/**
 * Transform a raw Showdown export into a validated {@link PasteFetchResult}.
 *
 * **When to use it:** the only translation layer between `@pkmn/sets`'s
 * `PokemonSet` shape and our domain `TeamSet`. Strips Tera, renames
 * `evs → sps`, validates against the ref tables, computes completeness.
 *
 * @param input — Paste id, raw text, fetched_at, tournament_team_id.
 * @param deps — Roster + ref-table repos, all keyed `"RegM-A"`.
 * @returns A validated {@link PasteFetchResult}.
 * @throws {PokepasteParseError} On `@pkmn/sets` parse failure / empty team
 *   / completeness < `"minimal"` / SPS cap violation.
 * @throws {PokepasteRefValidationError} On unknown item/ability/move.
 * @throws {PokepasteUnknownSpeciesError} On unknown species roster id.
 */
export function transformPaste(input: TransformInput, deps: TransformDeps): PasteFetchResult {
  const team = Teams.importTeam(input.raw_text);
  if (!team || team.team.length === 0) {
    throw new PokepasteParseError("@pkmn/sets returned no team", {
      paste_id: input.paste_id,
    });
  }

  const sets: TeamSet[] = [];
  for (let slot = 0; slot < team.team.length; slot++) {
    const raw = team.team[slot] as Partial<PokemonSet> | undefined;
    if (!raw) continue;

    // Defense-in-depth Tera strip — the domain schema has no tera_* field
    // either, but this prevents the value from leaking into any debug logs.
    if ("teraType" in raw) {
      delete (raw as Record<string, unknown>).teraType;
    }

    // Strip gender symbol from species before resolving roster id.
    const speciesDisplay = (raw.species ?? "").replace(/[♂♀]/g, "").trim();
    const itemDisplay = nonEmpty(raw.item) ? raw.item : null;
    const abilityDisplay = nonEmpty(raw.ability) ? raw.ability : null;
    const moves = Array.isArray(raw.moves)
      ? raw.moves.filter((m): m is string => nonEmpty(m))
      : [];
    const natureDisplay = nonEmpty(raw.nature) ? raw.nature : null;
    const level = typeof raw.level === "number" ? raw.level : null;

    const sps = evsToSps(raw.evs);
    const ivs = ivsCopy(raw.ivs);
    const hasSps = sps !== null;
    const hasNature = natureDisplay !== null;

    // Completeness gate — drops below minimal triggers a parse error per
    // plan §8 / §6 Q4.
    const completeness = classifyCompleteness({
      hasSpecies: speciesDisplay.length > 0,
      hasItem: itemDisplay !== null,
      moveCount: moves.length,
      hasSps,
      hasNature,
    });
    if (completeness === null) {
      throw new PokepasteParseError(
        `set at slot ${slot} drops below minimal completeness`,
        { paste_id: input.paste_id },
      );
    }

    // Species ref-table validation (different error class from item/ability/move
    // per plan §8 — unknown species fails loud at the ingest layer).
    if (!deps.rosterRepo.has(deps.db, speciesDisplay, "RegM-A")) {
      throw new PokepasteUnknownSpeciesError(
        `unknown species: ${speciesDisplay}`,
        { paste_id: input.paste_id, species: speciesDisplay },
      );
    }
    const rosterEntry = deps.rosterRepo.get(deps.db, speciesDisplay, "RegM-A");
    if (rosterEntry === null) {
      throw new PokepasteUnknownSpeciesError(
        `species not found: ${speciesDisplay}`,
        { paste_id: input.paste_id, species: speciesDisplay },
      );
    }

    // Item / ability / move ref-table validation — reject-and-fail.
    // (Item/ability are guaranteed non-null here because completeness ≥ minimal.)
    const itemValue = itemDisplay as string;
    if (!deps.itemsRepo.has(deps.db, itemValue, "RegM-A")) {
      throw new PokepasteRefValidationError(
        `unknown item: ${itemValue}`,
        { paste_id: input.paste_id, kind: "item", value: itemValue, slot },
      );
    }
    const abilityValue = abilityDisplay;
    if (abilityValue !== null && !deps.abilitiesRepo.has(deps.db, abilityValue, "RegM-A")) {
      throw new PokepasteRefValidationError(
        `unknown ability: ${abilityValue}`,
        { paste_id: input.paste_id, kind: "ability", value: abilityValue, slot },
      );
    }
    for (const m of moves) {
      if (!deps.movesRepo.has(deps.db, m, "RegM-A")) {
        throw new PokepasteRefValidationError(
          `unknown move: ${m}`,
          { paste_id: input.paste_id, kind: "move", value: m, slot },
        );
      }
    }

    const teamSet: TeamSet = {
      schema_version: 1,
      id: `${input.tournament_team_id}:${slot}`,
      tournament_team_id: input.tournament_team_id,
      slot,
      species_roster_id: rosterEntry.id,
      item: itemValue,
      ability: abilityValue,
      level,
      moves,
      sps,
      ivs,
      nature: natureDisplay,
      completeness,
      source: {
        schema_version: 1,
        site: "pokepaste",
        paste_id: input.paste_id,
        source_url: `https://pokepast.es/${input.paste_id}`,
        fetched_at: input.fetched_at,
      },
    };
    sets.push(teamSet);
  }

  // Final validation — schema runs the SPS cap refine and rejects any
  // tera_* leakage.
  const candidate = {
    paste_id: input.paste_id,
    raw_text: input.raw_text,
    sets,
    warnings: [],
    fetched_at: input.fetched_at,
  };
  const parsed = PasteFetchResultSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new PokepasteParseError(
      `paste failed final schema validation: ${parsed.error.message}`,
      { paste_id: input.paste_id, cause: parsed.error },
    );
  }
  return parsed.data;
}
