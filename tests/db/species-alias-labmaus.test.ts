/**
 * Tests T7–T9 for the `species_alias_labmaus` ref-table repo.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as alias from "../../src/db/species-alias-labmaus";
import type { Db } from "../../src/db/open";
import { closeIfOpen, seedLabmausDb } from "./labmaus-fixtures";

let db: Db;
beforeEach(() => {
  db = seedLabmausDb();
});
afterEach(() => {
  closeIfOpen(db);
});

describe("species_alias_labmaus repo", () => {
  it("T7. list returns seeded aliases sorted by id", () => {
    const all = alias.list(db, "RegM-A");
    expect(all.length).toBeGreaterThan(0);
    const ids = all.map((r) => r.labmaus_id);
    expect(ids).toEqual([...ids].sort());
    // 038-a is in the seed
    expect(ids).toContain("038-a");
  });

  it("T8. get('038-a') resolves to ninetalesalola", () => {
    const row = alias.get(db, "038-a", "RegM-A");
    expect(row).not.toBeNull();
    expect(row?.roster_id).toBe("ninetalesalola");
    expect(row?.labmaus_id).toBe("038-a");
  });

  it("T9. get unknown returns null", () => {
    expect(alias.get(db, "038-z", "RegM-A")).toBeNull();
  });
});
