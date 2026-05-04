import { z } from "zod";
import { existsSync } from "node:fs";
import type { Db } from "../../src/db/open";
import * as roster from "../../src/db/roster";
import * as itemsRepo from "../../src/db/items";
import * as abilitiesRepo from "../../src/db/abilities";
import * as movesRepo from "../../src/db/moves";
import { open } from "../../src/db/open";
import { CalcInputSchema, PokemonSpecSchema, type CalcInput, type PokemonSpec, NatureSchema, StatusSchema, FieldSchema, MoveSpecSchema } from "../../src/schemas/calc";
import { SpsSpreadSchema } from "../../src/schemas/sps";

// Test-only fixture loader. Lets fixtures reference Champions sample sets by
// (species_id, set_name) so they stay compact, OR specify a full inline spec
// that's validated against the Reg M-A DB at load time. Either way, the loader
// rejects fixtures that reference species/items/abilities/moves not in the DB.

// ---- fixture shape (zod-validated) ----

const StatBoostsSchema = z.object({
  atk: z.number().int().default(0),
  def: z.number().int().default(0),
  spa: z.number().int().default(0),
  spd: z.number().int().default(0),
  spe: z.number().int().default(0),
  acc: z.number().int().default(0),
  eva: z.number().int().default(0),
}).default({ atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 });

const ScenarioPokemonSetRefSchema = z.object({
  kind: z.literal("set"),
  species_id: z.string().regex(/^[a-z0-9]+$/),
  set_name: z.string().min(1),
  // Optional per-scenario overrides layered on top of the curated set.
  hp_percent: z.number().min(0).max(100).optional(),
  status: StatusSchema.optional(),
  stat_boosts: StatBoostsSchema.optional(),
}).strict();

const ScenarioPokemonInlineSchema = z.object({
  kind: z.literal("inline"),
  species: z.string().min(1),
  ability: z.string().min(1),
  item: z.string().min(1).nullable(),
  nature: NatureSchema,
  sps: SpsSpreadSchema,
  moves: z.array(z.string().min(1)).length(4),
  hp_percent: z.number().min(0).max(100).default(100),
  status: StatusSchema.default("Healthy"),
  stat_boosts: StatBoostsSchema,
}).strict();

const ScenarioPokemonSchema = z.discriminatedUnion("kind", [
  ScenarioPokemonSetRefSchema,
  ScenarioPokemonInlineSchema,
]);

const ExpectedSchema = z.object({
  rolls: z.array(z.number().int().nonnegative()).length(16),
  min_percent: z.number(),
  max_percent: z.number(),
  ko_chance: z.object({
    description: z.string(),
    chance: z.number().min(0).max(1),
    n: z.number().int().min(1),
  }),
  description: z.string(),
}).strict();

export const FixtureScenarioSchema = z.object({
  id: z.string().regex(/^[0-9]{3}-[a-z0-9-]+$/),
  schema_version: z.literal(1),
  scenario: z.string().min(1),
  showdown_calc_url: z.string().url().nullable(),
  verified_at: z.string().nullable(),
  verified_by: z.string().nullable(),
  attacker: ScenarioPokemonSchema,
  defender: ScenarioPokemonSchema,
  move: MoveSpecSchema,
  field: FieldSchema,
  expected: ExpectedSchema.nullable(),
}).strict();

export type FixtureScenario = z.infer<typeof FixtureScenarioSchema>;
export type Expected = z.infer<typeof ExpectedSchema>;

// ---- resolver: scenario → CalcInput ----

const DEFAULT_DB_PATH = "data/reg-m-a/db.sqlite";

/**
 * Open the committed Reg M-A DB readonly. Test helper — every test that uses
 * scenarios should call this in `beforeAll` and close in `afterAll`.
 *
 * @throws if the file doesn't exist (run `pnpm data:build:reg-m-a` first).
 */
