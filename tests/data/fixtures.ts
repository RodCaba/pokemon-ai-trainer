import { open, type Db } from "../../src/db/open";
import {
  abilities,
  items,
  moves,
  rosterMembership,
  sampleSets,
  species,
  speciesAbilities,
  speciesStats,
} from "../../src/db/drizzle-schema";

const SRC_POKEMON = JSON.stringify({
  stats_source: "@smogon/calc gen 0 (test fixture)",
  movepool_source: "@smogon/calc gen 0 (test fixture)",
  abilities_source: "@smogon/calc gen 0 (test fixture)",
  fetched_at: "2026-05-04T00:00:00Z",
  engine_sha: "c1f6bc0fa2e0ee068b9e3061fa68b7db307e6c55",
});

const SRC_REF = JSON.stringify({
  origin: "@smogon/calc",
  engine_sha: "c1f6bc0fa2e0ee068b9e3061fa68b7db307e6c55",
  source_url: "https://github.com/RodCaba/damage-calc",
  fetched_at: "2026-05-04T00:00:00Z",
});

const SRC_SET = JSON.stringify({
  set_source: "https://calc.pokemonshowdown.com/js/data/sets/champions.js",
  fetched_at: "2026-05-04T00:00:00Z",
});

const SPECIES_SEED = [
  {
    id: "garchomp",
    displayName: "Garchomp",
    formId: null,
    isMega: 0,
    types: ["Dragon", "Ground"],
    weightKg: 95.0,
    aliases: ["chomp"],
    stats: { hp: 108, atk: 130, def: 95, spa: 80, spd: 85, spe: 102 },
    abilities: { "0": "Sand Veil", "1": null, h: "Rough Skin" },
    movepool: ["earthquake", "dragonclaw", "outrage", "stoneedge", "swordsdance"],
  },
  {
    id: "garchompmega",
    displayName: "Garchomp-Mega",
    formId: "mega",
    isMega: 1,
    types: ["Dragon", "Ground"],
    weightKg: 95.0,
    aliases: ["mega chomp"],
    stats: { hp: 108, atk: 170, def: 115, spa: 120, spd: 95, spe: 92 },
    abilities: { "0": "Sand Force", "1": null, h: null },
    movepool: ["earthquake", "dragonclaw", "outrage", "stoneedge", "ironhead"],
  },
  {
    id: "tyranitar",
    displayName: "Tyranitar",
    formId: null,
    isMega: 0,
    types: ["Rock", "Dark"],
    weightKg: 202.0,
    aliases: [],
    stats: { hp: 100, atk: 134, def: 110, spa: 95, spd: 100, spe: 61 },
    abilities: { "0": "Sand Stream", "1": null, h: "Unnerve" },
    movepool: ["crunch", "stoneedge", "earthquake", "protect"],
  },
  {
    id: "rotomwash",
    displayName: "Rotom-Wash",
    formId: "wash",
    isMega: 0,
    types: ["Electric", "Water"],
    weightKg: 0.3,
    aliases: ["wash rotom"],
    stats: { hp: 50, atk: 65, def: 107, spa: 105, spd: 107, spe: 86 },
    abilities: { "0": "Levitate", "1": null, h: null },
    movepool: ["hydropump", "thunderbolt", "voltswitch", "willowisp"],
  },
  // Two Slowbro forms — used by the ambiguous-form test (slice 3 case 9):
  // bare lookup "Slowbro" must return the base form, not the Galarian form.
  {
    id: "slowbro",
    displayName: "Slowbro",
    formId: null,
    isMega: 0,
    types: ["Water", "Psychic"],
    weightKg: 78.5,
    aliases: [],
    stats: { hp: 95, atk: 75, def: 110, spa: 100, spd: 80, spe: 30 },
    abilities: { "0": "Oblivious", "1": null, h: "Regenerator" },
    movepool: ["protect", "earthquake"],
  },
  {
    id: "slowbrogalar",
    displayName: "Slowbro-Galar",
    formId: "galar",
    isMega: 0,
    types: ["Poison", "Psychic"],
    weightKg: 70.5,
    aliases: ["galarian slowbro"],
    stats: { hp: 95, atk: 100, def: 95, spa: 100, spd: 70, spe: 30 },
    abilities: { "0": "Quick Draw", "1": null, h: "Regenerator" },
    movepool: ["protect", "earthquake"],
  },
] as const;

