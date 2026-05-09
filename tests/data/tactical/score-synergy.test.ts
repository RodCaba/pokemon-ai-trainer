/**
 * TAC-T19..T24 — scoreSynergy archetype + co-occurrence components.
 * Stage-4 red.
 */

import { afterEach, describe, expect, it } from "vitest";
import { scoreSynergy } from "../../../src/data/tactical/score-synergy";
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

describe("scoreSynergy (TAC-T19..T24)", () => {
  it("TAC-T19. Pelipper Rain core triggers weather archetype (≥ 10pt bonus)", () => {
    const db = open(":memory:"); opened = db;
    const result = scoreSynergy(TEAM, { db });
    const ev = result.evidence as { archetypes?: string[] };
    expect(ev.archetypes ?? []).toContain("Weather");
  });

  it("TAC-T20. Snow team (Abomasnow + Snow Cloak/Slush Rush) triggers weather archetype", () => {
    const db = open(":memory:"); opened = db;
    const result = scoreSynergy(TEAM, { db });
    const ev = result.evidence as { archetypes?: string[] };
    expect(ev.archetypes ?? []).toContain("Weather");
  });

  it("TAC-T21. Follow Me / Rage Powder team triggers Redirection archetype", () => {
    const db = open(":memory:"); opened = db;
    const result = scoreSynergy(TEAM, { db });
    const ev = result.evidence as { archetypes?: string[] };
    expect(ev.archetypes ?? []).toContain("Redirection");
  });

  it("TAC-T22. Fake Out core (Incineroar + Sneasler) triggers Fake Out archetype", () => {
    const db = open(":memory:"); opened = db;
    const result = scoreSynergy(TEAM, { db });
    const ev = result.evidence as { archetypes?: string[] };
    expect(ev.archetypes ?? []).toContain("Fake Out");
  });

  it("TAC-T23. Good Stuff (no archetype, all stats > 70) triggers Good Stuff bonus", () => {
    const db = open(":memory:"); opened = db;
    const result = scoreSynergy(TEAM, { db });
    const ev = result.evidence as { archetypes?: string[] };
    expect(ev.archetypes ?? []).toContain("Good Stuff");
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
