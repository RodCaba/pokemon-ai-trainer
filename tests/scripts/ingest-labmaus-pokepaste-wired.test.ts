/**
 * Test T42 — `ingest-labmaus` fans out to the pokepaste hook per team.
 *
 * Wires up an end-to-end run with cache-only data (no real network):
 *   - Pre-seeds the labmaus disk cache with one summary list response and
 *     one tournament detail response.
 *   - Pre-seeds the pokepaste disk cache with the corresponding paste body.
 *   - Pre-seeds the SQLite DB with the species/items/abilities/moves rows
 *     the transform's ref-table validator needs to succeed.
 *   - Runs `main(["--no-network", ...])` with a tmp cwd whose
 *     `data/cache/labmaus` and `data/cache/pokepaste` subdirs hold the seeds.
 *
 * Asserts: exit 0, `team_sets` rows for the winning team, summary's
 * `pokepaste.team_sets` matches.
 *
 * Plus T42b — `--no-pokepaste` skips the pokepaste step (no `team_sets`).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "../../scripts/data/ingest-labmaus";
import { open, type Db } from "../../src/db/open";
import {
  species,
  speciesStats,
  speciesAbilities,
  rosterMembership,
  items as itemsTable,
  abilities as abilitiesTable,
  moves as movesTable,
} from "../../src/db/drizzle-schema";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX_LAB = join(HERE, "..", "..", "fixtures", "labmaus");
const FIX_PASTE = join(HERE, "..", "..", "fixtures", "pokepaste");

const SRC_REF = JSON.stringify({
  stats_source: "test fixture",
  movepool_source: "test fixture",
  abilities_source: "test fixture",
  fetched_at: "2026-05-04T00:00:00.000Z",
  engine_sha: "0".repeat(40),
});

/** Minimal source provenance used in items/abilities/moves rows. */
const SOURCE_REF = JSON.stringify({
  origin: "@smogon/calc",
  engine_sha: null,
  source_url: "https://example.test/",
  fetched_at: "2026-05-04T00:00:00.000Z",
});

interface SpeciesSeed { id: string; display: string }
const SPECIES_SEED: SpeciesSeed[] = [
  { id: "charizard", display: "Charizard" },
  { id: "clefable", display: "Clefable" },
  { id: "kingambit", display: "Kingambit" },
  { id: "sneasler", display: "Sneasler" },
  { id: "garchomp", display: "Garchomp" },
  { id: "aerodactyl", display: "Aerodactyl" },
];

interface ItemSeed { id: string; display: string; category: string }
const ITEMS_SEED: ItemSeed[] = [
  { id: "charizarditey", display: "Charizardite Y", category: "mega-stone" },
  { id: "sitrusberry", display: "Sitrus Berry", category: "berry" },
  { id: "blackglasses", display: "Black Glasses", category: "held" },
  { id: "whiteherb", display: "White Herb", category: "held" },
  { id: "choicescarf", display: "Choice Scarf", category: "choice" },
  { id: "focussash", display: "Focus Sash", category: "held" },
];

const ABILITIES_SEED: Array<{ id: string; display: string }> = [
  { id: "blaze", display: "Blaze" },
  { id: "unaware", display: "Unaware" },
  { id: "defiant", display: "Defiant" },
  { id: "unburden", display: "Unburden" },
  { id: "roughskin", display: "Rough Skin" },
  { id: "unnerve", display: "Unnerve" },
];

interface MoveSeed { id: string; display: string }
const MOVES_SEED: MoveSeed[] = [
  { id: "heatwave", display: "Heat Wave" },
  { id: "weatherball", display: "Weather Ball" },
  { id: "solarbeam", display: "Solar Beam" },
  { id: "protect", display: "Protect" },
  { id: "moonblast", display: "Moonblast" },
  { id: "icywind", display: "Icy Wind" },
  { id: "followme", display: "Follow Me" },
  { id: "suckerpunch", display: "Sucker Punch" },
  { id: "kowtowcleave", display: "Kowtow Cleave" },
  { id: "swordsdance", display: "Swords Dance" },
  { id: "fakeout", display: "Fake Out" },
  { id: "closecombat", display: "Close Combat" },
  { id: "gunkshot", display: "Gunk Shot" },
  { id: "earthquake", display: "Earthquake" },
  { id: "stompingtantrum", display: "Stomping Tantrum" },
  { id: "dragonclaw", display: "Dragon Claw" },
  { id: "rockslide", display: "Rock Slide" },
  { id: "tailwind", display: "Tailwind" },
  { id: "wideguard", display: "Wide Guard" },
];

