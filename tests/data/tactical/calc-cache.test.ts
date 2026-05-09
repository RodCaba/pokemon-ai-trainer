/**
 * TAC-T33..T35a — cross-call calc cache (Q3 binding override §16.1).
 * Stage-4 red.
 */

import { describe, expect, it } from "vitest";
import {
  createCalcCache,
  revalidate,
  type CalcCacheKey,
} from "../../../src/data/tactical/calc-cache";

function makeKey(over: Partial<CalcCacheKey> = {}): CalcCacheKey {
  return {
    attacker_set_hash: "a1",
    defender_set_hash: "d1",
    field_hash: "f1",
    move_id: "Wicked Blow",
    ...over,
  };
}

describe("calc cache (TAC-T33..T35a)", () => {
  it("TAC-T33. cross-call cache: second call hits cache for same (team, panel_as_of)", () => {
    const cache = createCalcCache();
    const before = cache.stats();
    cache.set(makeKey(), {
      schema_version: 1,
      rolls: Array.from({ length: 16 }, () => 100),
      min_percent: 50,
      max_percent: 60,
      ko_chance: { description: "x", chance: 0.5, n: 1 },
      description: "x",
      field_echo: {
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
      },
      source: {
        tool: "@smogon/calc",
        version: "0.0.1",
        computed_at: "2026-05-08T00:00:00Z",
      },
    });
    const got = cache.get(makeKey());
    expect(got).toBeDefined();
    const after = cache.stats();
    expect(after.hits).toBeGreaterThan(before.hits);
  });

  it("TAC-T34. mutating one team set invalidates only the rows touching that set (~85% survives)", () => {
    const cache = createCalcCache();
    // Seed many entries across 6 attacker hashes
    for (let attacker = 0; attacker < 6; attacker++) {
      for (let defender = 0; defender < 15; defender++) {
        cache.set(
          makeKey({
            attacker_set_hash: `a${attacker}`,
            defender_set_hash: `d${defender}`,
          }),
          {} as never,
        );
      }
    }
    const before = cache.size();
    const dropped = cache.invalidateAttackerSet("a3");
    const after = cache.size();
    expect(dropped).toBe(15);
    expect(after).toBeGreaterThanOrEqual(Math.floor(before * 0.8));
  });

  it("TAC-T35a. advancing panel as_of drops all panel-related entries (Q3 §16.1 binding)", () => {
    const cache = createCalcCache();
    for (let defender = 0; defender < 15; defender++) {
      cache.set(makeKey({ defender_set_hash: `d${defender}` }), {} as never);
    }
    const dropped = revalidate(cache, {
      team_id: "01H000000000000000000000T0",
      team_updated_at: "2026-05-08T00:00:00Z",
      panel_as_of: "2026-05-09",
      attacker_set_hashes: ["a0", "a1", "a2", "a3", "a4", "a5"],
      panel_defender_set_hashes: [], // brand new panel — nothing carries over
    });
    expect(dropped).toBeGreaterThan(0);
  });
});
