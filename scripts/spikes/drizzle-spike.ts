import { eq, sql } from "drizzle-orm";
import { seedTinyDb } from "../../tests/data/fixtures";
import { species, speciesStats, sampleSets } from "../../src/db/drizzle-schema";

async function main(): Promise<void> {
  const db = seedTinyDb();
  const garchomp = db.select().from(species).where(eq(species.id, "garchomp")).get();
  console.log("type-safe select:", garchomp?.displayName, "dex_no=" + garchomp?.dexNo);

  const garchompWithStats = db
    .select({ name: species.displayName, hp: speciesStats.hp, atk: speciesStats.atk, bst: speciesStats.bst })
    .from(species)
    .innerJoin(speciesStats, eq(species.id, speciesStats.speciesId))
    .where(eq(species.id, "garchomp"))
    .get();
  console.log("type-safe join:", garchompWithStats);

  const tt = db
    .select()
    .from(species)
    .where(sql`${species.displayName} = 'tyranitar' COLLATE NOCASE`)
    .get();
  console.log("case-insensitive lookup tyranitar:", tt?.displayName);

  const sets = db.select().from(sampleSets).where(eq(sampleSets.speciesId, "garchomp")).all();
  console.log("garchomp sets:", sets.length, "->", sets.map((s) => s.setName).join(", "));

  try {
    db.insert(sampleSets).values({
      speciesId: "garchomp",
      setName: "Bad SPS",
      ability: "Rough Skin",
      item: null,
      nature: "Adamant",
      movesJson: JSON.stringify(["Earthquake", "Dragon Claw", "Stone Edge", "Outrage"]),
      spsJson: JSON.stringify({ hp: 32, atk: 32, def: 3, spa: 0, spd: 0, spe: 0 }),
      sourceJson: "{}",
    }).run();
    console.log("CHECK constraint MISSED — bad");
  } catch (e) {
    console.log("CHECK constraint caught SPS>66 ✓");
  }

  db.$client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
