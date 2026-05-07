import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { Generations } from "@smogon/calc";
import { Dex } from "@pkmn/dex";
import { open } from "../../src/db/open";
import {
  abilities as abilitiesTable,
  items as itemsTable,
  moves as movesTable,
  rosterMembership,
  sampleSets as sampleSetsTable,
  species as speciesTable,
  speciesAbilities,
  speciesStats,
} from "../../src/db/drizzle-schema";
import type { ItemCategory } from "../../src/schemas/item";
import { parseChampionsSets } from "../../src/data/parseChampionsSets";

// Build pipeline for the Reg M-A roster DB. Hybrid source:
//   - @smogon/calc Generations.get(0) (Champions slice) — canonical for the Champions
//     roster, stats, types, weight, and the calc-active ability. Champions has
//     286 species, 117 items, 211 abilities, 496 moves.
//   - @pkmn/dex Dex.forGen(9) (SV, used as proxy) — supplements with full ability
//     lists per species (slots 0/1/H), per-species learnsets (filtered against
//     the Champions move table), per-move accuracy, and item category hints.
//
// Determinism: insertion order is deterministic (sorted ids); applied_at on
// schema_migrations is the frozen literal '1970-01-01T00:00:00Z'; we run
// PRAGMA journal_mode=DELETE + VACUUM at the end to ensure stable file bytes.
//
// Non-destructive: the build opens `dbPath` in place and rewrites only the
// "category A" reference tables (Champions roster + items/abilities/moves +
// sample sets). Labmaus tables (`tournaments`, `tournament_teams`,
// `tournament_team_species`, `team_sets`) are never touched — they're owned
// by the labmaus ingest pipeline and now hold production data that the build
// must preserve. Previously the build did `unlink + tmp + rename`, which
// destroyed those rows. See docs/plans/labmaus-tournaments.md §17.
//
// All category A writes run inside a single `db.$client.transaction(...)` so
// the DB is never observably half-built.
//
// Output: data/reg-m-a/db.sqlite (in-place, transactional, byte-deterministic
// over category A).

const DEFAULT_DB_PATH = "data/reg-m-a/db.sqlite";
// TODO(engine-sha-source): read from pnpm-lock.yaml at build time so this can't
// drift from the package.json pin. v1: hand-synced.
const ENGINE_SHA = "c1f6bc0fa2e0ee068b9e3061fa68b7db307e6c55"; // RodCaba/damage-calc#champions-pinned-build
const FETCHED_AT = "2026-05-04T00:00:00Z"; // frozen for determinism

const champ = Generations.get(0);
const sv = Dex.forGen(9);

interface Counts {
  species: number;
  abilitySlots: number;
  movepoolMoves: number;
  items: number;
  abilities: number;
  moves: number;
  movesDroppedFromMovepools: number;
  sampleSets: number;
  sampleSetsSkippedUnknownSpecies: number;
}

const SETDEX_SNAPSHOT_PATH = "data/reg-m-a/raw-sets.smogon.json";
const ALIASES_PATH = "data/reg-m-a/aliases.json";

/**
 * Build the Reg M-A roster DB at `dbPath`.
 *
 * **When to use it:** the `pnpm data:build:reg-m-a` script calls this with the
 * default repo path. Tests call it with a `/tmp/...` path to verify determinism
 * without clobbering the committed `db.sqlite`.
 *
 * The build is deterministic over category A: same inputs → byte-identical
 * category A bytes. Non-destructive: opens `dbPath` in place and rewrites only
 * the Champions reference tables (`species`, `species_stats`,
 * `species_abilities`, `items`, `abilities`, `moves`, `sample_sets`,
 * `roster_membership`). Labmaus tables (`tournaments`, `tournament_teams`,
 * `tournament_team_species`, `team_sets`) are never touched.
 *
 * All writes happen in a single transaction so the DB is never observably
 * half-built. `PRAGMA journal_mode=DELETE; VACUUM;` at the end keeps file
 * bytes stable.
 *
 * @param dbPath — Destination file path. Defaults to `data/reg-m-a/db.sqlite`.
 * @param opts — `{ verbose }` controls console output. Tests pass `verbose: false`.
 * @returns A `Counts` summary of rows written.
 */
