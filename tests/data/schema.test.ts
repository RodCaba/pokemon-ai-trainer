import { describe, expect, it } from "vitest";
import { PokemonSchema } from "../../src/schemas/pokemon";
import { SampleSetSchema } from "../../src/schemas/sampleSet";
import { ItemSchema, ItemCategorySchema } from "../../src/schemas/item";
import { AbilitySchema } from "../../src/schemas/ability";
import { MoveSchema } from "../../src/schemas/move";
import { InsightSchema } from "../../src/schemas/insight";
import { RosterEntrySchema, SearchHitSchema } from "../../src/schemas/pokemon";

// ---- shared sample inputs ----

const validSource = {
  origin: "@smogon/calc" as const,
  engine_sha: "c1f6bc0fa2e0ee068b9e3061fa68b7db307e6c55",
  source_url: "https://github.com/RodCaba/damage-calc",
  fetched_at: "2026-05-04T00:00:00Z",
};

const validPokemon = {
  schema_version: 1 as const,
  id: "garchomp",
  display_name: "Garchomp",
  aliases: [],
  form_id: null,
  is_mega: false,
  types: ["Dragon", "Ground"],
  base_stats: { hp: 108, atk: 130, def: 95, spa: 80, spd: 85, spe: 102 },
  abilities: { "0": "Sand Veil", "1": null, h: "Rough Skin" },
  movepool: ["earthquake", "dragonclaw", "outrage", "stoneedge"],
  weight_kg: 95.0,
  source: {
    stats_source: "@smogon/calc gen 0",
    movepool_source: "n/a (movepool not modelled in v1)",
    abilities_source: "@pkmn/dex gen 9 (SV-as-proxy)",
    fetched_at: "2026-05-04T00:00:00Z",
    engine_sha: "c1f6bc0fa2e0ee068b9e3061fa68b7db307e6c55",
  },
};

const validSampleSet = {
  schema_version: 1 as const,
  set_name: "Choice Scarf",
  ability: "Rough Skin",
  item: "Choice Scarf",
  nature: "Jolly" as const,
  moves: ["Outrage", "Earthquake", "Stone Edge", "Iron Head"],
  sps: { hp: 0, atk: 32, def: 0, spa: 0, spd: 2, spe: 32 },
  source: {
    set_source: "https://calc.pokemonshowdown.com/js/data/sets/champions.js",
    fetched_at: "2026-05-04T00:00:00Z",
  },
};

const validItem = {
  schema_version: 1 as const,
  id: "choicescarf",
  display_name: "Choice Scarf",
  category: "choice" as const,
  source: validSource,
};

const validAbility = {
  schema_version: 1 as const,
  id: "roughskin",
  display_name: "Rough Skin",
  source: validSource,
};

const validMove = {
  schema_version: 1 as const,
  id: "earthquake",
  display_name: "Earthquake",
  type: "Ground" as const,
  category: "Physical" as const,
  base_power: 100,
  accuracy: 100,
  source: validSource,
};

const validInsight = {
  id: "01H8XGJWBWBAQ4XK7Z4F9DGH4P",
  schema_version: 1 as const,
  claim: "Garchomp commonly leads with Earthquake to pressure Steel + Rock targets.",
  claim_type: "lead" as const,
  subjects: { pokemon: ["garchomp"], formats: ["RegM-A"] as ["RegM-A"] },
  confidence: "medium" as const,
  stance: "supports" as const,
  source: {
    type: "youtube" as const,
    url: "https://youtu.be/example",
    excerpt: "Garchomp leads with Earthquake.",
  },
  extracted_by: {
    model: "claude-opus-4-7",
    prompt_version: "v1",
    extracted_at: "2026-05-04T00:00:00Z",
  },
  embedding_ref: "vec_garchomp_lead_001",
  chunk_id: null,
  phase_tag: null,
};

// ---- PokemonSchema (cases 1–10) ----

describe("PokemonSchema", () => {
  it("1. accepts a minimal valid record", () => {
    expect(PokemonSchema.safeParse(validPokemon).success).toBe(true);
  });

  it("2. rejects empty types array", () => {
    const bad = { ...validPokemon, types: [] };
    expect(PokemonSchema.safeParse(bad).success).toBe(false);
  });

  it("3. rejects types length > 2", () => {
    const bad = { ...validPokemon, types: ["Dragon", "Ground", "Fire"] };
    expect(PokemonSchema.safeParse(bad).success).toBe(false);
  });

  it("4. rejects unknown type string", () => {
    const bad = { ...validPokemon, types: ["Cosmic"] };
    expect(PokemonSchema.safeParse(bad).success).toBe(false);
  });

  it("5. rejects non-positive base_stats.hp (== 0)", () => {
    const bad = { ...validPokemon, base_stats: { ...validPokemon.base_stats, hp: 0 } };
    expect(PokemonSchema.safeParse(bad).success).toBe(false);
  });

  it("6. rejects floating base_stats.atk", () => {
    const bad = { ...validPokemon, base_stats: { ...validPokemon.base_stats, atk: 130.5 } };
    expect(PokemonSchema.safeParse(bad).success).toBe(false);
  });

  it("7. rejects id containing uppercase", () => {
    const bad = { ...validPokemon, id: "Garchomp" };
    expect(PokemonSchema.safeParse(bad).success).toBe(false);
  });

  it("8. rejects id containing space/hyphen", () => {
    expect(PokemonSchema.safeParse({ ...validPokemon, id: "garchomp mega" }).success).toBe(false);
    expect(PokemonSchema.safeParse({ ...validPokemon, id: "garchomp-mega" }).success).toBe(false);
  });

  it("9. accepts aliases empty default", () => {
    const { aliases, ...withoutAliases } = validPokemon;
    void aliases;
    const result = PokemonSchema.safeParse(withoutAliases);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.aliases).toEqual([]);
  });

  it("10. rejects malformed engine_sha", () => {
    const bad = { ...validPokemon, source: { ...validPokemon.source, engine_sha: "not-a-sha" } };
    expect(PokemonSchema.safeParse(bad).success).toBe(false);
  });
});