const SETS_SEED = [
  {
    speciesId: "garchomp",
    setName: "Choice Scarf",
    ability: "Rough Skin",
    item: "Choice Scarf",
    nature: "Jolly",
    moves: ["Outrage", "Earthquake", "Stone Edge", "Iron Head"],
    sps: { hp: 0, atk: 32, def: 0, spa: 0, spd: 2, spe: 32 },
  },
  {
    speciesId: "garchomp",
    setName: "Physical Attacker",
    ability: "Rough Skin",
    item: "Leftovers",
    nature: "Adamant",
    moves: ["Earthquake", "Dragon Claw", "Stone Edge", "Swords Dance"],
    sps: { hp: 0, atk: 32, def: 0, spa: 0, spd: 2, spe: 32 },
  },
  {
    speciesId: "tyranitar",
    setName: "Bulky Sand",
    ability: "Sand Stream",
    item: "Leftovers",
    nature: "Careful",
    moves: ["Crunch", "Stone Edge", "Earthquake", "Protect"],
    sps: { hp: 32, atk: 0, def: 0, spa: 0, spd: 32, spe: 0 },
  },
  {
    speciesId: "rotomwash",
    setName: "Bulky Pivot",
    ability: "Levitate",
    item: "Leftovers",
    nature: "Bold",
    moves: ["Hydro Pump", "Volt Switch", "Will-O-Wisp", "Protect"],
    sps: { hp: 32, atk: 0, def: 32, spa: 0, spd: 2, spe: 0 },
  },
] as const;

const ITEMS_SEED = [
  { id: "choicescarf", displayName: "Choice Scarf", category: "choice" },
  { id: "leftovers", displayName: "Leftovers", category: "held" },
  { id: "focussash", displayName: "Focus Sash", category: "held" },
  { id: "garchompite", displayName: "Garchompite", category: "mega-stone" },
] as const;

const ABILITIES_SEED = [
  { id: "sandveil", displayName: "Sand Veil" },
  { id: "roughskin", displayName: "Rough Skin" },
  { id: "sandforce", displayName: "Sand Force" },
  { id: "sandstream", displayName: "Sand Stream" },
  { id: "unnerve", displayName: "Unnerve" },
  { id: "levitate", displayName: "Levitate" },
] as const;

const MOVES_SEED = [
  { id: "earthquake", displayName: "Earthquake", type: "Ground", category: "Physical", basePower: 100, accuracy: 100 },
  { id: "dragonclaw", displayName: "Dragon Claw", type: "Dragon", category: "Physical", basePower: 80, accuracy: 100 },
  { id: "outrage", displayName: "Outrage", type: "Dragon", category: "Physical", basePower: 120, accuracy: 100 },
  { id: "stoneedge", displayName: "Stone Edge", type: "Rock", category: "Physical", basePower: 100, accuracy: 80 },
  { id: "swordsdance", displayName: "Swords Dance", type: "Normal", category: "Status", basePower: 0, accuracy: null },
  { id: "ironhead", displayName: "Iron Head", type: "Steel", category: "Physical", basePower: 80, accuracy: 100 },
  { id: "crunch", displayName: "Crunch", type: "Dark", category: "Physical", basePower: 80, accuracy: 100 },
  { id: "protect", displayName: "Protect", type: "Normal", category: "Status", basePower: 0, accuracy: null },
  { id: "hydropump", displayName: "Hydro Pump", type: "Water", category: "Special", basePower: 110, accuracy: 80 },
  { id: "thunderbolt", displayName: "Thunderbolt", type: "Electric", category: "Special", basePower: 90, accuracy: 100 },
  { id: "voltswitch", displayName: "Volt Switch", type: "Electric", category: "Special", basePower: 70, accuracy: 100 },
  { id: "willowisp", displayName: "Will-O-Wisp", type: "Fire", category: "Status", basePower: 0, accuracy: 85 },
] as const;