export async function buildRegMA(
  dbPath: string = DEFAULT_DB_PATH,
  opts: { verbose?: boolean } = {},
): Promise<Counts> {
  const verbose = opts.verbose ?? true;
  const log = verbose ? console.log : (): void => undefined;

  log(`build-reg-m-a — engine_sha=${ENGINE_SHA.slice(0, 8)}…`);
  mkdirSync(dirname(dbPath), { recursive: true });

  // Open the destination DB in place. `open()` applies migrations idempotently,
  // so an empty file gets schema bootstrapped and an existing DB (with labmaus
  // rows) just has the build's category A writes layered on top.
  const db = open(dbPath);
  const counts: Counts = {
    species: 0, abilitySlots: 0, movepoolMoves: 0, items: 0, abilities: 0, moves: 0,
    movesDroppedFromMovepools: 0, sampleSets: 0, sampleSetsSkippedUnknownSpecies: 0,
  };

  // 1. Build the Champions move id set FIRST so we can filter movepools.
  const championsMoveIds = new Set<string>();
  for (const m of champ.moves) championsMoveIds.add(m.id);

  // 1b. Load curated aliases (id → string[]). Missing file → empty map.
  const aliasesById = loadAliases();

  // Pre-collect+sort everything BEFORE opening the write transaction.
  const sortedItems = collect(champ.items).sort((a, b) => a.id.localeCompare(b.id));
  const sortedAbilities = collect(champ.abilities).sort((a, b) => a.id.localeCompare(b.id));
  const sortedMoves = collect(champ.moves).sort((a, b) => a.id.localeCompare(b.id));
  const sortedSpecies = collect(champ.species).sort((a, b) => a.id.localeCompare(b.id));

  // Pre-fetch all learnsets in parallel so we don't sequentially await inside a tx.
  // Alternate forms (Megas, Aegislash Blade/Shield/Both, Castform weather, etc.)
  // share their base form's learnset in @pkmn/dex. Walk the baseSpecies chain
  // from BOTH @smogon/calc (which knows e.g. aegislashboth → Aegislash-Blade) and
  // @pkmn/dex (which knows e.g. aegislashblade → Aegislash) until we find a real
  // learnset. First source with moves wins. Visited-set prevents infinite loops.
  const movepoolBySpecies = new Map<string, Set<string>>();
  const toId = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

  await Promise.all(sortedSpecies.map(async (sp) => {
    const moves = new Set<string>();
    const visited = new Set<string>();
    const queue: string[] = [sp.id];

    while (queue.length > 0) {
      const id = queue.shift();
      if (!id || visited.has(id)) continue;
      visited.add(id);

      const ls = await sv.learnsets.get(id).catch(() => null);
      if (ls?.learnset) {
        for (const moveId of Object.keys(ls.learnset)) {
          if (championsMoveIds.has(moveId)) moves.add(moveId);
          else counts.movesDroppedFromMovepools++;
        }
        if (moves.size > 0) break;
      }

      // Enqueue baseSpecies candidates from BOTH sources.
      const calcSp = champ.species.get(id as Parameters<typeof champ.species.get>[0]) as
        | { baseSpecies?: string; name?: string }
        | undefined;
      if (calcSp?.baseSpecies && calcSp.baseSpecies !== calcSp.name) {
        queue.push(toId(calcSp.baseSpecies));
      }
      const dexSp = sv.species.get(id);
      if (dexSp) {
        const dexNameId = toId(dexSp.name);
        if (dexNameId !== id) queue.push(dexNameId);
        if (dexSp.baseSpecies && dexSp.baseSpecies !== dexSp.name) {
          queue.push(toId(dexSp.baseSpecies));
        }
      }
    }
    movepoolBySpecies.set(sp.id, moves);
  }));

  // 5b. Pre-load sample sets from the SETDEX snapshot (if present) so the
  // entire write phase fits in one transaction.
  let sampleSetRows: ReturnType<typeof parseChampionsSets>["rows"] | null = null;
  if (existsSync(SETDEX_SNAPSHOT_PATH)) {
    const snapshotJson = JSON.parse(readFileSync(SETDEX_SNAPSHOT_PATH, "utf8")) as {
      source_url: string;
      fetched_at: string;
      setdex: unknown;
    };
    const { rows: parsed, skipped } = parseChampionsSets(snapshotJson.setdex, {
      set_source: snapshotJson.source_url,
      fetched_at: FETCHED_AT, // frozen for determinism, not snapshotJson.fetched_at
    });
    if (skipped.length > 0) {
      log(`(skipped ${skipped.length} malformed upstream sets — first: ${skipped[0]?.species_display_name}/${skipped[0]?.set_name}: ${skipped[0]?.reason})`);
    }
    sampleSetRows = parsed;
  } else {
    log(`(skipped sample sets: ${SETDEX_SNAPSHOT_PATH} not found — run pnpm data:refresh:reg-m-a)`);
  }

  // Single transaction for ALL category A writes. Labmaus tables
  // (`tournaments`, `tournament_teams`, `tournament_team_species`,
  // `team_sets`) are NEVER touched by this script — they're owned by the
  // labmaus ingest pipeline.
  //
  // Strategy: DELETE+INSERT for tables with no incoming FK from labmaus
  // (`items`, `abilities`, `moves`, `sample_sets`, `species_stats`,
  // `species_abilities`, `roster_membership`); UPSERT for `species` because
  // `team_sets.species_roster_id` references it (a DELETE would cascade-block
  // or orphan production data). Stale species rows (a name no longer in
  // Champions) stay — removing them is a manual op that warrants review.
  db.$client.transaction(() => {
    // Wipe child tables first so cascades from species don't fire (we're
    // upserting species in place, not deleting). These tables have no
    // incoming FKs from labmaus.
    db.$client.exec(`
      DELETE FROM sample_sets;
      DELETE FROM species_abilities;
      DELETE FROM species_stats;
      DELETE FROM roster_membership;
      DELETE FROM items;
      DELETE FROM abilities;
      DELETE FROM moves;
    `);

    // Items.
    for (const it of sortedItems) {
      db.insert(itemsTable).values({
        id: it.id,
        displayName: it.name,
        category: deriveItemCategory(it.id, it.name),
        sourceJson: JSON.stringify(makeRefSource()),
      }).run();
      counts.items++;
    }

    // Abilities.
    for (const ab of sortedAbilities) {
      db.insert(abilitiesTable).values({
        id: ab.id,
        displayName: ab.name,
        sourceJson: JSON.stringify(makeRefSource()),
      }).run();
      counts.abilities++;
    }

    // Moves.
    for (const m of sortedMoves) {
      const dexMove = sv.moves.get(m.id);
      const accuracy = normalizeAccuracy(dexMove?.accuracy);
      const basePower = m.basePower ?? 0;
      const category = m.category ?? (basePower === 0 ? "Status" : "Physical");
      db.insert(movesTable).values({
        id: m.id,
        displayName: m.name,
        type: m.type ?? "Normal",
        category,
        basePower,
        accuracy,
        sourceJson: JSON.stringify(makeRefSource()),
      }).run();
      counts.moves++;
    }

    // Species — UPSERT (so team_sets.species_roster_id FK stays valid) and
    // its child rows (DELETEd above, now reinserted).
    for (const sp of sortedSpecies) {
      const isMega = sp.name.includes("-Mega") ? 1 : 0;
      const movepool = Array.from(movepoolBySpecies.get(sp.id) ?? new Set<string>()).sort();
      counts.movepoolMoves += movepool.length;

      db.insert(speciesTable)
        .values({
          id: sp.id,
          displayName: sp.name,
          formId: deriveFormId(sp),
          isMega,
          types: JSON.stringify(sp.types),
          weightKg: sp.weightkg,
          aliases: JSON.stringify(aliasesById[sp.id] ?? []),
          movepool: JSON.stringify(movepool),
          sourceJson: JSON.stringify(makePokemonSource()),
        })
        .onConflictDoUpdate({
          target: speciesTable.id,
          set: {
            displayName: sp.name,
            formId: deriveFormId(sp),
            isMega,
            types: JSON.stringify(sp.types),
            weightKg: sp.weightkg,
            aliases: JSON.stringify(aliasesById[sp.id] ?? []),
            movepool: JSON.stringify(movepool),
            sourceJson: JSON.stringify(makePokemonSource()),
          },
        })
        .run();

      const stats = sp.baseStats;
      const bst = stats.hp + stats.atk + stats.def + stats.spa + stats.spd + stats.spe;
      db.insert(speciesStats).values({
        speciesId: sp.id,
        hp: stats.hp, atk: stats.atk, def: stats.def, spa: stats.spa, spd: stats.spd, spe: stats.spe,
        bst,
      }).run();

      const abilitySlots = resolveAbilities(sp.id, sp.abilities ?? {});
      for (const [slot, name] of abilitySlots) {
        db.insert(speciesAbilities).values({
          speciesId: sp.id,
          slot,
          abilityName: name,
        }).run();
        counts.abilitySlots++;
      }

      db.insert(rosterMembership).values({
        speciesId: sp.id,
        format: "RegM-A",
        isLegal: 1,
        isMega,
        notes: null,
      }).run();
      counts.species++;
    }

    // Sample sets (after species so FK is satisfied).
    if (sampleSetRows !== null) {
      const knownSpeciesIds = new Set<string>();
      for (const sp of sortedSpecies) knownSpeciesIds.add(sp.id);
      for (const row of sampleSetRows) {
        if (!knownSpeciesIds.has(row.species_id)) {
          counts.sampleSetsSkippedUnknownSpecies++;
          continue;
        }
        const set = row.sample_set;
        db.insert(sampleSetsTable).values({
          speciesId: row.species_id,
          setName: set.set_name,
          ability: set.ability,
          item: set.item,
          nature: set.nature,
          movesJson: JSON.stringify(set.moves),
          spsJson: JSON.stringify(set.sps),
          sourceJson: JSON.stringify(set.source),
        }).run();
        counts.sampleSets++;
      }
    }
  })();

  // Finalize for determinism. PRAGMA journal_mode=DELETE removes the WAL/SHM
  // sidecars; VACUUM compacts pages so file bytes are stable across runs.
  db.$client.exec("PRAGMA journal_mode=DELETE; VACUUM;");
  db.$client.close();

  log("\nBuild summary:");
  log(`  species:                ${counts.species}`);
  log(`  ability slot rows:      ${counts.abilitySlots}`);
  log(`  movepool entries (sum): ${counts.movepoolMoves}`);
  log(`  items:                  ${counts.items}`);
  log(`  abilities:              ${counts.abilities}`);
  log(`  moves:                  ${counts.moves}`);
  log(`  moves dropped (SV-only, not in Champions): ${counts.movesDroppedFromMovepools}`);
  log(`  sample sets:            ${counts.sampleSets}`);
  if (counts.sampleSetsSkippedUnknownSpecies > 0) {
    log(`  sample sets skipped (species not in roster): ${counts.sampleSetsSkippedUnknownSpecies}`);
  }
  log(`\n→ ${dbPath}`);

  return counts;
}

