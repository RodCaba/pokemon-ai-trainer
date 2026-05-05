import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// Drizzle schema for the Reg M-A roster DB. Single source of truth for both runtime
// queries (via Drizzle's type-safe query builder) and migration generation
// (via drizzle-kit). Mirrors docs/plans/pokemon-roster-db.md §4.
//
// Reg M-A invariants (SPS ≤ 66, ability slots, etc.) are enforced via SQLite CHECK
// constraints declared with `check(...)` here.
//
// Style note: extraConfig is the array-returning callback form (Drizzle 0.45+).
// The legacy object-returning form is deprecated.

// Note: `schema_migrations` is bootstrapped by `src/db/open.ts` and is intentionally
// NOT declared here. It's runner metadata, not application data — keeping it out of
// the Drizzle schema avoids drizzle-kit re-emitting CREATE TABLE for it.

export const species = sqliteTable(
  "species",
  {
    id: text("id").primaryKey(),
    displayName: text("display_name").notNull(),
    formId: text("form_id"),
    isMega: integer("is_mega").notNull(),
    types: text("types").notNull(), // JSON array of 1-2 type strings
    weightKg: real("weight_kg").notNull(),
    aliases: text("aliases").notNull().default("[]"),
    // JSON array of Showdown move IDs (lowercase, no spaces). Sourced from
    // @pkmn/dex SV gen 9 learnsets (SV-as-proxy for Champions), filtered at
    // populator time to drop moves that don't exist in the Champions `moves`
    // table. See plan §3 / decision 2026-05-04.
    movepool: text("movepool").notNull().default("[]"),
    sourceJson: text("source_json").notNull(),
  },
  (t) => [
    check("species_is_mega_bool", sql`${t.isMega} IN (0,1)`),
    check("species_weight_positive", sql`${t.weightKg} > 0`),
    index("idx_species_display_name_nocase").on(sql`${t.displayName} COLLATE NOCASE`),
  ],
);

export const speciesStats = sqliteTable(
  "species_stats",
  {
    speciesId: text("species_id")
      .primaryKey()
      .references(() => species.id, { onDelete: "cascade" }),
    hp: integer("hp").notNull(),
    atk: integer("atk").notNull(),
    def: integer("def").notNull(),
    spa: integer("spa").notNull(),
    spd: integer("spd").notNull(),
    spe: integer("spe").notNull(),
    // Note: drizzle-kit doesn't yet emit GENERATED ALWAYS columns. We declare `bst`
    // as a plain integer here and compute it at insert time in the build pipeline.
    // The CHECK enforces the invariant; tests assert bst = sum(hp..spe).
    bst: integer("bst").notNull(),
  },
  (t) => [
    check("species_stats_hp_positive", sql`${t.hp} > 0`),
    check("species_stats_atk_positive", sql`${t.atk} > 0`),
    check("species_stats_def_positive", sql`${t.def} > 0`),
    check("species_stats_spa_positive", sql`${t.spa} > 0`),
    check("species_stats_spd_positive", sql`${t.spd} > 0`),
    check("species_stats_spe_positive", sql`${t.spe} > 0`),
    check(
      "species_stats_bst_consistent",
      sql`${t.bst} = ${t.hp} + ${t.atk} + ${t.def} + ${t.spa} + ${t.spd} + ${t.spe}`,
    ),
  ],
);

export const speciesAbilities = sqliteTable(
  "species_abilities",
  {
    speciesId: text("species_id")
      .notNull()
      .references(() => species.id, { onDelete: "cascade" }),
    slot: text("slot").notNull(),
    abilityName: text("ability_name").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.speciesId, t.slot] }),
    check("species_abilities_slot_valid", sql`${t.slot} IN ('0','1','h')`),
    index("idx_species_abilities_ability_name").on(sql`${t.abilityName} COLLATE NOCASE`),
  ],
);

// Note: `species_movepool` was dropped 2026-05-04 because no Champions data source
// (neither @smogon/calc nor @pkmn/dex SV-as-proxy) carries a Champions-curated
// movepool. Reintroduce when a movepool source lands.

