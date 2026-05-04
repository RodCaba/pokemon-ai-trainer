import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { existsSync } from "node:fs";
import { Generations, toID } from "@smogon/calc";
import { open, type Db } from "../../src/db/open";

// Referential + invariant checks against the committed `data/reg-m-a/db.sqlite`.
// Failure here means the build pipeline produced an inconsistent DB — `pnpm
// data:build:reg-m-a` should have caught it via CHECK constraints, but these
// tests re-assert at the read side as a defense-in-depth net.

const DB_PATH = "data/reg-m-a/db.sqlite";
const champ = Generations.get(0);
let db: Db;

beforeAll(() => {
  if (!existsSync(DB_PATH)) {
    throw new Error(`integrity tests require ${DB_PATH} — run 'pnpm data:build:reg-m-a' first.`);
  }
  db = open(DB_PATH, { readonly: true });
});

afterAll(() => {
  if (db?.$client.open) db.$client.close();
});

interface NameRow { name: string }

function namesIn(table: string): Set<string> {
  return new Set<string>(
    (db.$client.prepare(`SELECT display_name as name FROM ${table}`).all() as NameRow[]).map((r) => r.name),
  );
}

describe("integrity — referential + invariants", () => {
  it("1. every species_abilities.ability_name exists in abilities.display_name", () => {
    const known = namesIn("abilities");
    const missing = (db.$client
      .prepare(
        `SELECT DISTINCT sa.ability_name as name FROM species_abilities sa
         WHERE sa.ability_name NOT IN (SELECT display_name FROM abilities)`,
      )
      .all() as NameRow[]).map((r) => r.name);
    expect(missing).toEqual([]);
    // Sanity: known set is non-empty.
    expect(known.size).toBeGreaterThan(0);
  });

  it("2. every move id in species.movepool exists in moves.id", () => {
    // Movepool stores Showdown ids, not display names — JSON-extract via json_each.
    const missing = (db.$client
      .prepare(
        `SELECT DISTINCT je.value as name
         FROM species s, json_each(s.movepool) je
         WHERE je.value NOT IN (SELECT id FROM moves)`,
      )
      .all() as NameRow[]).map((r) => r.name);
    expect(missing).toEqual([]);
  });

  it("3. every sample_sets.ability exists in abilities.display_name", () => {
    const missing = (db.$client
      .prepare(
        `SELECT DISTINCT ss.ability as name FROM sample_sets ss
         WHERE ss.ability NOT IN (SELECT display_name FROM abilities)`,
      )
      .all() as NameRow[]).map((r) => r.name);
    expect(missing).toEqual([]);
  });

  it("4. every non-null sample_sets.item exists in items.display_name", () => {
    const missing = (db.$client
      .prepare(
        `SELECT DISTINCT ss.item as name FROM sample_sets ss
         WHERE ss.item IS NOT NULL
           AND ss.item NOT IN (SELECT display_name FROM items)`,
      )
      .all() as NameRow[]).map((r) => r.name);
    expect(missing).toEqual([]);
  });

  it("5. every sample_sets.moves[i] (display name) exists in moves.display_name", () => {
    const missing = (db.$client
      .prepare(
        `SELECT DISTINCT je.value as name
         FROM sample_sets ss, json_each(ss.moves_json) je
         WHERE je.value NOT IN (SELECT display_name FROM moves)`,
      )
      .all() as NameRow[]).map((r) => r.name);
    expect(missing).toEqual([]);
  });

  it("6. every recorded ability is engine-known via Generations.get(0).abilities", () => {
    const stored = namesIn("abilities");
    const unknown: string[] = [];
    for (const name of stored) {
      if (!champ.abilities.get(toID(name))) unknown.push(name);
    }
    expect(unknown).toEqual([]);
  });

  it("7. every recorded move is engine-known via Generations.get(0).moves", () => {
    const stored = namesIn("moves");
    const unknown: string[] = [];
    for (const name of stored) {
      if (!champ.moves.get(toID(name))) unknown.push(name);
    }
    expect(unknown).toEqual([]);
  });

  it("8. every recorded item is engine-known via Generations.get(0).items", () => {
    const stored = namesIn("items");
    const unknown: string[] = [];
    for (const name of stored) {
      if (!champ.items.get(toID(name))) unknown.push(name);
    }
    expect(unknown).toEqual([]);
  });

  it("9. no species_stats row has any zero stat", () => {
    const zeroes = db.$client
      .prepare(
        `SELECT species_id FROM species_stats
         WHERE hp = 0 OR atk = 0 OR def = 0 OR spa = 0 OR spd = 0 OR spe = 0`,
      )
      .all() as { species_id: string }[];
    expect(zeroes.map((r) => r.species_id)).toEqual([]);
  });

  it("10. every sample_sets.sps total is ≤ 66 (Reg M-A SPS cap, defense-in-depth read-side check)", () => {
    const overflows = db.$client
      .prepare(
        `SELECT rowid,
                (json_extract(sps_json,'$.hp')+json_extract(sps_json,'$.atk')+json_extract(sps_json,'$.def')
                +json_extract(sps_json,'$.spa')+json_extract(sps_json,'$.spd')+json_extract(sps_json,'$.spe')) as total
         FROM sample_sets
         WHERE total > 66`,
      )
      .all() as Array<{ rowid: number; total: number }>;
    expect(overflows).toEqual([]);
  });

  it("11. every sample_sets.sps per-stat is ≤ 32", () => {
    const overflows = db.$client
      .prepare(
        `SELECT rowid FROM sample_sets WHERE
            json_extract(sps_json,'$.hp')  > 32 OR
            json_extract(sps_json,'$.atk') > 32 OR
            json_extract(sps_json,'$.def') > 32 OR
            json_extract(sps_json,'$.spa') > 32 OR
            json_extract(sps_json,'$.spd') > 32 OR
            json_extract(sps_json,'$.spe') > 32`,
      )
      .all() as { rowid: number }[];
    expect(overflows.map((r) => r.rowid)).toEqual([]);
  });

  it("12b. item categories match expectations for canonical Reg M-A items", () => {
    const expectations: Array<{ id: string; expected_category: string }> = [
      { id: "garchompite",   expected_category: "mega-stone" },
      { id: "tyranitarite",  expected_category: "mega-stone" },
      { id: "sitrusberry",   expected_category: "berry" },
      { id: "lumberry",      expected_category: "berry" },
      { id: "choicescarf",   expected_category: "choice" },
      { id: "leftovers",     expected_category: "held" },
      { id: "focussash",     expected_category: "held" },
      { id: "lightball",     expected_category: "held" },
    ];
    for (const e of expectations) {
      const row = db.$client
        .prepare("SELECT category FROM items WHERE id = ?")
        .get(e.id) as { category: string } | undefined;
      expect(row, `expected items.${e.id} to exist`).toBeDefined();
      expect(row?.category, `items.${e.id} category`).toBe(e.expected_category);
    }
  });

  it("12. no row references an unknown species_id (orphan FK check)", () => {
    const tables = ["species_stats", "species_abilities", "sample_sets", "roster_membership"];
    const orphans: Array<{ table: string; species_id: string }> = [];
    for (const t of tables) {
      const rows = db.$client
        .prepare(
          `SELECT DISTINCT t.species_id FROM ${t} t
           WHERE t.species_id NOT IN (SELECT id FROM species)`,
        )
        .all() as { species_id: string }[];
      for (const r of rows) orphans.push({ table: t, species_id: r.species_id });
    }
    expect(orphans).toEqual([]);
  });
});
