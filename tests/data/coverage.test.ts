import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { existsSync } from "node:fs";
import { Generations } from "@smogon/calc";
import { open, type Db } from "../../src/db/open";

// These tests assert the committed `data/reg-m-a/db.sqlite` is up-to-date and
// complete vs. the upstream `@smogon/calc` Champions slice. If they fail, run
// `pnpm data:build:reg-m-a` to regenerate, then re-run the suite.

const DB_PATH = "data/reg-m-a/db.sqlite";
const champ = Generations.get(0);

let db: Db;

beforeAll(() => {
  if (!existsSync(DB_PATH)) {
    throw new Error(
      `coverage tests require ${DB_PATH} — run 'pnpm data:build:reg-m-a' first.`,
    );
  }
  db = open(DB_PATH, { readonly: true });
});

afterAll(() => {
  if (db?.$client.open) db.$client.close();
});

function collectIds<T extends { id: string }>(iter: Iterable<T>): Set<string> {
  const out = new Set<string>();
  for (const x of iter) out.add(x.id);
  return out;
}

function rowCount(table: string): number {
  return (db.$client.prepare(`SELECT COUNT(*) as n FROM ${table}`).get() as { n: number }).n;
}

describe("coverage — db.sqlite vs @smogon/calc Champions", () => {
  it("1. every species in Generations.get(0).species has a species row", () => {
    const upstream = collectIds(champ.species);
    const stored = new Set<string>(
      (db.$client.prepare("SELECT id FROM species").all() as { id: string }[]).map((r) => r.id),
    );
    const missing = [...upstream].filter((id) => !stored.has(id));
    expect(missing).toEqual([]);
  });

  it("2. every species has exactly one species_stats row", () => {
    const orphans = db.$client
      .prepare(
        `SELECT s.id FROM species s
         LEFT JOIN species_stats ss ON s.id = ss.species_id
         WHERE ss.species_id IS NULL`,
      )
      .all() as { id: string }[];
    expect(orphans.map((r) => r.id)).toEqual([]);
  });

  it("3. every species has ≥ 1 species_abilities row in slot 0", () => {
    const missing = db.$client
      .prepare(
        `SELECT s.id FROM species s
         WHERE NOT EXISTS (
           SELECT 1 FROM species_abilities sa
           WHERE sa.species_id = s.id AND sa.slot = '0'
         )`,
      )
      .all() as { id: string }[];
    expect(missing.map((r) => r.id)).toEqual([]);
  });

  it("4. every species has a non-empty movepool", () => {
    // SV-as-proxy via @pkmn/dex covers all base species. The populator does a BFS
    // over both @smogon/calc and @pkmn/dex baseSpecies chains so alternate forms
    // (Megas, Aegislash variants, Castform weather, Rotom appliances) inherit
    // their root form's learnset. Result: zero empties.
    const empties = db.$client
      .prepare(`SELECT id FROM species WHERE movepool = '[]'`)
      .all() as { id: string }[];
    expect(empties.map((r) => r.id)).toEqual([]);
  });

  it("4b. known alternate forms inherit their root's movepool (Mega/Aegislash/Castform/Rotom)", () => {
    // These are Champions species whose own learnset is empty in @pkmn/dex; they
    // must resolve through baseSpecies. If the BFS regresses, this lights up.
    const ALT_FORMS = ["garchompmega", "aegislashboth", "aegislashshield", "castformsunny", "rotomheat"];
    for (const id of ALT_FORMS) {
      const row = db.$client
        .prepare(`SELECT id, movepool FROM species WHERE id = ?`)
        .get(id) as { id: string; movepool: string } | undefined;
      expect(row, `expected species.${id} to exist`).toBeDefined();
      const moves = JSON.parse(row?.movepool ?? "[]") as string[];
      expect(moves.length, `${id} should inherit a non-empty movepool from its base form`).toBeGreaterThan(0);
    }
  });

  it("5. every species has a roster_membership row with format='RegM-A', is_legal=1", () => {
    const missing = db.$client
      .prepare(
        `SELECT s.id FROM species s
         LEFT JOIN roster_membership rm
           ON s.id = rm.species_id AND rm.format = 'RegM-A' AND rm.is_legal = 1
         WHERE rm.species_id IS NULL`,
      )
      .all() as { id: string }[];
    expect(missing.map((r) => r.id)).toEqual([]);
  });

  it("6. every species whose display_name contains '-Mega' has is_mega = 1 (and only those)", () => {
    const wrong = db.$client
      .prepare(
        `SELECT id, display_name, is_mega FROM species
         WHERE (display_name LIKE '%-Mega' OR display_name LIKE '%-Mega-%')
            != (is_mega = 1)`,
      )
      .all() as { id: string; display_name: string; is_mega: number }[];
    expect(wrong).toEqual([]);
  });

  it("7. species row count == Generations.get(0).species count (currently 286)", () => {
    const upstream = collectIds(champ.species);
    expect(rowCount("species")).toBe(upstream.size);
  });

  it("7b. sample_sets is populated from SETDEX_CHAMPIONS (≥ 500 curated sets)", () => {
    // After Stage-6 review, SETDEX_CHAMPIONS ingest is wired into the build.
    // Upstream currently exposes ~645 sets; ~11 are skipped as malformed (Ditto
    // Transform-only entries). 500 is a comfortable floor; tighten if it climbs.
    expect(rowCount("sample_sets")).toBeGreaterThan(500);
  });

  it("8. items row count == Generations.get(0).items count (currently 117)", () => {
    const upstream = collectIds(champ.items);
    expect(rowCount("items")).toBe(upstream.size);
  });

  it("9. abilities row count == Generations.get(0).abilities count (currently 211)", () => {
    const upstream = collectIds(champ.abilities);
    expect(rowCount("abilities")).toBe(upstream.size);
  });

  it("10. moves row count == Generations.get(0).moves count (currently 496)", () => {
    const upstream = collectIds(champ.moves);
    expect(rowCount("moves")).toBe(upstream.size);
  });
});
