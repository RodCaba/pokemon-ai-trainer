/**
 * Stage 4 — RED tests for Stage D damage_calc move-bp override
 * (BP1..BP3 — plan §3.1 / §4.2 / §10).
 *
 * Stage 5 adds optional `bp` to `MoveSpec` + threads through `toEngineMove`.
 * These tests fail today because the schema rejects `bp` (unknown key).
 */

import { describe, expect, it } from "vitest";
import { damage_calc } from "../../src/tools/damage-calc";
import { MoveSpecSchema } from "../../src/schemas/calc";
import { CalcInputError } from "../../src/schemas/errors";

const validSps = { hp: 32, atk: 32, def: 0, spa: 0, spd: 0, spe: 0 } as const;

const baseAttacker = {
  species: "Basculegion",
  level: 50,
  item: "Choice Scarf",
  ability: "Adaptability",
  nature: "Adamant",
  sps: validSps,
  moves: ["Last Respects", "Wave Crash", "Aqua Jet", "Liquidation"],
  status: "Healthy" as const,
  hpPercent: 100,
  statBoosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 },
};

const baseDefender = {
  species: "Garchomp",
  level: 50,
  item: "Life Orb",
  ability: "Rough Skin",
  nature: "Adamant",
  sps: { hp: 32, atk: 32, def: 0, spa: 0, spd: 0, spe: 0 } as const,
  moves: ["Earthquake", "Dragon Claw", "Outrage", "Stone Edge"],
  status: "Healthy" as const,
  hpPercent: 100,
  statBoosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 },
};

const validField = {
  gameType: "Doubles" as const,
  weather: "None" as const,
  terrain: "None" as const,
  isGravity: false, isMagicRoom: false, isWonderRoom: false, isTrickRoom: false,
  attackerSide: {
    reflect: false, lightScreen: false, auroraVeil: false, tailwind: false,
    friendGuards: 0, isHelpingHand: false, isBattery: false, isPowerSpot: false,
  },
  defenderSide: {
    reflect: false, lightScreen: false, auroraVeil: false, tailwind: false,
    friendGuards: 0, isHelpingHand: false, isBattery: false, isPowerSpot: false,
  },
};

describe("damage_calc move.bp override (BP1..BP3)", () => {
  it("BP1. Last Respects with bp: 150 produces strictly higher max damage than default", () => {
    const baseInput = {
      schema_version: 1 as const,
      gen: 9 as const,
      format: "RegM-A" as const,
      attacker: baseAttacker,
      defender: baseDefender,
      field: validField,
    };
    const withDefault = damage_calc({
      ...baseInput,
      move: { name: "Last Respects", isCrit: false },
    });
    const withOverride = damage_calc({
      ...baseInput,
      move: { name: "Last Respects", isCrit: false, bp: 150 } as unknown as { name: string; isCrit: boolean },
    });
    expect(withOverride.max_percent).toBeGreaterThan(withDefault.max_percent);
  });

  it("BP2. Earthquake with bp: 100 (equal to engine default) produces same rolls as without bp", () => {
    const baseInput = {
      schema_version: 1 as const,
      gen: 9 as const,
      format: "RegM-A" as const,
      attacker: baseAttacker,
      defender: baseDefender,
      field: validField,
    };
    const withDefault = damage_calc({
      ...baseInput,
      move: { name: "Earthquake", isCrit: false },
    });
    const withOverride = damage_calc({
      ...baseInput,
      move: { name: "Earthquake", isCrit: false, bp: 100 } as unknown as { name: string; isCrit: boolean },
    });
    expect(withOverride.rolls).toEqual(withDefault.rolls);
  });

  it("BP3. MoveSpec schema rejects bp: 0 and bp: 251; accepts 1 and 250", () => {
    expect(MoveSpecSchema.safeParse({ name: "Last Respects", bp: 0 }).success).toBe(false);
    expect(MoveSpecSchema.safeParse({ name: "Last Respects", bp: 251 }).success).toBe(false);
    expect(MoveSpecSchema.safeParse({ name: "Last Respects", bp: 1 }).success).toBe(true);
    expect(MoveSpecSchema.safeParse({ name: "Last Respects", bp: 250 }).success).toBe(true);

    // And via damage_calc the rejection surfaces as CalcInputError.
    expect(() =>
      damage_calc({
        schema_version: 1,
        gen: 9,
        format: "RegM-A",
        attacker: baseAttacker,
        defender: baseDefender,
        move: { name: "Last Respects", isCrit: false, bp: 0 } as unknown as { name: string; isCrit: boolean },
        field: validField,
      }),
    ).toThrow(CalcInputError);
  });
});
