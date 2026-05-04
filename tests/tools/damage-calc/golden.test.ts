import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { damage_calc } from "../../../src/tools/damage-calc";
import { FixtureScenarioSchema, openSharedDb, resolveScenario } from "../../data/scenario";
import { closeIfOpen } from "../../data/fixtures";

const DIR = join(process.cwd(), "fixtures", "calcs");

// Open the DB at module load (read-only) so the describe-body `resolveScenario`
// calls (which run at vitest collection time, before any beforeAll fires) can
// see it. Closed after all tests finish.
const db = openSharedDb();
afterAll(() => {
  closeIfOpen(db);
});

function loadFixtures(): ReturnType<typeof FixtureScenarioSchema.parse>[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const raw = JSON.parse(readFileSync(join(DIR, f), "utf8")) as unknown;
      return FixtureScenarioSchema.parse(raw);
    });
}

const fixtures = loadFixtures();

if (fixtures.length === 0) {
  describe("golden fixtures", () => {
    it("at least one fixture exists in fixtures/calcs/", () => {
      expect(fixtures.length).toBeGreaterThan(0);
    });
  });
}

for (const fx of fixtures) {
  describe(`golden fixture: ${fx.id}`, () => {
    if (fx.expected === null) {
      it(`UNVERIFIED — open Showdown calc UI (IVs=31), fill expected.{rolls,min_percent,max_percent,ko_chance,description}, then set verified_at + verified_by`, () => {
        expect.fail(
          `fixture "${fx.id}" has expected=null. Scenario: ${fx.scenario}. ` +
            `Resolve in https://calc.pokemonshowdown.com/ with all IVs=31, copy outputs into the fixture, then re-run.`,
        );
      });
      return;
    }

    // Resolve the scenario via the DB once per describe block; reuse for assertions.
    const input = resolveScenario(db, fx);
    const result = damage_calc(input);
    const expected = fx.expected;

    it("rolls deep-equal expected", () => {
      expect(result.rolls).toEqual(expected.rolls);
    });

    it("min_percent exact match", () => {
      expect(result.min_percent).toBe(expected.min_percent);
    });

    it("max_percent exact match", () => {
      expect(result.max_percent).toBe(expected.max_percent);
    });

    it("ko_chance.chance exact match", () => {
      expect(result.ko_chance.chance).toBe(expected.ko_chance.chance);
    });

    it("ko_chance.n exact match", () => {
      expect(result.ko_chance.n).toBe(expected.ko_chance.n);
    });

    it("description exact match", () => {
      expect(result.description).toBe(expected.description);
    });

    it("description does not contain 'Tera'", () => {
      expect(result.description).not.toMatch(/\bTera\b/);
    });
  });
}
