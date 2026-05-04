import { describe, expect, it } from "vitest";
import { CalcInputSchema, CalcResultSchema } from "../../../src/schemas/calc";
import { SpsSpreadSchema } from "../../../src/schemas/sps";

// Test fixtures: a minimal valid CalcInput we can clone and mutate per case.
// Per Reg M-A: no `ivs`, no `tera*`, no `evs` (renamed to `sps`), SPS totals ≤ 66,
// per-stat SPS ≤ 32, integer step 1.
const validSps = { hp: 32, atk: 32, def: 0, spa: 0, spd: 0, spe: 0 } as const; // 64 total, 32 per stat

const validAttacker = {
  species: "Garchomp",
  level: 50,
  item: "Choice Scarf",
  ability: "Rough Skin",
  nature: "Adamant",
  sps: validSps,
  moves: ["Earthquake", "Dragon Claw", "Outrage", "Stone Edge"],
  status: "Healthy",
  hpPercent: 100,
  statBoosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 },
} as const;

const validDefender = {
  species: "Tyranitar",
  level: 50,
  item: "Leftovers",
  ability: "Sand Stream",
  nature: "Careful",
  sps: { hp: 32, atk: 0, def: 0, spa: 0, spd: 32, spe: 0 } as const, // 64 total
  moves: ["Crunch", "Stone Edge", "Earthquake", "Protect"],
  status: "Healthy",
  hpPercent: 100,
  statBoosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 },
} as const;

const validMove = { name: "Earthquake", isCrit: false } as const;

const validField = {
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
} as const;

const validInput = {
  schema_version: 1,
  gen: 9,
  format: "RegM-A",
  attacker: validAttacker,
  defender: validDefender,
  move: validMove,
  field: validField,
} as const;

describe("CalcInputSchema — happy path", () => {
  it("1. accepts a minimal valid CalcInput", () => {
    const result = CalcInputSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });
});

describe("CalcInputSchema — Reg M-A IV ban", () => {
  it("2. rejects payload with `ivs` on attacker (message mentions IVs)", () => {
    const bad = {
      ...validInput,
      attacker: { ...validAttacker, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 } },
    };
    const result = CalcInputSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(" | ");
      expect(messages).toMatch(/IVs are not configurable in Reg M-A/);
    }
  });

  it("3. rejects payload with `ivs` on defender", () => {
    const bad = {
      ...validInput,
      defender: { ...validDefender, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 } },
    };
    const result = CalcInputSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(" | ");
      expect(messages).toMatch(/IVs are not configurable in Reg M-A/);
    }
  });
});

describe("CalcInputSchema — Reg M-A Tera ban", () => {
  it("4. rejects payload with `teraType` on attacker", () => {
    const bad = { ...validInput, attacker: { ...validAttacker, teraType: "Dark" } };
    const result = CalcInputSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(" | ");
      expect(messages).toMatch(/Tera is not legal in Reg M-A/);
    }
  });

  it("5. rejects payload with `teraActive` on attacker", () => {
    const bad = { ...validInput, attacker: { ...validAttacker, teraActive: true } };
    const result = CalcInputSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(" | ");
      expect(messages).toMatch(/Tera is not legal in Reg M-A/);
    }
  });

  it("6. rejects payload with top-level `tera` key", () => {
    const bad = { ...validInput, tera: "Dark" };
    const result = CalcInputSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(" | ");
      expect(messages).toMatch(/Tera is not legal in Reg M-A/);
    }
  });
});

describe("SpsSpreadSchema — Reg M-A 66-point cap", () => {
  it("7. rejects SPS total of 67 (cap is 66)", () => {
    const bad = { hp: 32, atk: 32, def: 3, spa: 0, spd: 0, spe: 0 }; // 67
    const result = SpsSpreadSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(" | ");
      expect(messages).toMatch(/SPS total exceeds Reg M-A 66-point cap/);
    }
  });

  it("8. accepts SPS total of exactly 66", () => {
    const ok = { hp: 32, atk: 32, def: 2, spa: 0, spd: 0, spe: 0 }; // 66
    const result = SpsSpreadSchema.safeParse(ok);
    expect(result.success).toBe(true);
  });
});