export const sampleSets = sqliteTable(
  "sample_sets",
  {
    rowid: integer("rowid").primaryKey(),
    speciesId: text("species_id")
      .notNull()
      .references(() => species.id, { onDelete: "cascade" }),
    setName: text("set_name").notNull(),
    ability: text("ability").notNull(),
    item: text("item"),
    nature: text("nature").notNull(),
    movesJson: text("moves_json").notNull(),
    spsJson: text("sps_json").notNull(),
    sourceJson: text("source_json").notNull(),
  },
  (t) => [
    check("sample_sets_moves_len_4", sql`json_array_length(${t.movesJson}) = 4`),
    check(
      "sample_sets_sps_total_le_66",
      sql`(json_extract(${t.spsJson},'$.hp')+json_extract(${t.spsJson},'$.atk')+json_extract(${t.spsJson},'$.def')+json_extract(${t.spsJson},'$.spa')+json_extract(${t.spsJson},'$.spd')+json_extract(${t.spsJson},'$.spe')) <= 66`,
    ),
    check(
      "sample_sets_sps_per_stat_le_32",
      sql`json_extract(${t.spsJson},'$.hp')  <= 32
       AND json_extract(${t.spsJson},'$.atk') <= 32
       AND json_extract(${t.spsJson},'$.def') <= 32
       AND json_extract(${t.spsJson},'$.spa') <= 32
       AND json_extract(${t.spsJson},'$.spd') <= 32
       AND json_extract(${t.spsJson},'$.spe') <= 32`,
    ),
    uniqueIndex("sample_sets_species_set_uq").on(t.speciesId, t.setName),
  ],
);

export const rosterMembership = sqliteTable(
  "roster_membership",
  {
    speciesId: text("species_id")
      .notNull()
      .references(() => species.id, { onDelete: "cascade" }),
    format: text("format").notNull(),
    isLegal: integer("is_legal").notNull(),
    isMega: integer("is_mega").notNull(),
    notes: text("notes"),
  },
  (t) => [
    primaryKey({ columns: [t.speciesId, t.format] }),
    check("roster_membership_format_regma", sql`${t.format} = 'RegM-A'`),
    check("roster_membership_is_legal_bool", sql`${t.isLegal} IN (0,1)`),
    check("roster_membership_is_mega_bool", sql`${t.isMega} IN (0,1)`),
    index("idx_roster_membership_format_legal").on(t.format, t.isLegal),
  ],
);

export const items = sqliteTable(
  "items",
  {
    id: text("id").primaryKey(),
    displayName: text("display_name").notNull(),
    category: text("category").notNull(),
    sourceJson: text("source_json").notNull(),
  },
  (t) => [
    check(
      "items_category_valid",
      sql`${t.category} IN ('berry','mega-stone','held','choice','plate','memory','seed','gem','weather-rock','terrain-extender','other')`,
    ),
    index("idx_items_display_name_nocase").on(sql`${t.displayName} COLLATE NOCASE`),
  ],
);

export const abilities = sqliteTable(
  "abilities",
  {
    id: text("id").primaryKey(),
    displayName: text("display_name").notNull(),
    sourceJson: text("source_json").notNull(),
  },
  (t) => [
    index("idx_abilities_display_name_nocase").on(sql`${t.displayName} COLLATE NOCASE`),
  ],
);

// ---------------------------------------------------------------------------
// labmaus-tournaments slice (Stage 4 stubs — additive)
// ---------------------------------------------------------------------------

export const tournaments = sqliteTable(
  "tournaments",
  {
    id: text("id").primaryKey(), // "labmaus:56757"
    externalId: integer("external_id").notNull(),
    tournamentCode: text("tournament_code"),
    name: text("name").notNull(),
    organizer: text("organizer"),
    format: text("format").notNull(),
    division: text("division").notNull(),
    status: text("status").notNull(),
    date: text("date").notNull(),
    numPlayers: integer("num_players").notNull(),
    numPhase2: integer("num_phase_2"),
    sourceSite: text("source_site").notNull(),
    sourceSiteSource: text("source_site_source"),
    sourceUrl: text("source_url").notNull(),
    fetchedAt: text("fetched_at").notNull(),
  },
  (t) => [
    uniqueIndex("tournaments_site_external_uq").on(t.sourceSite, t.externalId),
    check("tournaments_format_regma", sql`${t.format} = 'RegM-A'`),
    check("tournaments_division_valid", sql`${t.division} IN ('Masters','Seniors','Juniors')`),
    check("tournaments_status_valid", sql`${t.status} IN ('official','unofficial')`),
    index("idx_tournaments_format_date").on(t.format, t.date),
  ],
);

