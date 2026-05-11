import { createRequire } from "node:module";
import { Generations, Pokemon, Move, Field, toID } from "@smogon/calc";
import type { Weather, Terrain, StatusName } from "@smogon/calc/dist/data/interface";
import type {
  CalcInput,
  Field as DomainField,
  PokemonSpec,
  MoveSpec,
} from "../../schemas/calc";

/**
 * The `@smogon/calc` generation slot used by all calc paths in this project.
 *
 * Set to `0` (Champions). The library convention is `[Champions, RBY, GSC, ADV, DPP, BW, XY, SM, SS, SV]`,
 * so SV is `9` and Champions is `0`. We migrated 2026-05-04 — see `docs/flows/pokemon-roster-db.md` §2.6
 * and memory `smogon_calc_champions_source.md`.
 *
 * Used by both the dex lookups (`Generations.get(ENGINE_GEN).{species,moves,abilities,items}`)
 * and the engine call (`runEngine(ENGINE_GEN, ...)`).
 */
export const ENGINE_GEN = 0 as const;

const require_ = createRequire(import.meta.url);
const calcPkg = require_("@smogon/calc/package.json") as { version: string };
/**
 * Semver of the installed `@smogon/calc` package, read from its `package.json` at module load.
 *
 * Populates `CalcResult.source.version` so every result is reproducible against a specific
 * engine build. Pinned via the `RodCaba/damage-calc` fork (see flow doc §2.6); the underlying
 * `package.json` still reports `0.11.0` because that's the latest published tag — the fork
 * adds Champions support on top without bumping the version.
 */
export const ENGINE_VERSION: string = calcPkg.version;

// Reg M-A invariant: IVs are not user-configurable; the engine always sees 31s.
const REG_MA_IVS = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 } as const;

// Domain status enum → @smogon/calc short codes (empty string = healthy).
const STATUS_TO_ENGINE: Record<PokemonSpec["status"], "" | StatusName> = {
  Healthy: "",
  Burned: "brn",
  Paralyzed: "par",
  Poisoned: "psn",
  "Badly Poisoned": "tox",
  Asleep: "slp",
  Frozen: "frz",
};

// Domain terrain enum → engine string (engine appends " Terrain" to non-None values).
function mapTerrain(t: DomainField["terrain"]): Terrain | undefined {
  return t === "None" ? undefined : (`${t} Terrain` as Terrain);
}

function mapWeather(w: DomainField["weather"]): Weather | undefined {
  return w === "None" ? undefined : (w as Weather);
}

/**
 * Translate a domain `PokemonSpec` into a `@smogon/calc` `Pokemon` instance.
 *
 * Anti-corruption layer: this is the only place in the codebase that touches the engine's
 * `Pokemon` constructor. Reg M-A invariants are enforced here regardless of upstream defaults:
 * IVs are always `{31×6}` (Reg M-A has no user-configurable IVs), Tera fields are never set.
 *
 * **When to use it:** internal — called by `damage_calc` between schema validation and the
 * `runEngine` call. Tools and agents should not call this directly; use `damage_calc`.
 *
 * @param spec — A schema-validated `PokemonSpec` (species, level, item|null, ability,
 *   nature, sps, moves, statBoosts, status, hpPercent). Caller is responsible for
 *   pre-validating; this function does not re-run schema checks.
 *
 * @returns A `@smogon/calc` `Pokemon` instance with stats computed at `level: 50`.
 *   - `ivs` is forced to `{hp:31,atk:31,def:31,spa:31,spd:31,spe:31}` regardless of input.
 *   - `sps` (Stat Points) → engine `evs` field (1:1 numeric translation, just renamed).
 *     Already validated ≤ 66 total / ≤ 32 per stat by the schema.
 *   - **Auto-Mega-evolution.** If `spec.item` is a Mega Stone (e.g. Garchompite,
 *     Heracronite) and `spec.no_mega` is not true, the engine receives the Mega
 *     species (e.g. `Garchomp-Mega`) and the Mega's slot-0 ability (e.g. `Sand
 *     Force`). To keep the base form despite holding a Mega Stone — useful when
 *     a team carries two Mega-eligible Pokemon and only one Megas per battle —
 *     set `spec.no_mega: true`.
 *   - `item: null` → `undefined` to the engine.
 *   - `statBoosts.acc` and `.eva` are dropped (engine doesn't track them for damage).
 *   - `status` is mapped from domain enum (`"Burned"`) to engine code (`"brn"`).
 *   - When `hpPercent < 100`, the engine is constructed twice: first to read maxHP,
 *     then again with `originalCurHP = round(maxHP * hpPercent / 100)`.
 *
 * @throws Anything `@smogon/calc`'s `Pokemon` constructor throws — typically passes through
 *   to `damage_calc`'s outer try/catch which re-wraps in `CalcEngineError`.
 */
