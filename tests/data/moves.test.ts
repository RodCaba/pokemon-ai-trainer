import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as moves from "../../src/db/moves";
import type { Db } from "../../src/db/open";
import { closeIfOpen } from "./fixtures";

import { seedTinyDb } from "./fixtures";
import { RosterDbError } from "../../src/schemas/errors";

let db: Db;

beforeEach(() => { db = seedTinyDb(); });
afterEach(() => { closeIfOpen(db); });

describe("moves repo", () => {
  it("1. list returns all moves sorted by id", () => {
    const all = moves.list(db, "RegM-A");
    expect(all.length).toBeGreaterThan(0);
    const ids = all.map((m) => m.id);
    expect(ids).toEqual([...ids].sort());
    expect(ids).toContain("earthquake");
  });

  it("2. get returns the record by display name (with type, category, base_power)", () => {
    const m = moves.get(db, "Earthquake", "RegM-A");
    expect(m?.id).toBe("earthquake");
    expect(m?.display_name).toBe("Earthquake");
    expect(m?.type).toBe("Ground");
    expect(m?.category).toBe("Physical");
    expect(m?.base_power).toBe(100);
  });

  it("3. get is case-insensitive (and accepts canonical id)", () => {
    expect(moves.get(db, "earthquake", "RegM-A")?.id).toBe("earthquake");
    expect(moves.get(db, "EARTHQUAKE", "RegM-A")?.id).toBe("earthquake");
    expect(moves.get(db, "Will-O-Wisp", "RegM-A")?.id).toBe("willowisp");
  });

  it("4. get returns null for an unknown move", () => {
    expect(moves.get(db, "Made-Up Move", "RegM-A")).toBeNull();
  });

  it("5. has reflects existence; closed-DB throws RosterDbError on every accessor", () => {
    expect(moves.has(db, "Earthquake", "RegM-A")).toBe(true);
    expect(moves.has(db, "Made-Up Move", "RegM-A")).toBe(false);
    db.$client.close();
    expect(() => moves.list(db, "RegM-A")).toThrow(RosterDbError);
    expect(() => moves.get(db, "Earthquake", "RegM-A")).toThrow(RosterDbError);
    expect(() => moves.has(db, "Earthquake", "RegM-A")).toThrow(RosterDbError);
  });
});