describe("SpsSpreadSchema — Reg M-A 32 per-stat cap", () => {
  it("9. rejects per-stat SPS of 33 (per-stat cap is 32)", () => {
    const bad = { hp: 33, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
    const result = SpsSpreadSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(" | ");
      expect(messages).toMatch(/Per-stat SPS cap is 32 in Reg M-A/);
    }
  });

  it("10. accepts per-stat SPS of exactly 32", () => {
    const ok = { hp: 32, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
    const result = SpsSpreadSchema.safeParse(ok);
    expect(result.success).toBe(true);
  });
});

describe("SpsSpreadSchema — Reg M-A integer step 1, non-negative", () => {
  it("11. rejects negative SPS (-1)", () => {
    const bad = { hp: -1, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
    const result = SpsSpreadSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(" | ");
      expect(messages).toMatch(/non-negative/);
    }
  });

  it("12. rejects non-integer SPS (4.5)", () => {
    const bad = { hp: 4.5, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
    const result = SpsSpreadSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(" | ");
      expect(messages).toMatch(/SPS must be integers/);
    }
  });

  it("13. accepts integer SPS step of 1 (e.g. {hp:5,atk:7,...})", () => {
    const ok = { hp: 5, atk: 7, def: 3, spa: 1, spd: 1, spe: 1 };
    const result = SpsSpreadSchema.safeParse(ok);
    expect(result.success).toBe(true);
  });
});

describe("PokemonSpecSchema — strict object", () => {
  it("14. rejects unknown extra key on PokemonSpec", () => {
    const bad = { ...validInput, attacker: { ...validAttacker, frobnicate: "yes" } };
    const result = CalcInputSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(" | ");
      expect(messages).toMatch(/Unrecognized key/);
    }
  });
});

describe("PokemonSpecSchema — VGC level", () => {
  it("15. rejects level !== 50", () => {
    const bad = { ...validInput, attacker: { ...validAttacker, level: 100 } };
    const result = CalcInputSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});

describe("PokemonSpecSchema — moves length", () => {
  it("16. rejects move array of length != 4", () => {
    const bad = {
      ...validInput,
      attacker: { ...validAttacker, moves: ["Wicked Blow", "Close Combat", "Sucker Punch"] },
    };
    const result = CalcInputSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});

describe("PokemonSpecSchema — hpPercent bounds", () => {
  it("17. rejects hpPercent > 100", () => {
    const bad = { ...validInput, attacker: { ...validAttacker, hpPercent: 101 } };
    const result = CalcInputSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("18. rejects hpPercent < 0", () => {
    const bad = { ...validInput, attacker: { ...validAttacker, hpPercent: -1 } };
    const result = CalcInputSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});

describe("PokemonSpecSchema — nature/status enums", () => {
  it("19. rejects unknown nature", () => {
    const bad = { ...validInput, attacker: { ...validAttacker, nature: "Spicy" } };
    const result = CalcInputSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("20. rejects unknown status", () => {
    const bad = { ...validInput, attacker: { ...validAttacker, status: "Confused" } };
    const result = CalcInputSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});

describe("CalcInputSchema — gen and format literals", () => {
  it("21. rejects gen !== 9", () => {
    const bad = { ...validInput, gen: 8 };
    const result = CalcInputSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("22. rejects format !== \"RegM-A\"", () => {
    const bad = { ...validInput, format: "VGC2024" };
    const result = CalcInputSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});

// Minimal valid CalcResult template for slice-3 mutations.
const validResult = {
  schema_version: 1,
  rolls: [312, 314, 316, 320, 324, 326, 330, 332, 336, 338, 342, 344, 348, 350, 354, 368],
  min_percent: 118.6,
  max_percent: 139.9,
  ko_chance: { description: "guaranteed OHKO", chance: 1, n: 1 },
  description: "32 Atk Choice Band Urshifu-S Wicked Blow vs. 0 HP / 0 Def Flutter Mane on a critical hit: 312-368 (118.6 - 139.9%) -- guaranteed OHKO",
  field_echo: validField,
  source: { tool: "@smogon/calc", version: "0.10.0", computed_at: "2026-04-29T00:00:00" },
} as const;

describe("CalcResultSchema — invariants", () => {
  it("23. rejects rolls.length != 16", () => {
    const bad = { ...validResult, rolls: [1, 2, 3] };
    const result = CalcResultSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("24. rejects min_percent > max_percent", () => {
    const bad = { ...validResult, min_percent: 200, max_percent: 100 };
    const result = CalcResultSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(" | ");
      expect(messages).toMatch(/min_percent must be <= max_percent/);
    }
  });

  it("25. rejects description containing \"Tera\"", () => {
    const bad = {
      ...validResult,
      description: "252 SpA Tera Fire Volcarona Flamethrower vs. ...",
    };
    const result = CalcResultSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(" | ");
      expect(messages).toMatch(/description leaked Tera text/);
    }
  });

  it("26. rejects ko_chance.chance > 1", () => {
    const bad = { ...validResult, ko_chance: { description: "?", chance: 1.5, n: 1 } };
    const result = CalcResultSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});