export function openSharedDb(dbPath: string = DEFAULT_DB_PATH): Db {
  if (!existsSync(dbPath)) {
    throw new Error(`scenario loader requires ${dbPath} — run 'pnpm data:build:reg-m-a' first.`);
  }
  return open(dbPath, { readonly: true });
}

/**
 * Resolve a `FixtureScenario` into a fully-typed `CalcInput`. Looks up sample
 * sets and validates inline specs against the Reg M-A DB.
 *
 * @throws {Error} if any species/item/ability/move referenced isn't in the DB,
 *   or if a `set_ref` points to a non-existent set.
 */
export function resolveScenario(db: Db, scenario: FixtureScenario): CalcInput {
  const candidate = {
    schema_version: 1 as const,
    gen: 9 as const,
    format: "RegM-A" as const,
    attacker: resolvePokemon(db, scenario.attacker, "attacker"),
    defender: resolvePokemon(db, scenario.defender, "defender"),
    move: scenario.move,
    field: scenario.field,
  };
  return CalcInputSchema.parse(candidate);
}

function resolvePokemon(
  db: Db,
  ref: FixtureScenario["attacker"],
  side: "attacker" | "defender",
): PokemonSpec {
  if (ref.kind === "set") {
    return resolveSetRef(db, ref, side);
  }
  return resolveInline(db, ref, side);
}

function resolveSetRef(
  db: Db,
  ref: z.infer<typeof ScenarioPokemonSetRefSchema>,
  side: "attacker" | "defender",
): PokemonSpec {
  const pokemon = roster.get(db, ref.species_id, "RegM-A");
  if (!pokemon) {
    throw new Error(`${side}: species '${ref.species_id}' is not in the Reg M-A roster.`);
  }
  const sets = roster.sets(db, ref.species_id, "RegM-A");
  const matched = sets.find((s) => s.set_name === ref.set_name);
  if (!matched) {
    const available = sets.map((s) => s.set_name).join(", ") || "(none)";
    throw new Error(
      `${side}: no set named "${ref.set_name}" for species '${ref.species_id}'. Available: ${available}`,
    );
  }

  const candidate = {
    species: pokemon.display_name,
    level: 50 as const,
    item: matched.item,
    ability: matched.ability,
    nature: matched.nature,
    sps: matched.sps,
    moves: matched.moves,
    status: ref.status ?? ("Healthy" as const),
    hpPercent: ref.hp_percent ?? 100,
    statBoosts: ref.stat_boosts ?? defaultBoosts(),
  };
  return PokemonSpecSchema.parse(candidate);
}

function resolveInline(
  db: Db,
  ref: z.infer<typeof ScenarioPokemonInlineSchema>,
  side: "attacker" | "defender",
): PokemonSpec {
  // Validate every Reg M-A reference against the DB before handing to the calc.
  if (!roster.has(db, ref.species, "RegM-A")) {
    throw new Error(`${side}: species '${ref.species}' is not in the Reg M-A roster.`);
  }
  if (!abilitiesRepo.has(db, ref.ability, "RegM-A")) {
    throw new Error(`${side}: ability '${ref.ability}' is not in the Reg M-A ability table.`);
  }
  if (ref.item !== null && !itemsRepo.has(db, ref.item, "RegM-A")) {
    throw new Error(`${side}: item '${ref.item}' is not in the Reg M-A item table (Champions item set).`);
  }
  for (const moveName of ref.moves) {
    if (!movesRepo.has(db, moveName, "RegM-A")) {
      throw new Error(`${side}: move '${moveName}' is not in the Reg M-A move table.`);
    }
  }

  const candidate = {
    species: ref.species,
    level: 50 as const,
    item: ref.item,
    ability: ref.ability,
    nature: ref.nature,
    sps: ref.sps,
    moves: ref.moves,
    status: ref.status,
    hpPercent: ref.hp_percent,
    statBoosts: ref.stat_boosts,
  };
  return PokemonSpecSchema.parse(candidate);
}

function defaultBoosts(): PokemonSpec["statBoosts"] {
  return { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 };
}
