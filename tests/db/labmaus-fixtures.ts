/**
 * Test helpers for labmaus DB tests. Builds an in-memory SQLite seeded with
 * the roster's species set covering every labmaus dex-id present in the
 * committed fixtures (so FK targets exist when tests need to assert against
 * canonical roster ids — e.g. via `team_sets.species_roster_id`).
 *
 * Mirrors the pattern of `tests/data/fixtures.ts`.
 *
 * Note: post the 2026-05-05 simplification, the labmaus slice no longer owns
 * a species-alias table. Canonical roster attribution lives on
 * `team_sets.species_roster_id` (owned by the parallel `pokepaste-sets`
 * slice). This helper still seeds the species table so any test that wants
 * to seed a `team_sets` row (with `species_roster_id` referencing roster
 * member ids) has valid FK targets.
 */

import { open, type Db } from "../../src/db/open";
import {
  species,
  speciesStats,
  speciesAbilities,
} from "../../src/db/drizzle-schema";

const SRC_REF = JSON.stringify({
  origin: "test fixture",
  fetched_at: "2026-05-04T00:00:00Z",
});

/**
 * One entry per unique labmaus id observed across the four committed
 * fixtures, with the canonical roster id derived from the fixture's
 * `team_names` (gender symbols `♂`/`♀` collapse to `m`/`f`; everything else
 * is lowercased + alphanumeric-only). The labmaus id is retained for tests
 * that want to assert about it; the roster id is what gets seeded into the
 * species table.
 */
