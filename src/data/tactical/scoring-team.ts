/**
 * Internal team representation used by the pillar scorers and recommend-leads.
 *
 * The agent / DB / UI use {@link UserTeam} (slot-indexed, ID-only fields). The
 * damage-calc engine uses {@link PokemonSpec} (full display name, ability,
 * nature, sps, moves). The scorers want the latter, so we adapt at the
 * boundary: a `ScoringTeam` is just `{ sets: PokemonSpec[6] }`.
 *
 * Two builders are provided:
 *   - {@link fixtureToScoringTeam}: build from a hand-authored fixture JSON
 *     (the goldens generator + tests use this — no DB roundtrip).
 *   - {@link userTeamToScoringTeam}: production path — looks up species
 *     display names + roster data via the repos.
 */
import type { Db } from "../../db/open";
import type { PokemonSpec, Field } from "../../schemas/calc";
import { PokemonSpecSchema, FieldSchema } from "../../schemas/calc";
import * as roster from "../../db/roster";
import type { UserTeam } from "../../schemas/user-teams";

/**
 * Internal scoring set: a clean {@link PokemonSpec} the engine can consume,
 * paired with the canonical roster id for evidence emission.
 *
 * Note: `species_roster_id` lives on the wrapper, NOT the spec — putting it
 * on the spec would trip the `.strict()` `species_roster_id` rejection inside
 * `damage_calc`'s schema gate.
 */
export interface ScoringSet {
  spec: PokemonSpec;
  /** Lowercase canonical roster id; mirrors `UserSet.species_id`. */
  species_roster_id: string;
}

/** Internal team representation consumed by pillar scorers. */
export interface ScoringTeam {
  /** 1..6 sets — pillars handle short rosters by skipping empties. */
  sets: ScoringSet[];
}

/** Threat panel entry post-resolution into PokemonSpec. */
export interface ScoringThreat {
  species_roster_id: string;
  weight: number;
  spec: PokemonSpec;
}

/** Threat panel post-resolution. */
export interface ScoringPanel {
  entries: ScoringThreat[];
}

const DEFAULT_BOOSTS = {
  atk: 0,
  def: 0,
  spa: 0,
  spd: 0,
  spe: 0,
  acc: 0,
  eva: 0,
} as const;

/**
 * Default neutral field for pillar calls.
 *
 * @returns A schema-validated {@link Field} with no weather, terrain, etc.
 */
export function neutralField(): Field {
  return FieldSchema.parse({
    gameType: "Doubles",
    weather: "None",
    terrain: "None",
    isGravity: false,
    isMagicRoom: false,
    isWonderRoom: false,
    isTrickRoom: false,
    attackerSide: {
      reflect: false,
      lightScreen: false,
      auroraVeil: false,
      tailwind: false,
      friendGuards: 0,
      isHelpingHand: false,
      isBattery: false,
      isPowerSpot: false,
    },
    defenderSide: {
      reflect: false,
      lightScreen: false,
      auroraVeil: false,
      tailwind: false,
      friendGuards: 0,
      isHelpingHand: false,
      isBattery: false,
      isPowerSpot: false,
    },
  });
}

/** Convert tactical-schema {@link ScenarioField} → calc-engine {@link Field}. */
export function scenarioFieldToCalcField(
  sf: { weather?: string; terrain?: string; trick_room?: boolean; tailwind_ours?: boolean; tailwind_theirs?: boolean; light_screen?: boolean; reflect?: boolean; gravity?: boolean } | null | undefined,
): Field {
  const base = neutralField();
  if (!sf) return base;
  const weatherMap: Record<string, "None" | "Sun" | "Rain" | "Sand" | "Snow"> = {
    none: "None", sun: "Sun", rain: "Rain", sand: "Sand", snow: "Snow",
  };
  const terrainMap: Record<string, "None" | "Electric" | "Grassy" | "Misty" | "Psychic"> = {
    none: "None", electric: "Electric", grassy: "Grassy", misty: "Misty", psychic: "Psychic",
  };
  return FieldSchema.parse({
    ...base,
    weather: weatherMap[(sf.weather ?? "none").toLowerCase()] ?? "None",
    terrain: terrainMap[(sf.terrain ?? "none").toLowerCase()] ?? "None",
    isTrickRoom: !!sf.trick_room,
    isGravity: !!sf.gravity,
    attackerSide: {
      ...base.attackerSide,
      tailwind: !!sf.tailwind_ours,
      reflect: !!sf.reflect,
      lightScreen: !!sf.light_screen,
    },
    defenderSide: {
      ...base.defenderSide,
      tailwind: !!sf.tailwind_theirs,
    },
  });
}