// ---- helpers ----

function loadAliases(): Record<string, string[]> {
  if (!existsSync(ALIASES_PATH)) return {};
  const raw = JSON.parse(readFileSync(ALIASES_PATH, "utf8")) as {
    aliases?: Record<string, string[]>;
  };
  return raw.aliases ?? {};
}

function collect<T>(iter: Iterable<T>): T[] {
  const out: T[] = [];
  for (const x of iter) out.push(x);
  return out;
}

function makePokemonSource(): Record<string, string> {
  return {
    stats_source: "@smogon/calc Generations.get(0).species (Champions slice)",
    movepool_source: "@pkmn/dex Dex.forGen(9).learnsets (SV-as-proxy, filtered against Champions moves)",
    abilities_source: "@pkmn/dex Dex.forGen(9).species (SV-as-proxy) + @smogon/calc fallback",
    fetched_at: FETCHED_AT,
    engine_sha: ENGINE_SHA,
  };
}

function makeRefSource(): Record<string, string | null> {
  return {
    origin: "@smogon/calc",
    engine_sha: ENGINE_SHA,
    source_url: "https://github.com/RodCaba/damage-calc",
    fetched_at: FETCHED_AT,
  };
}

function deriveFormId(sp: { name: string; id: string }): string | null {
  // Heuristic: anything after the species's base name is the form qualifier.
  // For now, just look for a dash in the display name.
  const idx = sp.name.indexOf("-");
  if (idx === -1) return null;
  return sp.name.slice(idx + 1).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function deriveItemCategory(id: string, name: string): ItemCategory {
  const dexItem = sv.items.get(id);
  if (dexItem?.megaStone) return "mega-stone";
  if (dexItem?.isBerry) return "berry";
  if (dexItem?.isChoice) return "choice";
  if (name.endsWith(" Plate")) return "plate";
  if (name.endsWith(" Memory")) return "memory";
  if (name.endsWith(" Seed")) return "seed";
  if (name.endsWith(" Gem")) return "gem";
  if (name.endsWith(" Rock") || name === "Heat Rock" || name === "Damp Rock" || name === "Smooth Rock" || name === "Icy Rock") return "weather-rock";
  if (name === "Terrain Extender") return "terrain-extender";
  if (name.endsWith("ite") && name !== "Light") return "mega-stone"; // catches Garchompite, Tyranitarite, etc.
  return "held";
}

function normalizeAccuracy(acc: number | true | undefined): number | null {
  if (acc === undefined) return null;
  if (acc === true) return null; // always hits
  return acc;
}

function resolveAbilities(
  speciesId: string,
  champAbilities: { 0?: string },
): Array<["0" | "1" | "h", string]> {
  const out: Array<["0" | "1" | "h", string]> = [];
  const dexSp = sv.species.get(speciesId);
  if (dexSp) {
    if (dexSp.abilities["0"]) out.push(["0", dexSp.abilities["0"]]);
    if (dexSp.abilities["1"]) out.push(["1", dexSp.abilities["1"]]);
    if (dexSp.abilities["H"]) out.push(["h", dexSp.abilities["H"]]);
  }
  // Fallback: ensure at least slot 0 exists. Champions calc-default ability wins
  // if @pkmn/dex didn't provide any (e.g., Champions-only Mega forms not in SV).
  if (out.length === 0 && champAbilities["0"]) {
    out.push(["0", champAbilities["0"]]);
  }
  return out;
}

// Top-level shim: only run when invoked directly (not when imported by tests).
import { fileURLToPath } from "node:url";
const isDirectInvocation =
  import.meta.url === `file://${process.argv[1] ?? ""}` ||
  process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectInvocation) {
  buildRegMA().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