// ---- SampleSetSchema (cases 11–18) ----

describe("SampleSetSchema", () => {
  it("11. accepts a minimal valid set", () => {
    expect(SampleSetSchema.safeParse(validSampleSet).success).toBe(true);
  });

  it("12. rejects payload with `evs` key (Champions terminology)", () => {
    const bad = { ...validSampleSet, evs: { hp: 0, atk: 32, def: 0, spa: 0, spd: 2, spe: 32 } };
    const result = SampleSetSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("13. error message for `evs` key contains 'SPS (Stat Points)'", () => {
    const bad = { ...validSampleSet, evs: { hp: 0, atk: 32, def: 0, spa: 0, spd: 2, spe: 32 } };
    const result = SampleSetSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(" | ");
      expect(messages).toMatch(/SPS \(Stat Points\)/);
    }
  });

  it("14. rejects payload with `ivs` key", () => {
    const bad = { ...validSampleSet, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 } };
    const result = SampleSetSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(" | ");
      expect(messages).toMatch(/IVs are not configurable in Reg M-A/);
    }
  });

  it("15. rejects moves.length != 4", () => {
    expect(SampleSetSchema.safeParse({ ...validSampleSet, moves: ["Outrage"] }).success).toBe(false);
    expect(
      SampleSetSchema.safeParse({ ...validSampleSet, moves: ["Outrage", "Earthquake", "Stone Edge", "Iron Head", "Protect"] }).success,
    ).toBe(false);
  });

  it("16. rejects sps total of 67 (cap 66)", () => {
    const bad = { ...validSampleSet, sps: { hp: 0, atk: 32, def: 3, spa: 0, spd: 0, spe: 32 } }; // 67
    expect(SampleSetSchema.safeParse(bad).success).toBe(false);
  });

  it("17. rejects per-stat sps of 33 (cap 32)", () => {
    const bad = { ...validSampleSet, sps: { hp: 33, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } };
    expect(SampleSetSchema.safeParse(bad).success).toBe(false);
  });

  it("18. accepts sps total of exactly 66", () => {
    const ok = { ...validSampleSet, sps: { hp: 32, atk: 32, def: 2, spa: 0, spd: 0, spe: 0 } };
    expect(SampleSetSchema.safeParse(ok).success).toBe(true);
  });
});

// ---- ItemSchema + ItemCategorySchema (case 19) ----

describe("ItemSchema / ItemCategorySchema", () => {
  it("19. accepts minimal Item; ItemCategorySchema rejects unknown category", () => {
    expect(ItemSchema.safeParse(validItem).success).toBe(true);
    expect(ItemCategorySchema.safeParse("nonsense").success).toBe(false);
  });
});

// ---- AbilitySchema (case 20) ----

describe("AbilitySchema", () => {
  it("20. accepts minimal record", () => {
    expect(AbilitySchema.safeParse(validAbility).success).toBe(true);
  });
});

// ---- MoveSchema (cases 21–23) ----

describe("MoveSchema", () => {
  it("21. accepts minimal record", () => {
    expect(MoveSchema.safeParse(validMove).success).toBe(true);
  });

  it("22. rejects base_power < 0", () => {
    expect(MoveSchema.safeParse({ ...validMove, base_power: -1 }).success).toBe(false);
  });

  it("23. accepts accuracy === null (always-hit moves)", () => {
    expect(MoveSchema.safeParse({ ...validMove, accuracy: null }).success).toBe(true);
  });
});

// ---- InsightSchema (cases 24–26) ----

describe("InsightSchema", () => {
  it("24. accepts the example from CLAUDE.md §6", () => {
    expect(InsightSchema.safeParse(validInsight).success).toBe(true);
  });

  it("25. rejects claim > 280 chars", () => {
    const longClaim = "x".repeat(281);
    const bad = { ...validInsight, claim: longClaim };
    expect(InsightSchema.safeParse(bad).success).toBe(false);
  });

  it("26. rejects empty subjects.pokemon", () => {
    const bad = { ...validInsight, subjects: { ...validInsight.subjects, pokemon: [] } };
    expect(InsightSchema.safeParse(bad).success).toBe(false);
  });
});

// ---- RosterEntrySchema (case 27) ----

describe("RosterEntrySchema", () => {
  it("27. rejects format != \"RegM-A\"", () => {
    const bad = { id: "garchomp", display_name: "Garchomp", is_mega: false, format: "VGC2024" };
    expect(RosterEntrySchema.safeParse(bad).success).toBe(false);
  });
});

// ---- SearchHitSchema (case 28) ----

describe("SearchHitSchema", () => {
  it("28. rejects score > 1", () => {
    const bad = { id: "garchomp", display_name: "Garchomp", score: 1.5, matched_on: "id" };
    expect(SearchHitSchema.safeParse(bad).success).toBe(false);
  });
});