/**
 * Seed an in-memory SQLite DB with a small but representative slice of the Reg M-A
 * roster (3 base species + 1 Mega form + 4 sample sets + ~12 items/abilities/moves).
 *
 * **When to use it:** as a fixture for repository unit tests. Each test should call
 * `seedTinyDb()` to get a fresh handle, run its assertions, then `db.$client.close()`.
 *
 * @returns A Drizzle DB handle bound to an in-memory SQLite, populated and ready to query.
 */
/**
 * Close a `Db` handle if it's still open. Idempotent — safe to call from
 * `afterEach` even when a test has already closed the handle (e.g., the
 * closed-handle behavior tests).
 */
export function closeIfOpen(db: Db): void {
  if (db.$client.open) db.$client.close();
}

export function seedTinyDb(): Db {
  const db = open(":memory:");

  db.$client.transaction(() => {
    for (const sp of SPECIES_SEED) {
      db.insert(species).values({
        id: sp.id,
        displayName: sp.displayName,
        formId: sp.formId,
        isMega: sp.isMega,
        types: JSON.stringify(sp.types),
        weightKg: sp.weightKg,
        aliases: JSON.stringify(sp.aliases),
        movepool: JSON.stringify(sp.movepool),
        sourceJson: SRC_POKEMON,
      }).run();

      const bst = sp.stats.hp + sp.stats.atk + sp.stats.def + sp.stats.spa + sp.stats.spd + sp.stats.spe;
      db.insert(speciesStats).values({ speciesId: sp.id, ...sp.stats, bst }).run();

      db.insert(speciesAbilities).values({ speciesId: sp.id, slot: "0", abilityName: sp.abilities["0"] }).run();
      if (sp.abilities["1"] !== null) {
        db.insert(speciesAbilities).values({ speciesId: sp.id, slot: "1", abilityName: sp.abilities["1"] }).run();
      }
      if (sp.abilities.h !== null) {
        db.insert(speciesAbilities).values({ speciesId: sp.id, slot: "h", abilityName: sp.abilities.h }).run();
      }
      db.insert(rosterMembership).values({
        speciesId: sp.id,
        format: "RegM-A",
        isLegal: 1,
        isMega: sp.isMega,
        notes: null,
      }).run();
    }

    for (const s of SETS_SEED) {
      db.insert(sampleSets).values({
        speciesId: s.speciesId,
        setName: s.setName,
        ability: s.ability,
        item: s.item,
        nature: s.nature,
        movesJson: JSON.stringify(s.moves),
        spsJson: JSON.stringify(s.sps),
        sourceJson: SRC_SET,
      }).run();
    }
    // Note: SampleSet row uses `schema_version: 1` per SampleSetSchema; the
    // assembler in roster.sets() injects it before zod-parsing. The DB doesn't
    // store schema_version directly (no column); it's a domain-layer field.

    for (const i of ITEMS_SEED) {
      db.insert(items).values({ id: i.id, displayName: i.displayName, category: i.category, sourceJson: SRC_REF }).run();
    }
    for (const a of ABILITIES_SEED) {
      db.insert(abilities).values({ id: a.id, displayName: a.displayName, sourceJson: SRC_REF }).run();
    }
    for (const m of MOVES_SEED) {
      db.insert(moves).values({
        id: m.id,
        displayName: m.displayName,
        type: m.type,
        category: m.category,
        basePower: m.basePower,
        accuracy: m.accuracy,
        sourceJson: SRC_REF,
      }).run();
    }
  })();

  return db;
}
