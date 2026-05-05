/**
 * Test helpers for labmaus DB tests. Builds an in-memory SQLite seeded with:
 * - the roster's tiny species set (so FK targets exist)
 * - a small `species_alias_labmaus` seed (a handful of known mappings)
 *
 * Mirrors the pattern of `tests/data/fixtures.ts`.
 */

import { open, type Db } from "../../src/db/open";
import {
  species,
  speciesAliasLabmaus,
  speciesStats,
  speciesAbilities,
} from "../../src/db/drizzle-schema";

const SRC_REF = JSON.stringify({
  origin: "test fixture",
  fetched_at: "2026-05-04T00:00:00Z",
});

const SPECIES_SEED = [
  { id: "charizard", display: "Charizard", types: ["Fire", "Flying"] },
  { id: "clefable", display: "Clefable", types: ["Fairy"] },
  { id: "kingambit", display: "Kingambit", types: ["Dark", "Steel"] },
  { id: "sneasler", display: "Sneasler", types: ["Fighting", "Poison"] },
  { id: "garchomp", display: "Garchomp", types: ["Dragon", "Ground"] },
  { id: "aerodactyl", display: "Aerodactyl", types: ["Rock", "Flying"] },
  { id: "ninetalesalola", display: "Ninetales-Alola", types: ["Ice", "Fairy"] },
  { id: "rotomwash", display: "Rotom-Wash", types: ["Electric", "Water"] },
  { id: "basculegionm", display: "Basculegion-M", types: ["Water", "Ghost"] },
  { id: "incineroar", display: "Incineroar", types: ["Fire", "Dark"] },
  { id: "floette", display: "Floette", types: ["Fairy"] },
] as const;

/**
 * Seed labmaus alias rows. Pass the labmaus → roster mappings you need;
 * the helper inserts them and returns the open DB.
 */
export const ALIAS_SEED: Array<{ labmausId: string; rosterId: string }> = [
  { labmausId: "006", rosterId: "charizard" },
  { labmausId: "036", rosterId: "clefable" },
  { labmausId: "983", rosterId: "kingambit" },
  { labmausId: "903", rosterId: "sneasler" },
  { labmausId: "445", rosterId: "garchomp" },
  { labmausId: "142", rosterId: "aerodactyl" },
  { labmausId: "038-a", rosterId: "ninetalesalola" },
  { labmausId: "479-w", rosterId: "rotomwash" },
  { labmausId: "902", rosterId: "basculegionm" },
  { labmausId: "727", rosterId: "incineroar" },
  { labmausId: "670", rosterId: "floette" },
];

export interface SeedOpts {
  /** If false, omit the alias seed (so unknown-id paths can be tested). */
  seedAliases?: boolean;
  /** Subset of `ALIAS_SEED` to insert; default = all. */
  aliasSubset?: Array<{ labmausId: string; rosterId: string }>;
}

/**
 * Build an in-memory SQLite handle with species + alias rows pre-populated.
 */
export function seedLabmausDb(opts: SeedOpts = {}): Db {
  const db = open(":memory:");
  const seedAliases = opts.seedAliases ?? true;
  const aliasRows = opts.aliasSubset ?? ALIAS_SEED;

  db.$client.transaction(() => {
    for (const sp of SPECIES_SEED) {
      db.insert(species)
        .values({
          id: sp.id,
          displayName: sp.display,
          formId: null,
          isMega: 0,
          types: JSON.stringify(sp.types),
          weightKg: 50,
          aliases: "[]",
          movepool: "[]",
          sourceJson: SRC_REF,
        })
        .run();
      db.insert(speciesStats)
        .values({
          speciesId: sp.id,
          hp: 80,
          atk: 80,
          def: 80,
          spa: 80,
          spd: 80,
          spe: 80,
          bst: 480,
        })
        .run();
      db.insert(speciesAbilities)
        .values({ speciesId: sp.id, slot: "0", abilityName: "Pressure" })
        .run();
    }
    if (seedAliases) {
      for (const a of aliasRows) {
        db.insert(speciesAliasLabmaus)
          .values({ id: a.labmausId, rosterId: a.rosterId, sourceJson: SRC_REF })
          .run();
      }
    }
  })();

  return db;
}

export function closeIfOpen(db: Db): void {
  if (db.$client.open) db.$client.close();
}
