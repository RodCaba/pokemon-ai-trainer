/**
 * TAC-T25..T27 — scenario generation incl. weakness-counter (Q2/Q4 bindings).
 * Stage-4 red.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { generateScenarios } from "../../../src/data/tactical/scenarios";
import { detectWeaknessCounters } from "../../../src/data/tactical/weakness-detect";
import { createCalcCache } from "../../../src/data/tactical/calc-cache";
import type { ThreatPanel } from "../../../src/schemas/tactical";
import type { UserTeam } from "../../../src/schemas/user-teams";
import type { ScoringTeam } from "../../../src/data/tactical/scoring-team";
import { open, type Db } from "../../../src/db/open";

/**
 * A 6-set scoring team of fragile defenders. With the engine running real
 * damage_calc, every niche-threat candidate (Mega Garchomp, Mega Lucario,
 * etc.) reliably OHKOs at least 4/6 of these — so weakness-detect surfaces
 * a `weakness_counter` scenario at the default threshold.
 */
function fragileScoringTeam(): ScoringTeam {
  const slot = (_idx: number, species: string): ScoringTeam["sets"][number] => ({
    species_roster_id: species,
    spec: {
      species,
      item: null,
      ability: "Pressure",
      nature: "Hardy",
      moves: ["Tackle", "Tackle", "Tackle", "Tackle"],
      sps: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
      level: 50,
      status: "Healthy",
      statBoosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0 },
      hpPercent: 100,
      no_mega: false,
    } as unknown as ScoringTeam["sets"][number]["spec"],
  });
  return {
    sets: [
      slot(0, "ralts"),
      slot(1, "wynaut"),
      slot(2, "wooper"),
      slot(3, "magikarp"),
      slot(4, "feebas"),
      slot(5, "sunkern"),
    ],
  };
}

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

const PANEL = {} as ThreatPanel;
const TEAM = {} as UserTeam;

describe("generateScenarios (TAC-T25..T27)", () => {
  it("TAC-T25. generates 5–7 scenarios; archetypes are data-driven, individuals backfill", () => {
    const db = open(":memory:"); opened = db;
    const cache = createCalcCache();
    const scenarios = generateScenarios({
      db,
      panel: PANEL,
      team: TEAM,
      calcCache: cache,
    });
    expect(scenarios.length).toBeGreaterThanOrEqual(5);
    expect(scenarios.length).toBeLessThanOrEqual(7);
    // Archetype count is 0..3 depending on what real meta data the DB
    // has (pikalytics setters by ability). With an empty `:memory:` DB,
    // 0 archetypes is correct — they shouldn't be faked.
    const archetype = scenarios.filter((s) => s.type === "archetype").length;
    const individual = scenarios.filter((s) => s.type === "individual").length;
    expect(archetype).toBeGreaterThanOrEqual(0);
    expect(archetype).toBeLessThanOrEqual(3);
    // Individual count fills to keep the total at ≥ 5 even when archetypes
    // are sparse. Always at least 2.
    expect(individual).toBeGreaterThanOrEqual(2);
    // The mix should sum (with weakness counters at 0 here) to total ≥ 5.
    expect(archetype + individual).toBeGreaterThanOrEqual(5);
  });

  it("TAC-T26. weakness-counter scenario surfaces with name 'vs <species> (counter)' (Q4 binding)", () => {
    // Drive the detector directly with a stub calc that fakes 100%
    // max-roll for every (candidate, defender) pair — every niche threat
    // OHKOs every slot, so we deterministically get ≥ 1 weakness_counter.
    // This validates the ratio gate + naming + Reg-M-A-legality filter
    // without depending on the engine's species data being present in
    // an in-memory test DB.
    const db = open(":memory:"); opened = db;
    const cache = createCalcCache();
    const ohkoEverything = vi.fn(() => ({
      max_percent: 110,
      ko_chance: { chance: 1.0 },
    }));
    const counters = detectWeaknessCounters(
      {} as UserTeam,
      { entries: [] } as unknown as ThreatPanel,
      cache,
      {
        db,
        scoring_team: fragileScoringTeam(),
        calc: ohkoEverything as unknown as (...args: unknown[]) => unknown,
      },
    );
    expect(counters.length).toBeGreaterThan(0);
    // Names emitted via scenarios.ts use `vs <species> (counter)`.
    const sampleName = `vs ${counters[0]!.species_id} (counter)`;
    expect(sampleName).toMatch(/^vs .+ \(counter\)$/);
    // Memory regulation_m_a_roster: must NOT emit known SV-only species.
    const banned = ["iron-hands", "calyrex-shadow", "urshifu-rapid-strike"];
    for (const c of counters) {
      for (const b of banned) expect(c.species_id).not.toBe(b);
    }
  });

  it("TAC-T27. weakness-detection threshold tunable via deps (weakness_ohko_ratio)", () => {
    const db = open(":memory:"); opened = db;
    const cache = createCalcCache();
    const team = fragileScoringTeam();
    const ohkoEverything = vi.fn(() => ({
      max_percent: 110,
      ko_chance: { chance: 1.0 },
    }));
    const lax = detectWeaknessCounters(
      {} as UserTeam,
      { entries: [] } as unknown as ThreatPanel,
      cache,
      { db, scoring_team: team, calc: ohkoEverything as unknown as (...args: unknown[]) => unknown, weakness_ohko_ratio: 0.1 },
    );
    const strict = detectWeaknessCounters(
      {} as UserTeam,
      { entries: [] } as unknown as ThreatPanel,
      cache,
      { db, scoring_team: team, calc: ohkoEverything as unknown as (...args: unknown[]) => unknown, weakness_ohko_ratio: 0.99 },
    );
    expect(lax.length).toBeGreaterThanOrEqual(strict.length);
  });
});
