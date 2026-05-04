import type { CalcInput, PokemonSpec, MoveSpec, Field } from "../../src/schemas/calc";

// Shared valid CalcInput for tests that need to mutate one field at a time.
// Reg M-A compliant: no IVs, no Tera, no `evs` (renamed to `sps`), SPS totals ≤ 66,
// per-stat SPS ≤ 32, integer step 1.
// All species/items/abilities/moves verified present in Champions gen (gen.num=0).

export const validAttacker: PokemonSpec = {
  species: "Garchomp",
  level: 50,
  item: "Choice Scarf", // Choice Band/Specs/Life Orb don't exist in Champions
  ability: "Rough Skin",
  nature: "Adamant",
  sps: { hp: 0, atk: 32, def: 0, spa: 0, spd: 2, spe: 32 }, // 66 total, 32 per stat max
  moves: ["Earthquake", "Dragon Claw", "Outrage", "Stone Edge"],
  status: "Healthy",
  hpPercent: 100,
  no_mega: false,
  statBoosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 },
};

export const validDefender: PokemonSpec = {
  species: "Tyranitar",
  level: 50,
  item: "Leftovers",
  ability: "Sand Stream",
  nature: "Careful",
  sps: { hp: 32, atk: 0, def: 0, spa: 0, spd: 32, spe: 0 }, // 64 total
  moves: ["Crunch", "Stone Edge", "Earthquake", "Protect"],
  status: "Healthy",
  hpPercent: 100,
  no_mega: false,
  statBoosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 },
};

export const validMove: MoveSpec = { name: "Earthquake", isCrit: false };

export const validField: Field = {
  gameType: "Doubles",
  weather: "None",
  terrain: "None",
  isGravity: false,
  isMagicRoom: false,
  isWonderRoom: false,
  isTrickRoom: false,
  attackerSide: {
    reflect: false, lightScreen: false, auroraVeil: false, tailwind: false,
    friendGuards: 0, isHelpingHand: false, isBattery: false, isPowerSpot: false,
  },
  defenderSide: {
    reflect: false, lightScreen: false, auroraVeil: false, tailwind: false,
    friendGuards: 0, isHelpingHand: false, isBattery: false, isPowerSpot: false,
  },
};

export const validInput: CalcInput = {
  schema_version: 1,
  gen: 9,
  format: "RegM-A",
  attacker: validAttacker,
  defender: validDefender,
  move: validMove,
  field: validField,
};