/**
 * Fixture row shape — what golden harness JSON files use.
 */
export interface FixtureSet {
  species_roster_id: string;
  species: string;
  item: string | null;
  ability: string;
  nature: PokemonSpec["nature"];
  sps: PokemonSpec["sps"];
  moves: [string, string, string, string];
}

/**
 * Build a {@link ScoringSet} from a fixture row.
 *
 * @param row — Fixture row.
 * @returns Schema-validated {@link ScoringSet}.
 * @throws ZodError on invalid input.
 */
export function fixtureToScoringSet(row: FixtureSet): ScoringSet {
  const candidate = {
    species: row.species,
    level: 50 as const,
    item: row.item,
    ability: row.ability,
    nature: row.nature,
    sps: row.sps,
    moves: row.moves,
    statBoosts: { ...DEFAULT_BOOSTS },
    status: "Healthy" as const,
    hpPercent: 100,
  };
  const spec = PokemonSpecSchema.parse(candidate);
  return { spec, species_roster_id: row.species_roster_id };
}

/**
 * Build a {@link ScoringTeam} from a fixture rows array.
 *
 * @param rows — 1..6 fixture rows.
 * @returns A {@link ScoringTeam} ready to feed into pillar scorers.
 */
export function fixtureToScoringTeam(rows: FixtureSet[]): ScoringTeam {
  return { sets: rows.map(fixtureToScoringSet) };
}

/**
 * Build a {@link ScoringPanel} from a fixture rows array (each carries weight).
 *
 * @param rows — 1..N panel rows. Weights are normalized to sum to 1.0.
 * @returns A {@link ScoringPanel}.
 */
export function fixtureToScoringPanel(
  rows: ReadonlyArray<FixtureSet & { weight: number }>,
): ScoringPanel {
  const sumW = rows.reduce((s, r) => s + r.weight, 0);
  const entries: ScoringThreat[] = rows.map((r) => {
    const set = fixtureToScoringSet(r);
    return {
      species_roster_id: r.species_roster_id,
      weight: r.weight / sumW,
      spec: set.spec,
    };
  });
  // Re-normalize remainder onto last entry for exact 1.0.
  const norm = entries.reduce((s, e) => s + e.weight, 0);
  const last = entries[entries.length - 1];
  if (last) last.weight = last.weight + (1.0 - norm);
  return { entries };
}

/**
 * Map a saved {@link UserTeam} into a {@link ScoringTeam} via roster lookups.
 *
 * **When to use it:** production path. Tests prefer {@link fixtureToScoringTeam}.
 *
 * @param db — Open Reg M-A DB.
 * @param team — Saved user team.
 * @returns A {@link ScoringTeam} with up to 6 fully-resolved sets. Empty slots
 *   (no `species_id`) are skipped silently.
 * @throws Error if a set's species_id isn't in the Reg M-A roster.
 */
export function userTeamToScoringTeam(db: Db, team: UserTeam): ScoringTeam {
  const out: ScoringSet[] = [];
  for (const s of team.sets) {
    if (!s.species_id || !s.ability_id || !s.nature) continue;
    const pokemon = roster.get(db, s.species_id, "RegM-A");
    if (!pokemon) {
      throw new Error(`unknown species in user_team: ${s.species_id}`);
    }
    const moves = [s.move_1_id, s.move_2_id, s.move_3_id, s.move_4_id]
      .filter((m): m is string => !!m);
    if (moves.length === 0) continue;
    while (moves.length < 4) moves.push(moves[0] ?? "Tackle");
    const candidate = {
      species: pokemon.display_name,
      level: 50 as const,
      item: s.item_id,
      ability: s.ability_id,
      nature: (s.nature as PokemonSpec["nature"]) ?? "Hardy",
      sps: {
        hp: s.hp_sps,
        atk: s.atk_sps,
        def: s.def_sps,
        spa: s.spa_sps,
        spd: s.spd_sps,
        spe: s.spe_sps,
      },
      moves: moves.slice(0, 4) as [string, string, string, string],
      statBoosts: { ...DEFAULT_BOOSTS },
      status: "Healthy" as const,
      hpPercent: 100,
    };
    const spec = PokemonSpecSchema.parse(candidate);
    out.push({ spec, species_roster_id: s.species_id });
  }
  return { sets: out };
}