const COMBINED_SEED: Array<{ labmausId: string; rosterId: string; display: string }> = [
  { labmausId: "003", rosterId: "venusaur", display: "Venusaur" },
  { labmausId: "006", rosterId: "charizard", display: "Charizard" },
  { labmausId: "009", rosterId: "blastoise", display: "Blastoise" },
  { labmausId: "015", rosterId: "beedrill", display: "Beedrill" },
  { labmausId: "024", rosterId: "arbok", display: "Arbok" },
  { labmausId: "025", rosterId: "pikachu", display: "Pikachu" },
  { labmausId: "026", rosterId: "raichu", display: "Raichu" },
  { labmausId: "036", rosterId: "clefable", display: "Clefable" },
  { labmausId: "038-a", rosterId: "ninetalesalola", display: "Ninetales-Alola" },
  { labmausId: "059", rosterId: "arcanine", display: "Arcanine" },
  { labmausId: "059-h", rosterId: "arcaninehisui", display: "Arcanine-Hisui" },
  { labmausId: "065", rosterId: "alakazam", display: "Alakazam" },
  { labmausId: "068", rosterId: "machamp", display: "Machamp" },
  { labmausId: "071-m", rosterId: "victreebelmega", display: "Victreebel-Mega" },
  { labmausId: "080-g", rosterId: "slowbrogalar", display: "Slowbro-Galar" },
  { labmausId: "094", rosterId: "gengar", display: "Gengar" },
  { labmausId: "1013", rosterId: "sinistcha", display: "Sinistcha" },
  { labmausId: "1018", rosterId: "archaludon", display: "Archaludon" },
  { labmausId: "1019", rosterId: "hydrapple", display: "Hydrapple" },
  { labmausId: "115", rosterId: "kangaskhan", display: "Kangaskhan" },
  { labmausId: "121", rosterId: "starmie", display: "Starmie" },
  { labmausId: "128-a", rosterId: "taurospaldeaaqua", display: "Tauros-Paldea-Aqua" },
  { labmausId: "128-b", rosterId: "taurospaldeablaze", display: "Tauros-Paldea-Blaze" },
  { labmausId: "130", rosterId: "gyarados", display: "Gyarados" },
  { labmausId: "132", rosterId: "ditto", display: "Ditto" },
  { labmausId: "134", rosterId: "vaporeon", display: "Vaporeon" },
  { labmausId: "142", rosterId: "aerodactyl", display: "Aerodactyl" },
  { labmausId: "143", rosterId: "snorlax", display: "Snorlax" },
  { labmausId: "149", rosterId: "dragonite", display: "Dragonite" },
  { labmausId: "154", rosterId: "meganium", display: "Meganium" },
  { labmausId: "157-h", rosterId: "typhlosionhisui", display: "Typhlosion-Hisui" },
  { labmausId: "160", rosterId: "feraligatr", display: "Feraligatr" },
  { labmausId: "184", rosterId: "azumarill", display: "Azumarill" },
  { labmausId: "186", rosterId: "politoed", display: "Politoed" },
  { labmausId: "212", rosterId: "scizor", display: "Scizor" },
  { labmausId: "227", rosterId: "skarmory", display: "Skarmory" },
  { labmausId: "248", rosterId: "tyranitar", display: "Tyranitar" },
  { labmausId: "279", rosterId: "pelipper", display: "Pelipper" },
  { labmausId: "282", rosterId: "gardevoir", display: "Gardevoir" },
  { labmausId: "302", rosterId: "sableye", display: "Sableye" },
  { labmausId: "306", rosterId: "aggron", display: "Aggron" },
  { labmausId: "308", rosterId: "medicham", display: "Medicham" },
  { labmausId: "310", rosterId: "manectric", display: "Manectric" },
  { labmausId: "319", rosterId: "sharpedo", display: "Sharpedo" },
  { labmausId: "324", rosterId: "torkoal", display: "Torkoal" },
  { labmausId: "350", rosterId: "milotic", display: "Milotic" },
  { labmausId: "351", rosterId: "castform", display: "Castform" },
  { labmausId: "392", rosterId: "infernape", display: "Infernape" },
  { labmausId: "395", rosterId: "empoleon", display: "Empoleon" },
  { labmausId: "405", rosterId: "luxray", display: "Luxray" },
  { labmausId: "428", rosterId: "lopunny", display: "Lopunny" },
  { labmausId: "442", rosterId: "spiritomb", display: "Spiritomb" },
  { labmausId: "445", rosterId: "garchomp", display: "Garchomp" },
  { labmausId: "448", rosterId: "lucario", display: "Lucario" },
  { labmausId: "460", rosterId: "abomasnow", display: "Abomasnow" },
  { labmausId: "461", rosterId: "weavile", display: "Weavile" },
  { labmausId: "464", rosterId: "rhyperior", display: "Rhyperior" },
  { labmausId: "471", rosterId: "glaceon", display: "Glaceon" },
  { labmausId: "472", rosterId: "gliscor", display: "Gliscor" },
  { labmausId: "473", rosterId: "mamoswine", display: "Mamoswine" },
  { labmausId: "475", rosterId: "gallade", display: "Gallade" },
  { labmausId: "478", rosterId: "froslass", display: "Froslass" },
  { labmausId: "479-f", rosterId: "rotomfrost", display: "Rotom-Frost" },
  { labmausId: "479-h", rosterId: "rotomheat", display: "Rotom-Heat" },
  { labmausId: "479-w", rosterId: "rotomwash", display: "Rotom-Wash" },
  { labmausId: "503-h", rosterId: "samurotthisui", display: "Samurott-Hisui" },
  { labmausId: "530", rosterId: "excadrill", display: "Excadrill" },
  { labmausId: "547", rosterId: "whimsicott", display: "Whimsicott" },
  { labmausId: "563", rosterId: "cofagrigus", display: "Cofagrigus" },
  { labmausId: "569", rosterId: "garbodor", display: "Garbodor" },
  { labmausId: "571", rosterId: "zoroark", display: "Zoroark" },
  { labmausId: "571-h", rosterId: "zoroarkhisui", display: "Zoroark-Hisui" },
  { labmausId: "584", rosterId: "vanilluxe", display: "Vanilluxe" },
  { labmausId: "609", rosterId: "chandelure", display: "Chandelure" },
  { labmausId: "623", rosterId: "golurk", display: "Golurk" },
  { labmausId: "635", rosterId: "hydreigon", display: "Hydreigon" },
  { labmausId: "637", rosterId: "volcarona", display: "Volcarona" },
  { labmausId: "652", rosterId: "chesnaught", display: "Chesnaught" },
  { labmausId: "655", rosterId: "delphox", display: "Delphox" },
  { labmausId: "658", rosterId: "greninja", display: "Greninja" },
  { labmausId: "663", rosterId: "talonflame", display: "Talonflame" },
  { labmausId: "670", rosterId: "floette", display: "Floette" },
  { labmausId: "675", rosterId: "pangoro", display: "Pangoro" },
  { labmausId: "678", rosterId: "meowsticm", display: "Meowstic \u2642" },
  { labmausId: "681", rosterId: "aegislashblade", display: "Aegislash-Blade" },
  { labmausId: "683", rosterId: "aromatisse", display: "Aromatisse" },
  { labmausId: "695", rosterId: "heliolisk", display: "Heliolisk" },
  { labmausId: "699", rosterId: "aurorus", display: "Aurorus" },
  { labmausId: "700", rosterId: "sylveon", display: "Sylveon" },
  { labmausId: "701", rosterId: "hawlucha", display: "Hawlucha" },
  { labmausId: "706", rosterId: "goodra", display: "Goodra" },
  { labmausId: "706-h", rosterId: "goodrahisui", display: "Goodra-Hisui" },
  { labmausId: "715", rosterId: "noivern", display: "Noivern" },
  { labmausId: "724-h", rosterId: "decidueyehisui", display: "Decidueye-Hisui" },
  { labmausId: "727", rosterId: "incineroar", display: "Incineroar" },
  { labmausId: "730", rosterId: "primarina", display: "Primarina" },
  { labmausId: "740", rosterId: "crabominable", display: "Crabominable" },
  { labmausId: "748", rosterId: "toxapex", display: "Toxapex" },
  { labmausId: "752", rosterId: "araquanid", display: "Araquanid" },
  { labmausId: "763", rosterId: "tsareena", display: "Tsareena" },
  { labmausId: "765", rosterId: "oranguru", display: "Oranguru" },
  { labmausId: "778", rosterId: "mimikyu", display: "Mimikyu" },
  { labmausId: "780", rosterId: "drampa", display: "Drampa" },
  { labmausId: "784", rosterId: "kommoo", display: "Kommo-o" },
  { labmausId: "823", rosterId: "corviknight", display: "Corviknight" },
  { labmausId: "858", rosterId: "hatterene", display: "Hatterene" },
  { labmausId: "866", rosterId: "mrrime", display: "Mr. Rime" },
  { labmausId: "887", rosterId: "dragapult", display: "Dragapult" },
  { labmausId: "900", rosterId: "kleavor", display: "Kleavor" },
  { labmausId: "902", rosterId: "basculegionm", display: "Basculegion \u2642" },
  { labmausId: "902-f", rosterId: "basculegionf", display: "Basculegion \u2640" },
  { labmausId: "903", rosterId: "sneasler", display: "Sneasler" },
  { labmausId: "908", rosterId: "meowscarada", display: "Meowscarada" },
  { labmausId: "911", rosterId: "skeledirge", display: "Skeledirge" },
  { labmausId: "914", rosterId: "quaquaval", display: "Quaquaval" },
  { labmausId: "925", rosterId: "maushold", display: "Maushold" },
  { labmausId: "934", rosterId: "garganacl", display: "Garganacl" },
  { labmausId: "936", rosterId: "armarouge", display: "Armarouge" },
  { labmausId: "937", rosterId: "ceruledge", display: "Ceruledge" },
  { labmausId: "939", rosterId: "bellibolt", display: "Bellibolt" },
  { labmausId: "952", rosterId: "scovillain", display: "Scovillain" },
  { labmausId: "959", rosterId: "tinkaton", display: "Tinkaton" },
  { labmausId: "964", rosterId: "palafin", display: "Palafin" },
  { labmausId: "968", rosterId: "orthworm", display: "Orthworm" },
  { labmausId: "970", rosterId: "glimmora", display: "Glimmora" },
  { labmausId: "981", rosterId: "farigiraf", display: "Farigiraf" },
  { labmausId: "983", rosterId: "kingambit", display: "Kingambit" },
];

/**
 * Build an in-memory SQLite handle with the species rows pre-populated. Tests
 * that need `team_sets` rows seeded should insert them directly using
 * `species_roster_id` values from this list.
 */
export function seedLabmausDb(): Db {
  const db = open(":memory:");

  db.$client.transaction(() => {
    for (const sp of COMBINED_SEED) {
      db.insert(species)
        .values({
          id: sp.rosterId,
          displayName: sp.display,
          formId: null,
          isMega: 0,
          types: JSON.stringify(["Normal"]),
          weightKg: 50,
          aliases: "[]",
          movepool: "[]",
          sourceJson: SRC_REF,
        })
        .run();
      db.insert(speciesStats)
        .values({
          speciesId: sp.rosterId,
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
        .values({ speciesId: sp.rosterId, slot: "0", abilityName: "Pressure" })
        .run();
    }
  })();

  return db;
}

export function closeIfOpen(db: Db): void {
  if (db.$client.open) db.$client.close();
}