function seedRefTables(db: Db): void {
  db.$client.transaction(() => {
    for (const sp of SPECIES_SEED) {
      db.insert(species)
        .values({
          id: sp.id,
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
        .values({ speciesId: sp.id, hp: 80, atk: 80, def: 80, spa: 80, spd: 80, spe: 80, bst: 480 })
        .run();
      db.insert(speciesAbilities)
        .values({ speciesId: sp.id, slot: "0", abilityName: "Pressure" })
        .run();
      db.insert(rosterMembership)
        .values({ speciesId: sp.id, format: "RegM-A", isLegal: 1, isMega: 0, notes: null })
        .run();
    }
    for (const it of ITEMS_SEED) {
      db.insert(itemsTable)
        .values({ id: it.id, displayName: it.display, category: it.category, sourceJson: SOURCE_REF })
        .run();
    }
    for (const ab of ABILITIES_SEED) {
      db.insert(abilitiesTable)
        .values({ id: ab.id, displayName: ab.display, sourceJson: SOURCE_REF })
        .run();
    }
    for (const mv of MOVES_SEED) {
      db.insert(movesTable)
        .values({
          id: mv.id,
          displayName: mv.display,
          type: "Normal",
          category: "Status",
          basePower: 0,
          accuracy: null,
          sourceJson: SOURCE_REF,
        })
        .run();
    }
  })();
}

/**
 * Sanitize an opaque cache key the same way `src/tools/_shared/file-cache.ts`
 * does — replace any char outside `[a-zA-Z0-9._-]` with `_`.
 */
function sanitizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/**
 * Pre-seed a cache record under the shared file-cache envelope:
 * `<dir>/<sanitized-key>.json` containing `{ fetchedAt, body }` where `body`
 * is a string. For labmaus, callers pass JSON-structured bodies; we stringify
 * them inside the envelope to match what the client writes.
 */
function writeLabmausCache(dir: string, key: string, body: unknown): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, `${sanitizeKey(key)}.json`);
  writeFileSync(
    path,
    JSON.stringify({
      fetchedAt: new Date().toISOString(),
      body: JSON.stringify(body),
    }),
  );
}

/**
 * Pre-seed a pokepaste cache file under the shared file-cache envelope:
 * `<dir>/<paste_id>.json` containing `{ fetchedAt, body }`.
 */