/**
 * Build a {@link ScoringThreat} for any species by reading the most-common
 * (item, ability, nature, sps, moves) tuple from labmaus `team_sets`.
 *
 * **When to use it:** scenario-aware scoring needs ScoringSet data for
 * any species named in `scenario.opposing_preview` — the 15-entry
 * synthetic threat panel doesn't cover all Reg-M-A meta (Sinistcha,
 * Ninetales-Alola, Sneasler, etc.). When a scenario's opposing leads
 * aren't in the panel, fall back to this helper to materialize a real
 * tournament-frequency set on demand.
 *
 * @param db — Open DB handle.
 * @param speciesId — Canonical species roster id.
 * @returns A {@link ScoringThreat} when the species has labmaus data;
 *   `null` when there's no `team_sets` row for it. Weight is 0 (caller
 *   sets a weight from the scenario context).
 * @throws Never — DB / parse errors return `null`.
 */
export function labmausConsensusToScoringThreat(
  db: Db,
  speciesId: string,
): ScoringThreat | null {
  try {
    // Most-common item + ability + nature for this species across all
    // tournament sets. Pick each independently (mode per dimension)
    // because joint-mode would over-fit on rare combos.
    const itemRow = db.$client
      .prepare(
        `SELECT item, COUNT(*) AS n FROM team_sets
          WHERE species_roster_id = ? AND item IS NOT NULL
          GROUP BY item ORDER BY n DESC LIMIT 1`,
      )
      .get(speciesId) as { item: string | null; n: number } | undefined;
    const abilityRow = db.$client
      .prepare(
        `SELECT ability, COUNT(*) AS n FROM team_sets
          WHERE species_roster_id = ? AND ability IS NOT NULL
          GROUP BY ability ORDER BY n DESC LIMIT 1`,
      )
      .get(speciesId) as { ability: string | null; n: number } | undefined;
    const natureRow = db.$client
      .prepare(
        `SELECT nature, COUNT(*) AS n FROM team_sets
          WHERE species_roster_id = ? AND nature IS NOT NULL
          GROUP BY nature ORDER BY n DESC LIMIT 1`,
      )
      .get(speciesId) as { nature: string | null; n: number } | undefined;

    // Most-common 4-move set serialized verbatim (joint mode here is
    // acceptable — movesets cluster more than items/abilities).
    const movesRow = db.$client
      .prepare(
        `SELECT moves_json, COUNT(*) AS n FROM team_sets
          WHERE species_roster_id = ?
          GROUP BY moves_json ORDER BY n DESC LIMIT 1`,
      )
      .get(speciesId) as { moves_json: string; n: number } | undefined;

    if (!abilityRow?.ability || !movesRow?.moves_json) return null;

    let parsedMoves: string[] = [];
    try {
      const arr = JSON.parse(movesRow.moves_json) as unknown;
      if (Array.isArray(arr)) parsedMoves = arr.filter((m): m is string => typeof m === "string");
    } catch {
      return null;
    }
    while (parsedMoves.length < 4) parsedMoves.push(parsedMoves[0] ?? "Tackle");
    const moves = parsedMoves.slice(0, 4) as [string, string, string, string];

    // Pull display_name from the roster — engine prefers human-readable
    // species. Fall back to the species id if the roster table is empty.
    let display = speciesId;
    try {
      const pokemon = roster.get(db, speciesId, "RegM-A");
      if (pokemon) display = pokemon.display_name;
    } catch {
      /* ignore — fall through to id */
    }

    // Default mixed-offensive SPS spread within Reg M-A's 66-point cap.
    // 22/22/22 across attack/special-attack/speed gives a competitive-
    // baseline opposing-lead model without favoring physical or special.
    // Total = 66 (cap exact). Memory `regulation_m_a_stat_rules.md`.
    const sps = { hp: 0, atk: 22, def: 0, spa: 22, spd: 0, spe: 22 };

    const candidate = {
      species: display,
      level: 50 as const,
      item: itemRow?.item ?? null,
      ability: abilityRow.ability,
      nature: ((natureRow?.nature ?? "Hardy") as PokemonSpec["nature"]),
      sps,
      moves,
      statBoosts: { ...DEFAULT_BOOSTS },
      status: "Healthy" as const,
      hpPercent: 100,
    };
    const spec = PokemonSpecSchema.safeParse(candidate);
    if (!spec.success) return null;
    return {
      species_roster_id: speciesId,
      weight: 0,
      spec: spec.data,
    };
  } catch {
    return null;
  }
}
