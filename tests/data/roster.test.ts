import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as roster from "../../src/db/roster";
import { rosterMembership, species, speciesStats } from "../../src/db/drizzle-schema";
import type { Db } from "../../src/db/open";
import { closeIfOpen } from "./fixtures";

import { seedTinyDb } from "./fixtures";
import { RosterDataError, RosterDbError } from "../../src/schemas/errors";

let db: Db;

beforeEach(() => {
  db = seedTinyDb();
});

afterEach(() => {
  // Some tests close the DB themselves (case 20). Idempotent guard:
  closeIfOpen(db);
});

// ---- list (cases 1–2) ----

describe("roster.list", () => {
  it("1. returns rows in canonical id order", () => {
    const rows = roster.list(db, "RegM-A");
    const ids = rows.map((r) => r.id);
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
    expect(ids).toContain("garchomp");
    expect(ids).toContain("tyranitar");
  });

  it("2. returns only legal entries (illegal row excluded)", () => {
    // Insert an extra species + an illegal roster_membership row directly.
    db.insert(species).values({
      id: "illegalmon",
      displayName: "Illegalmon",
      formId: null,
      isMega: 0,
      types: JSON.stringify(["Normal"]),
      weightKg: 1.0,
      aliases: "[]",
      movepool: "[]",
      sourceJson: "{}",
    }).run();
    db.insert(speciesStats).values({
      speciesId: "illegalmon",
      hp: 50, atk: 50, def: 50, spa: 50, spd: 50, spe: 50, bst: 300,
    }).run();
    db.insert(rosterMembership).values({
      speciesId: "illegalmon",
      format: "RegM-A",
      isLegal: 0,
      isMega: 0,
      notes: "test illegal entry",
    }).run();

    const rows = roster.list(db, "RegM-A");
    expect(rows.find((r) => r.id === "illegalmon")).toBeUndefined();
  });
});

// ---- get (cases 3–9) ----

describe("roster.get", () => {
  it("3. returns the Garchomp record by display name", () => {
    const p = roster.get(db, "Garchomp", "RegM-A");
    expect(p).not.toBeNull();
    expect(p?.id).toBe("garchomp");
    expect(p?.display_name).toBe("Garchomp");
    expect(p?.base_stats.spe).toBe(102);
    expect(p?.types).toEqual(["Dragon", "Ground"]);
  });

  it("4. is case-insensitive", () => {
    const lower = roster.get(db, "garchomp", "RegM-A");
    const upper = roster.get(db, "GARCHOMP", "RegM-A");
    const mixed = roster.get(db, "GaRcHoMp", "RegM-A");
    expect(lower?.id).toBe("garchomp");
    expect(upper?.id).toBe("garchomp");
    expect(mixed?.id).toBe("garchomp");
  });

  it("5. accepts an alias and resolves to canonical id", () => {
    // Garchomp alias "chomp" is in the fixture.
    const p = roster.get(db, "chomp", "RegM-A");
    expect(p?.id).toBe("garchomp");
    expect(p?.display_name).toBe("Garchomp");
  });

  it("6. returns null for an unknown species (Mewtwo not in fixture)", () => {
    expect(roster.get(db, "Mewtwo", "RegM-A")).toBeNull();
  });

  it("7. returns a Pokemon whose movepool array is non-empty", () => {
    const p = roster.get(db, "Garchomp", "RegM-A");
    expect(p?.movepool).toBeDefined();
    expect(p!.movepool.length).toBeGreaterThan(0);
    // Movepool stores Showdown move IDs (lowercase, no spaces).
    expect(p!.movepool).toContain("earthquake");
  });

  it("8. returns is_mega === true for a Mega form", () => {
    const p = roster.get(db, "Garchomp-Mega", "RegM-A");
    expect(p).not.toBeNull();
    expect(p?.is_mega).toBe(true);
  });

  it("9. ambiguous-form handling: bare 'Slowbro' returns the base form, not Galarian", () => {
    const p = roster.get(db, "Slowbro", "RegM-A");
    expect(p).not.toBeNull();
    expect(p?.id).toBe("slowbro");
    expect(p?.form_id).toBeNull();
    // Confirm the Galarian form IS reachable via its own qualifier.
    const g = roster.get(db, "Slowbro-Galar", "RegM-A");
    expect(g?.id).toBe("slowbrogalar");
    expect(g?.form_id).toBe("galar");
  });
});

// ---- has (cases 10–12) ----

describe("roster.has", () => {
  it("10. returns true for a known species (display name)", () => {
    expect(roster.has(db, "Garchomp", "RegM-A")).toBe(true);
  });

  it("11. returns false for an unknown species (Mewtwo not in fixture)", () => {
    expect(roster.has(db, "Mewtwo", "RegM-A")).toBe(false);
  });

  it("12. is case-insensitive (matches get())", () => {
    expect(roster.has(db, "garchomp", "RegM-A")).toBe(true);
    expect(roster.has(db, "GARCHOMP", "RegM-A")).toBe(true);
    expect(roster.has(db, "GaRcHoMp", "RegM-A")).toBe(true);
    // Aliases should also count as "has".
    expect(roster.has(db, "chomp", "RegM-A")).toBe(true);
  });
});

// ---- search (cases 13–16) ----

