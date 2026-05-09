/**
 * TAC-T19..T24 — scoreSynergy archetype + co-occurrence components.
 *
 * Stage-6 review fix: tests now build real {@link ScoringTeam} inputs via
 * `fixtureToScoringTeam`, exercising `detectArchetypes()` directly. Each
 * archetype test asserts the SPECIFIC archetype is detected AND the other
 * three are NOT — so the no-signal fallback can never silently make every
 * test pass.
 */

import { afterEach, describe, expect, it } from "vitest";
import { scoreSynergy } from "../../../src/data/tactical/score-synergy";
import {
  fixtureToScoringTeam,
  type FixtureSet,
} from "../../../src/data/tactical/scoring-team";
import type { UserTeam } from "../../../src/schemas/user-teams";
import { open, type Db } from "../../../src/db/open";

let opened: Db | null = null;
afterEach(() => {
  if (opened) {
    try {
      opened.$client.close();
    } catch {
      /* noop */
    }
    opened = null;
  }
});

const TEAM = {} as UserTeam;

/** Default SPS / nature stub used by every fixture row in this file. */
const SPS_NEUTRAL = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } as const;

function row(
  id: string,
  display: string,
  ability: string,
  moves: [string, string, string, string],
  item: string | null = "Leftovers",
  nature: FixtureSet["nature"] = "Hardy",
): FixtureSet {
  return {
    species_roster_id: id,
    species: display,
    item,
    ability,
    nature,
    sps: { ...SPS_NEUTRAL },
    moves,
  };
}

const ALL_ARCHETYPES = ["Weather", "Redirection", "Fake Out", "Good Stuff"] as const;

function expectOnly(archs: string[], expected: string): void {
  expect(archs).toContain(expected);
  for (const other of ALL_ARCHETYPES) {
    if (other !== expected) expect(archs).not.toContain(other);
  }
}

describe("scoreSynergy (TAC-T19..T24)", () => {
  it("TAC-T19. Pelipper Rain core (Drizzle + Swift Swim) triggers Weather archetype only", () => {
    const db = open(":memory:"); opened = db;
    const team = fixtureToScoringTeam([
      row("pelipper", "Pelipper", "Drizzle", ["Hurricane", "Hydro Pump", "Tailwind", "Protect"]),
      row("basculegion", "Basculegion", "Swift Swim", ["Wave Crash", "Last Respects", "Aqua Jet", "Protect"]),
    ]);
    const result = scoreSynergy(TEAM, { db, scoring_team: team });
    const ev = result.evidence as { archetypes?: string[] };
    expectOnly(ev.archetypes ?? [], "Weather");
  });

  it("TAC-T20. Snow team (Snow Warning + Slush Rush) triggers Weather archetype only", () => {
    const db = open(":memory:"); opened = db;
    const team = fixtureToScoringTeam([
      row("abomasnow", "Abomasnow", "Snow Warning", ["Blizzard", "Wood Hammer", "Ice Shard", "Protect"]),
      row("beartic", "Beartic", "Slush Rush", ["Icicle Crash", "Liquidation", "Aqua Jet", "Protect"]),
    ]);
    const result = scoreSynergy(TEAM, { db, scoring_team: team });
    const ev = result.evidence as { archetypes?: string[] };
    expectOnly(ev.archetypes ?? [], "Weather");
  });

  it("TAC-T21. Rage Powder team triggers Redirection archetype only", () => {
    const db = open(":memory:"); opened = db;
    const team = fixtureToScoringTeam([
      row("amoonguss", "Amoonguss", "Regenerator", ["Spore", "Rage Powder", "Sludge Bomb", "Pollen Puff"]),
      row("garchomp", "Garchomp", "Rough Skin", ["Earthquake", "Dragon Claw", "Stone Edge", "Protect"]),
    ]);
    const result = scoreSynergy(TEAM, { db, scoring_team: team });
    const ev = result.evidence as { archetypes?: string[] };
    expectOnly(ev.archetypes ?? [], "Redirection");
  });

  it("TAC-T22. Fake Out core triggers Fake Out archetype only", () => {
    const db = open(":memory:"); opened = db;
    const team = fixtureToScoringTeam([
      row("incineroar", "Incineroar", "Intimidate", ["Flare Blitz", "Knock Off", "Fake Out", "Parting Shot"]),
      row("rillaboom", "Rillaboom", "Grassy Surge", ["Wood Hammer", "Grassy Glide", "U-turn", "Fake Out"]),
    ]);
    const result = scoreSynergy(TEAM, { db, scoring_team: team });
    const ev = result.evidence as { archetypes?: string[] };
    expectOnly(ev.archetypes ?? [], "Fake Out");
  });

  it("TAC-T23. Good Stuff (no weather/redirect/fake-out signal) triggers Good Stuff only", () => {
    const db = open(":memory:"); opened = db;
    const team = fixtureToScoringTeam([
      row("garchomp", "Garchomp", "Rough Skin", ["Earthquake", "Dragon Claw", "Stone Edge", "Protect"]),
      row("hydreigon", "Hydreigon", "Levitate", ["Dark Pulse", "Draco Meteor", "Earth Power", "Protect"]),
      row("rotom-wash", "Rotom-Wash", "Levitate", ["Hydro Pump", "Thunderbolt", "Will-O-Wisp", "Protect"]),
      row("gardevoir", "Gardevoir", "Trace", ["Moonblast", "Psychic", "Dazzling Gleam", "Protect"]),
      row("talonflame", "Talonflame", "Gale Wings", ["Brave Bird", "Flare Blitz", "U-turn", "Protect"]),
      row("excadrill", "Excadrill", "Sand Force", ["Earthquake", "Iron Head", "Rock Slide", "Protect"]),
    ]);
    const result = scoreSynergy(TEAM, { db, scoring_team: team });
    const ev = result.evidence as { archetypes?: string[] };
    expectOnly(ev.archetypes ?? [], "Good Stuff");
  });

  it("TAC-T24. teammate co-occurrence is 60-pt component; archetype is 40-pt (Q4 binding)", () => {
    const db = open(":memory:"); opened = db;
    const result = scoreSynergy(TEAM, {
      db,
      teammate_weight: 0.6,
      archetype_weight: 0.4,
    });
    const ev = result.evidence as {
      teammate_component_max?: number;
      archetype_component_max?: number;
    };
    expect(ev.teammate_component_max).toBe(60);
    expect(ev.archetype_component_max).toBe(40);
  });
});
