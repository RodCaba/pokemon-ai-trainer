import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as items from "../../src/db/items";
import type { Db } from "../../src/db/open";
import { closeIfOpen } from "./fixtures";

import { seedTinyDb } from "./fixtures";
import { RosterDbError } from "../../src/schemas/errors";

let db: Db;

beforeEach(() => { db = seedTinyDb(); });
afterEach(() => { closeIfOpen(db); });

describe("items repo", () => {
  it("1. list returns all items sorted by id", () => {
    const all = items.list(db, "RegM-A");
    expect(all.length).toBeGreaterThan(0);
    const ids = all.map((i) => i.id);
    expect(ids).toEqual([...ids].sort());
    expect(ids).toContain("choicescarf");
  });

  it("2. get returns the record by display name", () => {
    const it = items.get(db, "Choice Scarf", "RegM-A");
    expect(it?.id).toBe("choicescarf");
    expect(it?.display_name).toBe("Choice Scarf");
    expect(it?.category).toBe("choice");
  });

  it("3. get is case-insensitive (and accepts canonical id)", () => {
    expect(items.get(db, "choice scarf", "RegM-A")?.id).toBe("choicescarf");
    expect(items.get(db, "CHOICE SCARF", "RegM-A")?.id).toBe("choicescarf");
    expect(items.get(db, "choicescarf", "RegM-A")?.id).toBe("choicescarf");
  });

  it("4. get returns null for an unknown item", () => {
    expect(items.get(db, "Made-Up Item", "RegM-A")).toBeNull();
  });

  it("5. has reflects existence; closed-DB throws RosterDbError on every accessor", () => {
    expect(items.has(db, "Choice Scarf", "RegM-A")).toBe(true);
    expect(items.has(db, "Made-Up Item", "RegM-A")).toBe(false);
    db.$client.close();
    expect(() => items.list(db, "RegM-A")).toThrow(RosterDbError);
    expect(() => items.get(db, "Choice Scarf", "RegM-A")).toThrow(RosterDbError);
    expect(() => items.has(db, "Choice Scarf", "RegM-A")).toThrow(RosterDbError);
  });
});