export const tournamentTeams = sqliteTable(
  "tournament_teams",
  {
    id: text("id").primaryKey(), // "labmaus:56757:244471"
    tournamentId: text("tournament_id")
      .notNull()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    externalTeamId: integer("external_team_id").notNull(),
    player: text("player").notNull(),
    playerKey: text("player_key").notNull(),
    country: text("country"),
    placement: integer("placement"),
    record: text("record").notNull(),
    teamUrl: text("team_url").notNull(),
    fetchedAt: text("fetched_at").notNull(),
  },
  (t) => [
    uniqueIndex("tournament_teams_tournament_external_uq").on(t.tournamentId, t.externalTeamId),
    index("idx_tournament_teams_tournament_placement").on(t.tournamentId, t.placement),
    index("idx_tournament_teams_player_key").on(t.playerKey),
    check("tournament_teams_country_iso2", sql`${t.country} IS NULL OR length(${t.country}) = 2`),
    check("tournament_teams_placement_positive", sql`${t.placement} IS NULL OR ${t.placement} > 0`),
  ],
);

export const tournamentTeamSpecies = sqliteTable(
  "tournament_team_species",
  {
    teamId: text("team_id")
      .notNull()
      .references(() => tournamentTeams.id, { onDelete: "cascade" }),
    slot: integer("slot").notNull(),
    labmausId: text("labmaus_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.teamId, t.slot] }),
    check("tournament_team_species_slot_range", sql`${t.slot} BETWEEN 0 AND 5`),
  ],
);

/**
 * `team_sets` is owned by the parallel `pokepaste-sets` slice (see
 * `docs/plans/pokepaste-sets.md` §5). Declared here so the labmaus slice's
 * `usage(kind="item"|"move")` query can LEFT JOIN against the columns it
 * needs (tournament_team_id, slot, species_roster_id, item, moves_json).
 *
 * The pokepaste slice will land additional CHECK constraints (level range,
 * SPS totals, etc.); when that migration ships it should `ALTER TABLE` to
 * add those constraints rather than recreating the table. The minimal column
 * set here is intentionally a strict subset of the planned final shape.
 */
export const teamSets = sqliteTable(
  "team_sets",
  {
    tournamentTeamId: text("tournament_team_id").notNull(),
    slot: integer("slot").notNull(),
    speciesRosterId: text("species_roster_id").notNull(),
    item: text("item"),
    ability: text("ability"),
    level: integer("level"),
    movesJson: text("moves_json").notNull(),
    spsJson: text("sps_json"),
    ivsJson: text("ivs_json"),
    nature: text("nature"),
    completeness: text("completeness").notNull(),
    sourceSite: text("source_site").notNull(),
    sourcePasteId: text("source_paste_id").notNull(),
    sourceUrl: text("source_url").notNull(),
    fetchedAt: text("fetched_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tournamentTeamId, t.slot] }),
    check("team_sets_slot_range", sql`${t.slot} BETWEEN 0 AND 5`),
    index("idx_team_sets_species").on(t.speciesRosterId),
    index("idx_team_sets_item").on(t.item),
  ],
);

export const moves = sqliteTable(
  "moves",
  {
    id: text("id").primaryKey(),
    displayName: text("display_name").notNull(),
    type: text("type").notNull(),
    category: text("category").notNull(),
    basePower: integer("base_power").notNull(),
    accuracy: integer("accuracy"),
    sourceJson: text("source_json").notNull(),
  },
  (t) => [
    check(
      "moves_category_valid",
      sql`${t.category} IN ('Physical','Special','Status')`,
    ),
    check("moves_base_power_nonneg", sql`${t.basePower} >= 0`),
    check(
      "moves_accuracy_range",
      sql`${t.accuracy} IS NULL OR (${t.accuracy} >= 0 AND ${t.accuracy} <= 100)`,
    ),
    index("idx_moves_display_name_nocase").on(sql`${t.displayName} COLLATE NOCASE`),
    index("idx_moves_type").on(t.type),
    index("idx_moves_category").on(t.category),
  ],
);
