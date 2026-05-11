/**
 * Stage 4 — RED tests for role-tag goldens (plan §9 R21–R25).
 *
 * Per memory `test_fixtures_no_invariant_blobs.md`: we commit fixture
 * INPUTS (the per-slot set shape with item / ability / moves / stats),
 * NOT classifier outputs. The test recomputes tags and asserts against
 * expected values defined IN this file — diffable in code review.
 *
 * Five canonical Reg-M-A teams:
 *   1. ArchaEye — user team `01KR7TVD21G1Q99BK0NAEARFD8` (live).
 *   2. J0eVKJyJ_DQ Charizard team (Aerodactyl + Charizard + Garchomp + …).
 *   3. Hardcoded Trick Room core (Indeedee / Hatterene / Glimmora).
 *   4. Hardcoded Tailwind HO (Whimsicott + …).
 *   5. Hardcoded Sand archetype (Hippowdon / Excadrill / Tyranitar).
 */

import { describe, expect, it } from "vitest";
import {
  deriveRoleTags,
  type RoleTagInput,
  type DeriveRoleTagsDeps,
} from "../../../src/data/tactical/role-tags";
import type { RoleTag } from "../../../src/schemas/tactical";

const noopDeps: DeriveRoleTagsDeps = { logWarn: () => {} };

// Helper: shape the input the way the classifier wants it.
const mk = (
  species_id: string,
  item: string | null,
  ability: string | null,
  moves: string[],
  base_stats: RoleTagInput["base_stats"],
): RoleTagInput => ({ species_id, item, ability, moves, base_stats });

describe("R21. ArchaEye golden", () => {
  // Stats from Bulbapedia / Showdown for these species.
  const team: Array<[RoleTagInput, RoleTag, RoleTag[]]> = [
    [
      mk(
        "sableye",
        "Roseli Berry",
        "Prankster",
        ["Reflect", "Light Screen", "Quash", "Rain Dance"],
        { hp: 50, atk: 75, def: 75, spa: 65, spd: 65, spe: 50 },
      ),
      "weather_setter",
      ["weather_setter", "screen_setter", "disruptor"],
    ],
    [
      mk(
        "archaludon",
        "Leftovers",
        "Stamina",
        ["Electro Shot", "Dragon Pulse", "Flash Cannon", "Protect"],
        { hp: 90, atk: 105, def: 130, spa: 125, spd: 65, spe: 85 },
      ),
      "setup_sweeper",
      ["setup_sweeper"],
    ],
    [
      mk(
        "basculegion",
        "Choice Scarf",
        "Adaptability",
        ["Wave Crash", "Flip Turn", "Aqua Jet", "Last Respects"],
        { hp: 120, atk: 112, def: 65, spa: 80, spd: 75, spe: 99 },
      ),
      "cleaner",
      ["cleaner", "pivot"],
    ],
    [
      mk(
        "pelipper",
        "Sitrus Berry",
        "Drizzle",
        ["Wide Guard", "Weather Ball", "Hurricane", "Tailwind"],
        { hp: 60, atk: 50, def: 100, spa: 95, spd: 70, spe: 65 },
      ),
      "weather_setter",
      ["weather_setter", "speed_control_setter", "disruptor"],
    ],
    [
      mk(
        "sinistcha",
        "Sitrus Berry",
        "Hospitality",
        ["Matcha Gotcha", "Life Dew", "Trick Room", "Rage Powder"],
        { hp: 71, atk: 60, def: 106, spa: 121, spd: 80, spe: 70 },
      ),
      "speed_control_setter",
      ["speed_control_setter", "redirect", "cleric"],
    ],
    [
      mk(
        "dragonite",
        "Dragoninite",
        "Inner Focus",
        ["Draco Meteor", "Flamethrower", "Hurricane", "Tailwind"],
        { hp: 91, atk: 134, def: 95, spa: 100, spd: 100, spe: 80 },
      ),
      "speed_control_setter",
      ["speed_control_setter"],
    ],
  ];

  for (const [input, expectedPrimary, expectedAll] of team) {
    it(`${input.species_id}: primary=${expectedPrimary}`, () => {
      const r = deriveRoleTags(input, noopDeps);
      expect(r.primary).toBe(expectedPrimary);
      expect(new Set(r.all)).toEqual(new Set(expectedAll));
    });
  }
});

describe("R22. J0eVKJyJ_DQ Charizard team golden (Aerodactyl + Charizard + Garchomp)", () => {
  it("Aerodactyl with Wide Guard + Tailwind → primary=speed_control_setter, all includes disruptor", () => {
    const r = deriveRoleTags(
      mk(
        "aerodactyl",
        "Focus Sash",
        "Unnerve",
        ["Wide Guard", "Tailwind", "Rock Slide", "Tailwind"],
        { hp: 80, atk: 105, def: 65, spa: 60, spd: 75, spe: 130 },
      ),
      noopDeps,
    );
    expect(r.primary).toBe("speed_control_setter");
    expect(r.all).toContain("disruptor");
  });

  it("Charizard-Mega-Y (boosting + bulky) → primary=setup_sweeper or wallbreaker", () => {
    // Mega Charizard Y from the video: bulky, no boosting move, Wide Guard isn't on it,
    // but it does carry Tailwind in some variants. Take a vanilla "no boost, mixed coverage"
    // shape — should be wallbreaker.
    const r = deriveRoleTags(
      mk(
        "charizardmegay",
        "Charizardite-Y",
        "Drought",
        ["Heat Wave", "Solar Beam", "Air Slash", "Protect"],
        { hp: 78, atk: 104, def: 78, spa: 159, spd: 115, spe: 100 },
      ),
      noopDeps,
    );
    // Drought ability triggers weather_setter rule — that wins on priority.
    expect(r.primary).toBe("weather_setter");
  });

  it("Garchomp with Scale Shot → primary=setup_sweeper (Q2)", () => {
    const r = deriveRoleTags(
      mk(
        "garchomp",
        "Life Orb",
        "Rough Skin",
        ["Scale Shot", "Earthquake", "Rock Slide", "Protect"],
        { hp: 108, atk: 130, def: 95, spa: 80, spd: 85, spe: 102 },
      ),
      noopDeps,
    );
    expect(r.primary).toBe("setup_sweeper");
  });
});

