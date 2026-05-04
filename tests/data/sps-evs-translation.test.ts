import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseChampionsSets } from "../../src/data/parseChampionsSets";
import { toEnginePokemon } from "../../src/tools/damage-calc/mapping";
import type { PokemonSpec } from "../../src/schemas/calc";

const PARSE_SOURCE = {
  set_source: "https://calc.pokemonshowdown.com/js/data/sets/champions.js",
  fetched_at: "2026-05-04T00:00:00Z",
};

// Real upstream uses abbreviated SPS keys (hp/at/df/sa/sd/sp); the parser
// expands them to our domain's full names (hp/atk/def/spa/spd/spe).
const ABBREV_SPS_SCARF = { hp: 0, at: 32, df: 0, sa: 0, sd: 2, sp: 32 };
const FULL_SPS_SCARF = { hp: 0, atk: 32, def: 0, spa: 0, spd: 2, spe: 32 };

describe("SPS ⇄ EVs terminology gate", () => {
  it("1. parseChampionsSets translates abbreviated SETDEX sps keys to full domain keys (1:1 numeric)", () => {
    const synthetic = {
      Garchomp: {
        "Choice Scarf": {
          ability: "Rough Skin",
          item: "Choice Scarf",
          nature: "Jolly",
          moves: ["Outrage", "Earthquake", "Stone Edge", "Iron Head"],
          sps: ABBREV_SPS_SCARF,
        },
      },
      Tyranitar: {
        "Bulky Sand": {
          ability: "Sand Stream",
          item: "Leftovers",
          nature: "Careful",
          moves: ["Crunch", "Stone Edge", "Earthquake", "Protect"],
          sps: { hp: 32, df: 0, sa: 0, sd: 32, sp: 0 },
        },
      },
    };

    const { rows, skipped } = parseChampionsSets(synthetic, PARSE_SOURCE);
    expect(skipped).toEqual([]);
    expect(rows.length).toBe(2);

    const garchomp = rows.find((r) => r.species_id === "garchomp");
    expect(garchomp?.sample_set.sps).toEqual(FULL_SPS_SCARF);

    const tyranitar = rows.find((r) => r.species_id === "tyranitar");
    expect(tyranitar?.sample_set.sps).toEqual({ hp: 32, atk: 0, def: 0, spa: 0, spd: 32, spe: 0 });
  });

  it("2. parseChampionsSets skips a SETDEX entry that uses the legacy `evs` key (Champions terminology)", () => {
    const bad = {
      Garchomp: {
        "Choice Scarf": {
          ability: "Rough Skin",
          item: "Choice Scarf",
          nature: "Jolly",
          moves: ["Outrage", "Earthquake", "Stone Edge", "Iron Head"],
          // Legacy SV/VGC field name; Champions calls it `sps`.
          evs: ABBREV_SPS_SCARF,
        },
      },
    };
    const { rows, skipped } = parseChampionsSets(bad, PARSE_SOURCE);
    expect(rows).toEqual([]);
    expect(skipped.length).toBe(1);
    expect(skipped[0]?.reason).toMatch(/SPS \(Stat Points\)/);
  });

  it("3. SampleSet.sps round-trips through the calc mapping layer to engine `evs` byte-for-byte", () => {
    // The damage-calc mapping (src/tools/damage-calc/mapping.ts) is the only place
    // that performs the `sps → evs` rename — at the @smogon/calc engine boundary.
    // This test asserts the rename is a 1:1 numeric identity, not a transformation.
    const spec: PokemonSpec = {
      species: "Garchomp",
      level: 50,
      item: "Choice Scarf",
      ability: "Rough Skin",
      nature: "Jolly",
      sps: FULL_SPS_SCARF,
      moves: ["Outrage", "Earthquake", "Stone Edge", "Iron Head"],
      status: "Healthy",
      hpPercent: 100,
      no_mega: false,
      statBoosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 },
    };

    const enginePokemon = toEnginePokemon(spec);
    expect(enginePokemon.evs).toEqual(FULL_SPS_SCARF);
  });

  it("4. parseChampionsSets skips entries whose sps total exceeds 66", () => {
    const bad = {
      Garchomp: {
        "Overflow Set": {
          ability: "Rough Skin",
          item: "Choice Scarf",
          nature: "Jolly",
          moves: ["Outrage", "Earthquake", "Stone Edge", "Iron Head"],
          sps: { hp: 32, at: 32, df: 3, sa: 0, sd: 0, sp: 0 }, // 67
        },
      },
    };
    const { rows, skipped } = parseChampionsSets(bad, PARSE_SOURCE);
    expect(rows).toEqual([]);
    expect(skipped.length).toBe(1);
    expect(skipped[0]?.reason).toMatch(/exceeds Reg M-A 66-point cap/);
  });

  it("5. parseChampionsSets skips entries with per-stat sps > 32", () => {
    const bad = {
      Garchomp: {
        "Per-stat Overflow": {
          ability: "Rough Skin",
          item: "Choice Scarf",
          nature: "Jolly",
          moves: ["Outrage", "Earthquake", "Stone Edge", "Iron Head"],
          sps: { at: 33, hp: 0 },
        },
      },
    };
    const { rows, skipped } = parseChampionsSets(bad, PARSE_SOURCE);
    expect(rows).toEqual([]);
    expect(skipped.length).toBe(1);
    expect(skipped[0]?.reason).toMatch(/Per-stat SPS cap is 32/);
  });

  it("6. parseChampionsSets handles a species with zero sets (empty inner object)", () => {
    const sparse = { Garchomp: {} };
    const { rows, skipped } = parseChampionsSets(sparse, PARSE_SOURCE);
    expect(rows).toEqual([]);
    expect(skipped).toEqual([]);
  });

  it("7. parseChampionsSets produces deterministic row ordering across two runs of the same input", () => {
    const synthetic = {
      Tyranitar: {
        "B Set": { ability: "Sand Stream", item: null, nature: "Careful", moves: ["Crunch", "Stone Edge", "Earthquake", "Protect"], sps: { hp: 32 } },
        "A Set": { ability: "Sand Stream", item: null, nature: "Careful", moves: ["Crunch", "Stone Edge", "Earthquake", "Protect"], sps: { hp: 32 } },
      },
      Garchomp: {
        "Z Set": { ability: "Rough Skin", item: null, nature: "Jolly", moves: ["Outrage", "Earthquake", "Stone Edge", "Iron Head"], sps: { at: 32 } },
      },
    };
    const a = parseChampionsSets(synthetic, PARSE_SOURCE).rows.map((r) => `${r.species_id}/${r.sample_set.set_name}`);
    const b = parseChampionsSets(synthetic, PARSE_SOURCE).rows.map((r) => `${r.species_id}/${r.sample_set.set_name}`);
    expect(a).toEqual(b);
    // Sorted by species_id ascending, then by set_name ascending.
    expect(a).toEqual(["garchomp/Z Set", "tyranitar/A Set", "tyranitar/B Set"]);
  });
});
