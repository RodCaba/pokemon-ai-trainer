/**
 * Stage 4 — RED tests for opposing-setter detection (OS1..OS5).
 *
 * Module under test: `src/data/tactical/opposing-setter.ts`.
 * `detectOpposingSetters(db, opposing_preview)` synthesizes a minimal
 * RoleTagInput per preview species (species_id + ability from the DB)
 * and invokes the role classifier to detect weather / TR / Tailwind /
 * screen setters that would activate against us.
 */

import { describe, expect, it } from "vitest";
import { detectOpposingSetters } from "../../../src/data/tactical/opposing-setter";
import { open } from "../../../src/db/open";

describe("detectOpposingSetters (OS1..OS5)", () => {
  it("OS1. opposing_preview includes Tyranitar (Sand Stream) → returns weather=sand with base_spe=61", () => {
    const db = open(":memory:");
    try {
      const r = detectOpposingSetters(db, ["tyranitar", "excadrill"]);
      expect(r.weather).toBeDefined();
      expect(r.weather?.species_id).toBe("tyranitar");
      expect(r.weather?.kind).toBe("sand");
      expect(r.weather?.base_spe).toBe(61);
      expect(r.weather?.via).toBe("ability");
    } finally {
      db.$client.close();
    }
  });

  it("OS2. opposing_preview without any setter species → returns {}", () => {
    const db = open(":memory:");
    try {
      const r = detectOpposingSetters(db, ["incineroar"]);
      expect(r.weather).toBeUndefined();
      expect(r.trick_room).toBeUndefined();
      expect(r.tailwind).toBeUndefined();
      expect(r.screens).toBeUndefined();
    } finally {
      db.$client.close();
    }
  });

  it("OS3. unknown species id (DB miss) is skipped silently", () => {
    const db = open(":memory:");
    try {
      const r = detectOpposingSetters(db, ["definitely-not-a-pokemon"]);
      expect(r.weather).toBeUndefined();
    } finally {
      db.$client.close();
    }
  });

  it("OS4. Hippowdon (Sand Stream, base spe 47) → returns sand with base_spe=47", () => {
    const db = open(":memory:");
    try {
      const r = detectOpposingSetters(db, ["hippowdon"]);
      expect(r.weather?.kind).toBe("sand");
      expect(r.weather?.base_spe).toBe(47);
    } finally {
      db.$client.close();
    }
  });

  it("OS5. pure: same inputs → byte-equal output across calls", () => {
    const db = open(":memory:");
    try {
      const a = JSON.stringify(detectOpposingSetters(db, ["tyranitar"]));
      for (let i = 0; i < 10; i++) {
        expect(JSON.stringify(detectOpposingSetters(db, ["tyranitar"]))).toBe(a);
      }
    } finally {
      db.$client.close();
    }
  });
});