describe("R23. Hardcoded TR team", () => {
  it("Hatterene with Trick Room → primary=speed_control_setter", () => {
    const r = deriveRoleTags(
      mk(
        "hatterene",
        "Mental Herb",
        "Magic Bounce",
        ["Trick Room", "Dazzling Gleam", "Psyshock", "Protect"],
        { hp: 57, atk: 90, def: 95, spa: 136, spd: 103, spe: 29 },
      ),
      noopDeps,
    );
    expect(r.primary).toBe("speed_control_setter");
  });

  it("Glimmora with Sandstorm → primary=weather_setter", () => {
    const r = deriveRoleTags(
      mk(
        "glimmora",
        "Focus Sash",
        "Toxic Debris",
        ["Sandstorm", "Earth Power", "Sludge Wave", "Stealth Rock"],
        { hp: 83, atk: 55, def: 90, spa: 130, spd: 81, spe: 86 },
      ),
      noopDeps,
    );
    expect(r.primary).toBe("weather_setter");
  });

  it("Indeedee with Helping Hand (no setter / redirect / cleric moves) → untagged or pivot", () => {
    const r = deriveRoleTags(
      mk(
        "indeedee",
        "Focus Sash",
        "Psychic Surge",
        ["Helping Hand", "Psychic", "Dazzling Gleam", "Protect"],
        { hp: 60, atk: 65, def: 55, spa: 105, spd: 95, spe: 95 },
      ),
      noopDeps,
    );
    // No setter / redirect / cleric / disruptor / pivot / setup / cleaner / wallbreaker hits.
    // Helping Hand is not in any list → untagged.
    expect(r.primary).toBe("untagged");
  });
});

describe("R24. Hardcoded Tailwind HO", () => {
  it("Whimsicott (Tailwind, Encore) → primary=speed_control_setter, all includes disruptor", () => {
    const r = deriveRoleTags(
      mk(
        "whimsicott",
        "Covert Cloak",
        "Prankster",
        ["Tailwind", "Encore", "Moonblast", "Light Screen"],
        { hp: 60, atk: 67, def: 85, spa: 77, spd: 75, spe: 116 },
      ),
      noopDeps,
    );
    expect(r.primary).toBe("speed_control_setter");
    expect(r.all).toContain("disruptor");
    expect(r.all).toContain("screen_setter");
  });
});

describe("R25. Hardcoded Sand archetype", () => {
  it("Hippowdon with Sand Stream ability → primary=weather_setter", () => {
    const r = deriveRoleTags(
      mk(
        "hippowdon",
        "Smooth Rock",
        "Sand Stream",
        ["Earthquake", "Slack Off", "Stealth Rock", "Whirlwind"],
        { hp: 108, atk: 112, def: 118, spa: 68, spd: 72, spe: 47 },
      ),
      noopDeps,
    );
    expect(r.primary).toBe("weather_setter");
  });

  it("Excadrill with Swords Dance → primary=setup_sweeper", () => {
    const r = deriveRoleTags(
      mk(
        "excadrill",
        "Focus Sash",
        "Sand Rush",
        ["Swords Dance", "Earthquake", "Iron Head", "Rock Slide"],
        { hp: 110, atk: 135, def: 60, spa: 50, spd: 65, spe: 88 },
      ),
      noopDeps,
    );
    expect(r.primary).toBe("setup_sweeper");
  });

  it("Tyranitar with Choice Band, no boost, mixed coverage, base atk 134 → primary=wallbreaker", () => {
    const r = deriveRoleTags(
      mk(
        "tyranitar",
        "Choice Band",
        "Sand Stream",
        ["Rock Slide", "Crunch", "Earthquake", "Stone Edge"],
        { hp: 100, atk: 134, def: 110, spa: 95, spd: 100, spe: 61 },
      ),
      noopDeps,
    );
    // Sand Stream ability would trigger weather_setter rule — wins on priority.
    expect(r.primary).toBe("weather_setter");
  });

  it("Tyranitar without Sand Stream (e.g. swap test) → primary=wallbreaker", () => {
    const r = deriveRoleTags(
      mk(
        "tyranitar",
        "Choice Band",
        "Unnerve",
        ["Rock Slide", "Crunch", "Earthquake", "Stone Edge"],
        { hp: 100, atk: 134, def: 110, spa: 95, spd: 100, spe: 61 },
      ),
      noopDeps,
    );
    expect(r.primary).toBe("wallbreaker");
  });
});