function writePokepasteCache(dir: string, paste_id: string, body: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${sanitizeKey(paste_id)}.json`),
    JSON.stringify({
      fetchedAt: new Date().toISOString(),
      body,
    }),
  );
}

describe("ingest-labmaus pokepaste wiring", () => {
  let tmpDir: string;
  let labmausCacheDir: string;
  let pokepasteCacheDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ingest-labmaus-wired-"));
    labmausCacheDir = join(tmpDir, "data", "cache", "labmaus");
    pokepasteCacheDir = join(tmpDir, "data", "cache", "pokepaste");
    // Cache paths are env-driven; stub for the duration of each test.
    vi.stubEnv("LABMAUS_CACHE_DIR", labmausCacheDir);
    vi.stubEnv("POKEPASTE_CACHE_DIR", pokepasteCacheDir);

    // Seed labmaus list cache (one tournament: 56757).
    const summary = [
      {
        date: "2026-05-04",
        division: "Masters",
        id: 56757,
        name: "Sketch Academy Champions Regulation M-A Tournament",
        num_players: 42,
        regulation: "Regulation Set M-A",
        status: "unofficial",
      },
    ];
    writeLabmausCache(
      labmausCacheDir,
      "list/Regulation Set M-A/2026-05-04_2026-05-04",
      summary,
    );
    // Seed labmaus tournament detail cache.
    const detail = JSON.parse(
      readFileSync(join(FIX_LAB, "2026-05-04__tournament_56757.json"), "utf8"),
    ) as unknown;
    writeLabmausCache(labmausCacheDir, "tournament/56757", detail);
    // Seed pokepaste cache for the 1st-place team's paste id.
    const paste = readFileSync(join(FIX_PASTE, "2026-05-04__7205bf28f85d1e79.txt"), "utf8");
    writePokepasteCache(pokepasteCacheDir, "7205bf28f85d1e79", paste);

    // Build the on-disk DB and seed ref tables.
    dbPath = join(tmpDir, "test.sqlite");
    const db = open(dbPath);
    try {
      seedRefTables(db);
    } finally {
      db.$client.close();
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("T42. wires pokepaste hook into ingest — team_sets persisted for cached teams", async () => {
    // Capture stdout for the JSON summary line.
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]): void => {
      logs.push(args.map(String).join(" "));
    };
    let exit: number;
    try {
      exit = await main([
        "--no-network",
        "--from",
        "2026-05-04",
        "--to",
        "2026-05-04",
        "--db",
        dbPath,
      ]);
    } finally {
      console.log = origLog;
    }
    expect(exit).toBe(0);

    // Verify team_sets rows were written for the 1st-place team.
    const db = open(dbPath, { readonly: true });
    try {
      const winningTeamId = db.$client
        .prepare(
          "SELECT id FROM tournament_teams WHERE tournament_id = ? AND placement = 1",
        )
        .get("labmaus:56757") as { id: string } | undefined;
      expect(winningTeamId).toBeDefined();
      const teamSets = db.$client
        .prepare("SELECT COUNT(*) as n FROM team_sets WHERE tournament_team_id = ?")
        .get(winningTeamId?.id) as { n: number };
      expect(teamSets.n).toBeGreaterThan(0);
    } finally {
      db.$client.close();
    }

    // Verify the JSON summary line carries pokepaste.team_sets matching.
    const summaryLine = logs.find((l) => l.includes('"pokepaste"'));
    expect(summaryLine).toBeDefined();
    const parsed = JSON.parse(summaryLine ?? "{}") as {
      ok: boolean;
      pokepaste: { team_sets: number };
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.pokepaste.team_sets).toBeGreaterThan(0);
  });

  it("T42c. skip-existing: a tournament already in the DB is not re-fetched and is left untouched", async () => {
    // Pre-seed the tournament row with a SENTINEL name. If the ingest
    // re-fetches and re-upserts it, the name will be overwritten with the
    // fixture's actual name. The skip-existing guard means we should never
    // call client.getTournament for this id, so the row stays as-seeded.
    //
    // We also assert via the JSON summary line that `skipped_existing: 1`
    // was emitted. To detect that the cached payload was not read, we
    // additionally check that the would-be-written `tournament_teams` and
    // `tournament_team_species` rows do NOT appear (they wouldn't exist
    // because we only seeded the parent row).
    const SENTINEL_NAME = "PRE-SEEDED — must not be overwritten";
    const dbSeed = open(dbPath);
    try {
      dbSeed.$client.exec(`
        INSERT INTO tournaments (id, external_id, name, format, division, status, date,
          num_players, source_site, source_url, fetched_at)
        VALUES ('labmaus:56757', 56757, '${SENTINEL_NAME}', 'RegM-A', 'Masters',
          'unofficial', '2026-05-04', 42, 'labmaus',
          'https://labmaus.net/tournaments/56757', '2026-05-04T00:00:00Z');
      `);
    } finally {
      dbSeed.$client.close();
    }

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]): void => {
      logs.push(args.map(String).join(" "));
    };
    let exit: number;
    try {
      exit = await main([
        "--no-network",
        "--from",
        "2026-05-04",
        "--to",
        "2026-05-04",
        "--db",
        dbPath,
      ]);
    } finally {
      console.log = origLog;
    }
    expect(exit).toBe(0);

    const db = open(dbPath, { readonly: true });
    try {
      // Sentinel name preserved → skip-existing fired.
      const row = db.$client
        .prepare("SELECT name FROM tournaments WHERE id = 'labmaus:56757'")
        .get() as { name: string };
      expect(row.name).toBe(SENTINEL_NAME);

      // No teams or species were inserted because we never reached the
      // upsert path for this tournament.
      const teams = db.$client
        .prepare("SELECT COUNT(*) AS n FROM tournament_teams WHERE tournament_id = 'labmaus:56757'")
        .get() as { n: number };
      expect(teams.n).toBe(0);
      const species = db.$client
        .prepare(
          "SELECT COUNT(*) AS n FROM tournament_team_species s JOIN tournament_teams t ON t.id = s.team_id WHERE t.tournament_id = 'labmaus:56757'",
        )
        .get() as { n: number };
      expect(species.n).toBe(0);
    } finally {
      db.$client.close();
    }

    // Summary line carries skipped_existing: 1 and tournaments: 0.
    const summaryLine = logs.find((l) => l.includes('"pokepaste"'));
    expect(summaryLine).toBeDefined();
    const parsed = JSON.parse(summaryLine ?? "{}") as {
      ok: boolean;
      tournaments: number;
      skipped_existing: number;
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.tournaments).toBe(0);
    expect(parsed.skipped_existing).toBe(1);
  });

  it("T42b. --no-pokepaste skips the pokepaste step (no team_sets rows)", async () => {
    const origLog = console.log;
    console.log = (): void => {};
    let exit: number;
    try {
      exit = await main([
        "--no-network",
        "--no-pokepaste",
        "--from",
        "2026-05-04",
        "--to",
        "2026-05-04",
        "--db",
        dbPath,
      ]);
    } finally {
      console.log = origLog;
    }
    expect(exit).toBe(0);

    const db = open(dbPath, { readonly: true });
    try {
      const teamSets = db.$client
        .prepare("SELECT COUNT(*) as n FROM team_sets")
        .get() as { n: number };
      expect(teamSets.n).toBe(0);
    } finally {
      db.$client.close();
    }
  });
});
