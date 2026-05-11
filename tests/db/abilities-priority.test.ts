/**
 * Stage 4 — RED tests for the abilities.priority_grants ingest (DB1..DB4).
 *
 * Stage 5 lands:
 *   - `data/reg-m-a/abilities-priority.json` curated for Prankster /
 *     Gale Wings / Triage.
 *   - A non-destructive ADD COLUMN migration on `abilities`.
 *   - `roster.build` ingests the JSON and populates `priority_grants_json`.
 *   - `abilities.get(...)` returns the parsed `priority_grants` field.
 */

import { describe, expect, it } from "vitest";
import { open } from "../../src/db/open";
import * as abilities from "../../src/db/abilities";

const PROD_DB = "./data/reg-m-a/db.sqlite";

describe("abilities.priority_grants (DB1..DB4)", () => {
  it("DB1. Prankster carries priority_grants = { kind: 'status', bonus: 1 } after roster build", () => {
    const db = open(PROD_DB, { readonly: true });
    try {
      const a = abilities.get(db, "Prankster", "RegM-A");
      expect(a).not.toBeNull();
      expect(a?.priority_grants).toBeDefined();
      expect(a?.priority_grants?.kind).toBe("status");
      expect(a?.priority_grants?.bonus).toBe(1);
    } finally {
      db.$client.close();
    }
  });

  it("DB2. Gale Wings carries condition: 'full_hp'", () => {
    const db = open(PROD_DB, { readonly: true });
    try {
      const a = abilities.get(db, "Gale Wings", "RegM-A");
      expect(a?.priority_grants?.kind).toBe("flying");
      expect(a?.priority_grants?.condition).toBe("full_hp");
    } finally {
      db.$client.close();
    }
  });

  it("DB3. Triage carries { kind: 'healing', bonus: 3 }", () => {
    const db = open(PROD_DB, { readonly: true });
    try {
      const a = abilities.get(db, "Triage", "RegM-A");
      expect(a?.priority_grants?.kind).toBe("healing");
      expect(a?.priority_grants?.bonus).toBe(3);
    } finally {
      db.$client.close();
    }
  });

  it("DB4. Unrelated ability (Sand Stream) has priority_grants undefined", () => {
    const db = open(PROD_DB, { readonly: true });
    try {
      const a = abilities.get(db, "Sand Stream", "RegM-A");
      expect(a).not.toBeNull();
      expect(a?.priority_grants).toBeUndefined();
    } finally {
      db.$client.close();
    }
  });
});