export function toEnginePokemon(spec: PokemonSpec): Pokemon {
  // Engine boosts only track main 5 stats + hp; acc/eva from our schema are dropped here
  // (they don't affect damage rolls — they belong to the move-accuracy layer, out of scope).
  const engineBoosts = {
    hp: 0,
    atk: spec.statBoosts.atk,
    def: spec.statBoosts.def,
    spa: spec.statBoosts.spa,
    spd: spec.statBoosts.spd,
    spe: spec.statBoosts.spe,
  };

  // Auto-Mega: if `item` is a Mega Stone whose `megaStone` map points at
  // `spec.species`, swap to the Mega form (and use the Mega's slot-0 ability).
  // Honors `no_mega: true` for the "Mega-Stone-but-don't-evolve-this-turn" case
  // (e.g., a team carrying two Mega-eligible Pokemon, only one Megas per battle).
  const { species: engineSpecies, ability: engineAbility } = resolveMegaForm(spec);

  const opts: NonNullable<ConstructorParameters<typeof Pokemon>[2]> = {
    level: spec.level,
    ability: engineAbility,
    nature: spec.nature,
    evs: spec.sps, // domain → engine boundary: SPS (Champions) ⇄ EVs (engine API)
    ivs: { ...REG_MA_IVS },
    boosts: engineBoosts,
    status: STATUS_TO_ENGINE[spec.status],
    // intentionally NO teraType / isTera — Reg M-A has no Tera
  };

  if (spec.item !== null) {
    opts.item = spec.item;
  }

  // Construct first to compute maxHP, then re-construct with derived curHP.
  // (Engine's curHP defaults to maxHP, which is what we want at hpPercent=100.)
  if (spec.hpPercent < 100) {
    const probe = new Pokemon(ENGINE_GEN, engineSpecies, opts);
    const curHP = Math.round(probe.maxHP() * (spec.hpPercent / 100));
    return new Pokemon(ENGINE_GEN, engineSpecies, { ...opts, originalCurHP: curHP });
  }

  return new Pokemon(ENGINE_GEN, engineSpecies, opts);
}

const CHAMP_GEN = Generations.get(ENGINE_GEN);

/**
 * Apply auto-Mega-evolution at the engine boundary.
 *
 * Default behavior: when `spec.item` is a Mega Stone whose `megaStone` map
 * points at `spec.species`, return the Mega form's name + slot-0 ability.
 * Set `spec.no_mega: true` to opt out (use case: a team with two Mega-eligible
 * Pokemon — only one can Mega-evolve per battle).
 *
 * @returns `{ species, ability }` to pass to the engine constructor.
 */
function resolveMegaForm(spec: PokemonSpec): { species: string; ability: string } {
  if (spec.no_mega || spec.item === null) {
    return { species: spec.species, ability: spec.ability };
  }
  const itemRecord = CHAMP_GEN.items.get(toID(spec.item)) as
    | { megaStone?: Record<string, string> }
    | undefined;
  const megaName = itemRecord?.megaStone?.[spec.species];
  if (!megaName) {
    return { species: spec.species, ability: spec.ability };
  }
  const megaSpecies = CHAMP_GEN.species.get(toID(megaName));
  if (!megaSpecies) {
    // Mega Stone says this species transforms, but the engine doesn't have the
    // Mega form. Bail to base — calc will be slightly off, but better than
    // crashing. (Should be unreachable in Champions: every Mega Stone has a form.)
    return { species: spec.species, ability: spec.ability };
  }
  const megaAbility = (megaSpecies.abilities as { 0?: string } | undefined)?.["0"];
  return {
    species: megaName,
    ability: megaAbility ?? spec.ability,
  };
}

