/**
 * META-T29..T37 — site-agnostic species tagger.
 * Stage 4: every test fails because `buildSpeciesIndex` / `detectSpeciesTags`
 * throw "not implemented (Stage 5)".
 */

import { describe, expect, it } from "vitest";
import { open, type Db } from "../../../src/db/open";
import {
  buildSpeciesIndex,
  detectSpeciesTags,
} from "../../../src/tools/knowledge/species-tagger";
import { SpeciesTaggerError } from "../../../src/schemas/errors";

interface SpeciesSeed {
  id: string;
  display_name: string;
  is_mega: 0 | 1;
  aliases?: string[];
}

function seed(db: Db, rows: SpeciesSeed[]): void {
  const insertSpecies = db.$client.prepare(
    `INSERT INTO species (id, display_name, form_id, is_mega, types, weight_kg, aliases, movepool, source_json)
     VALUES (?, ?, NULL, ?, '["Normal"]', 1.0, ?, '[]', '{}')`,
  );
  const insertStats = db.$client.prepare(
    `INSERT INTO species_stats (species_id, hp, atk, def, spa, spd, spe, bst)
     VALUES (?, 100, 100, 100, 100, 100, 100, 600)`,
  );
  const insertMembership = db.$client.prepare(
    `INSERT INTO roster_membership (species_id, format, is_legal, is_mega, notes)
     VALUES (?, 'RegM-A', 1, ?, NULL)`,
  );
  for (const r of rows) {
    insertSpecies.run(r.id, r.display_name, r.is_mega, JSON.stringify(r.aliases ?? []));
    insertStats.run(r.id);
    insertMembership.run(r.id, r.is_mega);
  }
}

const STD: SpeciesSeed[] = [
  { id: "incineroar", display_name: "Incineroar", is_mega: 0 },
  { id: "garchomp", display_name: "Garchomp", is_mega: 0 },
  { id: "garchomp-mega", display_name: "Garchomp-Mega", is_mega: 1, aliases: ["Mega Garchomp"] },
  { id: "sneasler", display_name: "Sneasler", is_mega: 0 },
  { id: "flutter-mane", display_name: "Flutter Mane", is_mega: 0 },
];

describe("species-tagger (META-T29..T37)", () => {
  it("META-T29. positive match: chunk text mentioning Incineroar yields ['incineroar']", () => {
    const db = open(":memory:");
    try {
      seed(db, STD);
      const index = buildSpeciesIndex(db);
      const tags = detectSpeciesTags(
        "Incineroar is the most common Fake Out user in Reg M-A.",
        index,
      );
      expect(tags).toContain("incineroar");
    } finally {
      db.$client.close();
    }
  });

  it("META-T30. negative match: chunk text with no roster species yields []", () => {
    const db = open(":memory:");
    try {
      seed(db, STD);
      const index = buildSpeciesIndex(db);
      const tags = detectSpeciesTags(
        "Speed control is the most important resource in VGC. Manage it carefully.",
        index,
      );
      expect(tags).toEqual([]);
    } finally {
      db.$client.close();
    }
  });

  it("META-T31. multi-species: chunk mentioning two distinct species yields both", () => {
    const db = open(":memory:");
    try {
      seed(db, STD);
      const index = buildSpeciesIndex(db);
      const tags = detectSpeciesTags(
        "Sneasler punishes Incineroar with Fake Out + close combat pressure.",
        index,
      );
      expect(tags).toContain("incineroar");
      expect(tags).toContain("sneasler");
    } finally {
      db.$client.close();
    }
  });

  it("META-T32. case-insensitive: lowercase 'incineroar' still tags 'incineroar'", () => {
    const db = open(":memory:");
    try {
      seed(db, STD);
      const index = buildSpeciesIndex(db);
      const tags = detectSpeciesTags(
        "incineroar is everywhere in the meta",
        index,
      );
      expect(tags).toContain("incineroar");
    } finally {
      db.$client.close();
    }
  });

  it("META-T33. word boundary: 'incineroarish' must NOT match 'incineroar'", () => {
    const db = open(":memory:");
    try {
      seed(db, STD);
      const index = buildSpeciesIndex(db);
      const tags = detectSpeciesTags(
        "the meta has an incineroarish smell to it",
        index,
      );
      expect(tags).not.toContain("incineroar");
    } finally {
      db.$client.close();
    }
  });

  it("META-T34. longest-form-wins: 'Mega Garchomp' tags only 'garchomp-mega', NOT 'garchomp'", () => {
    const db = open(":memory:");
    try {
      seed(db, STD);
      const index = buildSpeciesIndex(db);
      const tags = detectSpeciesTags(
        "Mega Garchomp shreds with Outrage off a 170 base attack.",
        index,
      );
      expect(tags).toContain("garchomp-mega");
      expect(tags).not.toContain("garchomp");
    } finally {
      db.$client.close();
    }
  });

  it("META-T35. alias from species.aliases column resolves to canonical id", () => {
    const db = open(":memory:");
    try {
      // Use an alias-only fixture so we know the match is via alias.
      seed(db, [
        { id: "ho-oh", display_name: "Ho-Oh", is_mega: 0, aliases: ["Ho oh"] },
      ]);
      const index = buildSpeciesIndex(db);
      const tags = detectSpeciesTags("running Ho oh on the team", index);
      expect(tags).toContain("ho-oh");
    } finally {
      db.$client.close();
    }
  });

  it("META-T36. empty species index throws SpeciesTaggerError (contract per flow §8)", () => {
    const db = open(":memory:");
    try {
      // No species seeded — the index must fail loud.
      let thrown: unknown;
      try {
        buildSpeciesIndex(db);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(SpeciesTaggerError);
    } finally {
      db.$client.close();
    }
  });

  it("META-T37. deterministic order: same input yields the same tag order across calls", () => {
    const db = open(":memory:");
    try {
      seed(db, STD);
      const index = buildSpeciesIndex(db);
      const text =
        "Incineroar leads, then Sneasler comes in, then Flutter Mane sweeps.";
      const a = detectSpeciesTags(text, index);
      const b = detectSpeciesTags(text, index);
      expect(a).toEqual(b);
      // Specifically: in-text-order. Incineroar appears first in the prose.
      expect(a[0]).toBe("incineroar");
    } finally {
      db.$client.close();
    }
  });
});