describe("roster.search", () => {
  it("13. ranks the prefix match first (\"garcha\" → Garchomp)", () => {
    const hits = roster.search(db, "garcha", "RegM-A");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.id).toBe("garchomp");
    expect(hits[0]?.score ?? 0).toBeGreaterThan(0.5);
  });

  it("14. returns at most 10 hits even when many candidates match", () => {
    const hits = roster.search(db, "a", "RegM-A");
    expect(hits.length).toBeLessThanOrEqual(10);
  });

  it("15. returns an empty array when no candidate scores ≥ 0.3", () => {
    const hits = roster.search(db, "xyz123nonsense", "RegM-A");
    expect(hits).toEqual([]);
  });

  it("16. distinguishes matched_on (id / display_name / alias)", () => {
    // Display-name route: "Garchomp" matches via display_name.
    const byName = roster.search(db, "Garchomp", "RegM-A");
    expect(byName[0]?.id).toBe("garchomp");
    expect(byName[0]?.matched_on).toBe("display_name");

    // Alias route: "chomp" should match via alias (it IS the alias for garchomp).
    const byAlias = roster.search(db, "chomp", "RegM-A");
    expect(byAlias[0]?.id).toBe("garchomp");
    expect(byAlias[0]?.matched_on).toBe("alias");

    // Id route: "garchompmega" exact-id match.
    const byId = roster.search(db, "garchompmega", "RegM-A");
    expect(byId[0]?.id).toBe("garchompmega");
    expect(byId[0]?.matched_on).toBe("id");
  });

  it("16b. tiebreaker: when scores tie, the verbatim-matching source wins", () => {
    // "Garchomp" raw-equals display_name; lowercased it equals id. Both score 1.0
    // → display_name wins (verbatim raw match). Already exercised via case 16, but
    // pinning the tiebreaker behavior explicitly:
    expect(roster.search(db, "Garchomp", "RegM-A")[0]?.matched_on).toBe("display_name");

    // "garchomp" matches both id (verbatim) and display_name (case-insensitive).
    // Both score 1.0 → id wins (verbatim).
    expect(roster.search(db, "garchomp", "RegM-A")[0]?.matched_on).toBe("id");

    // "chomp" — only the alias raw-matches verbatim; id and display_name score
    // lower (substring/Levenshtein). Alias wins on score, not just tiebreak.
    expect(roster.search(db, "chomp", "RegM-A")[0]?.matched_on).toBe("alias");
  });

  it("15b. returns empty array on whitespace-only query", () => {
    expect(roster.search(db, "   ", "RegM-A")).toEqual([]);
    expect(roster.search(db, "", "RegM-A")).toEqual([]);
  });

  it("14b. single-char query is bounded to ≤ 10 hits and survives without errors", () => {
    const hits = roster.search(db, "g", "RegM-A");
    expect(hits.length).toBeLessThanOrEqual(10);
    // Sanity: every hit has score ≥ MIN.
    for (const h of hits) expect(h.score).toBeGreaterThanOrEqual(0.3);
  });
});

// ---- sets (cases 17–18) ----

describe("roster.sets", () => {
  it("17. returns ≥ 1 SampleSet for a species with curated sets (Garchomp)", () => {
    const sets = roster.sets(db, "Garchomp", "RegM-A");
    expect(sets.length).toBeGreaterThanOrEqual(1);
    const setNames = sets.map((s) => s.set_name);
    expect(setNames).toContain("Choice Scarf");
  });

  it("18. returns empty array for a species with no sample sets, throws RosterDataError for unknown species", () => {
    // Garchomp-Mega is in the fixture but has no sample sets.
    const empty = roster.sets(db, "Garchomp-Mega", "RegM-A");
    expect(empty).toEqual([]);
    // Unknown species → RosterDataError (caller likely meant to call has() first).
    expect(() => roster.sets(db, "Mewtwo", "RegM-A")).toThrow(RosterDataError);
  });
});

// ---- prepared statement caching + closed-handle (cases 19–20) ----

describe("roster — caching & closed-handle behavior", () => {
  it("19. get() called 100x reuses prepared statements (no re-prepare per call)", () => {
    const spy = vi.spyOn(db.$client, "prepare");
    // Warm the cache: first call may prepare several statements.
    roster.get(db, "Garchomp", "RegM-A");
    const baseline = spy.mock.calls.length;

    for (let i = 0; i < 100; i++) {
      roster.get(db, "Garchomp", "RegM-A");
    }
    const afterHundred = spy.mock.calls.length - baseline;
    // At most a handful of new prepares (e.g., one per distinct query shape if
    // any internal cache misses occur). Anything close to 100 = no caching.
    expect(afterHundred).toBeLessThan(20);
    spy.mockRestore();
  });

  it("20. closing the DB and re-calling throws RosterDbError (not a raw SqliteError)", () => {
    db.$client.close();
    let err: unknown;
    try {
      roster.get(db, "Garchomp", "RegM-A");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(RosterDbError);
    // Same expectation for has and search.
    expect(() => roster.has(db, "Garchomp", "RegM-A")).toThrow(RosterDbError);
    expect(() => roster.search(db, "garcha", "RegM-A")).toThrow(RosterDbError);
  });
});