/**
 * Translate a domain `MoveSpec` into a `@smogon/calc` `Move` instance.
 *
 * **When to use it:** internal — called by `damage_calc`.
 *
 * @param spec — Schema-validated `MoveSpec` (`name`, `isCrit`, optional `hits` override).
 *   The schema rejects any move named "Tera Blast" (Reg M-A bans it).
 *
 * @returns A `@smogon/calc` `Move` instance configured for the Champions gen.
 *   - `isCrit` flows through (forces a guaranteed crit when `true`).
 *   - `hits` only set when explicitly provided; otherwise the engine picks the expected
 *     count for variable multi-hit moves.
 */
export function toEngineMove(spec: MoveSpec): Move {
  const opts: NonNullable<ConstructorParameters<typeof Move>[2]> = {
    isCrit: spec.isCrit,
  };
  if (spec.hits !== undefined) {
    opts.hits = spec.hits;
  }
  if (spec.bp !== undefined) {
    // Override the engine's stored base power. The engine's `Move`
    // constructor merges `options.overrides` over the dex's move data via
    // `extend(true, {name}, gen.moves.get(toID(name)), options.overrides)`,
    // so `basePower` lands as `data.basePower` → `this.bp`.
    opts.overrides = { basePower: spec.bp };
  }
  return new Move(ENGINE_GEN, spec.name, opts);
}

/**
 * Translate a domain `Field` (with `SideConditions`) into a `@smogon/calc` `Field` instance.
 *
 * **When to use it:** internal — called by `damage_calc`.
 *
 * @param field — Schema-validated domain field. Includes `weather`, `terrain`, room flags,
 *   plus `attackerSide` and `defenderSide` `SideConditions`.
 *
 * @returns A `@smogon/calc` `Field` with side flags rewritten to engine names
 *   (`reflect → isReflect`, `lightScreen → isLightScreen`, etc.). Notable mappings:
 *   - `weather: "None"` → `undefined`; otherwise the literal string ("Sun", "Rain", ...).
 *   - `terrain: "Electric"` → `"Electric Terrain"` (engine appends " Terrain").
 *   - `friendGuards: count >= 1` → `isFriendGuard: true`. Engine doesn't model 2 stacking
 *     Friend Guards; we lose the multi-FG case here. Documented limitation.
 *   - `isTrickRoom`: NOT forwarded — Trick Room is not a damage modifier in `@smogon/calc 0.10/0.11`,
 *     it's a turn-order mechanic. We keep it in the domain for echo, but the engine ignores it.
 */
export function toEngineField(field: DomainField): Field {
  const mapSide = (s: DomainField["attackerSide"]) => ({
    isReflect: s.reflect,
    isLightScreen: s.lightScreen,
    isAuroraVeil: s.auroraVeil,
    isTailwind: s.tailwind,
    isFriendGuard: s.friendGuards >= 1,
    isHelpingHand: s.isHelpingHand,
    isBattery: s.isBattery,
    isPowerSpot: s.isPowerSpot,
  });

  // Note: Trick Room is not a damage modifier in @smogon/calc 0.10.0 — it's a
  // turn-order mechanic. We keep `isTrickRoom` in the domain Field for echo
  // purposes but do not forward it to the engine.
  return new Field({
    gameType: field.gameType,
    weather: mapWeather(field.weather),
    terrain: mapTerrain(field.terrain),
    isGravity: field.isGravity,
    isMagicRoom: field.isMagicRoom,
    isWonderRoom: field.isWonderRoom,
    attackerSide: mapSide(field.attackerSide),
    defenderSide: mapSide(field.defenderSide),
  });
}

export type { CalcInput };
