import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as abilities from "../../src/db/abilities";
import type { Db } from "../../src/db/open";
import { closeIfOpen } from "./fixtures";

import { seedTinyDb } from "./fixtures";
import { RosterDbError } from "../../src/schemas/errors";

let db: Db;

beforeEach(() => { db = seedTinyDb(); });
afterEach(() => { closeIfOpen(db); });

describe("abilities repo", () => {
  it("1. list returns all abilities sorted by id", () => {
    const all = abilities.list(db, "RegM-A");
    expect(all.length).toBeGreaterThan(0);
    const ids = all.map((a) => a.id);
    expect(ids).toEqual([...ids].sort());
    expect(ids).toContain("roughskin");
  });

  it("2. get returns the record by display name", () => {
    const a = abilities.get(db, "Rough Skin", "RegM-A");
    expect(a?.id).toBe("roughskin");
    expect(a?.display_name).toBe("Rough Skin");
  });

  it("3. get is case-insensitive (and accepts canonical id)", () => {
    expect(abilities.get(db, "rough skin", "RegM-A")?.id).toBe("roughskin");
    expect(abilities.get(db, "ROUGH SKIN", "RegM-A")?.id).toBe("roughskin");
    expect(abilities.get(db, "roughskin", "RegM-A")?.id).toBe("roughskin");
  });

  it("4. get returns null for an unknown ability", () => {
    expect(abilities.get(db, "Made-Up Ability", "RegM-A")).toBeNull();
  });

  it("5. has reflects existence; closed-DB throws RosterDbError on every accessor", () => {
    expect(abilities.has(db, "Rough Skin", "RegM-A")).toBe(true);
    expect(abilities.has(db, "Made-Up Ability", "RegM-A")).toBe(false);
    db.$client.close();
    expect(() => abilities.list(db, "RegM-A")).toThrow(RosterDbError);
    expect(() => abilities.get(db, "Rough Skin", "RegM-A")).toThrow(RosterDbError);
    expect(() => abilities.has(db, "Rough Skin", "RegM-A")).toThrow(RosterDbError);
  });
});
