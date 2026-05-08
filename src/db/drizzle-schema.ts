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
 * `team_sets` — owned by the `pokepaste-sets` slice (see
 * `docs/plans/pokepaste-sets.md` §5). One row per (tournament_team, slot)
 * with the parsed Showdown export from the team's pokepaste link. Adds
 * full CHECK constraints, FKs, and additional indexes on top of the
 * labmaus-side stub from migration 0003.
 */
export const teamSets = sqliteTable(
  "team_sets",
  {
    tournamentTeamId: text("tournament_team_id")
      .notNull()
      .references(() => tournamentTeams.id, { onDelete: "cascade" }),
    slot: integer("slot").notNull(),
    speciesRosterId: text("species_roster_id")
      .notNull()
      .references(() => species.id),
    item: text("item"),
    ability: text("ability"),
    level: integer("level"),
    movesJson: text("moves_json").notNull(), // JSON array (≤4 moves)
    spsJson: text("sps_json"), // JSON object {hp,atk,...} or NULL
    ivsJson: text("ivs_json"), // JSON object or NULL
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
    check(
      "team_sets_completeness_valid",
      sql`${t.completeness} IN ('minimal','partial','full')`,
    ),
    check(
      "team_sets_source_site_pokepaste",
      sql`${t.sourceSite} = 'pokepaste'`,
    ),
    check(
      "team_sets_level_range",
      sql`${t.level} IS NULL OR (${t.level} BETWEEN 1 AND 100)`,
    ),
    check(
      "team_sets_moves_len",
      sql`json_array_length(${t.movesJson}) BETWEEN 0 AND 4`,
    ),
    check(
      "team_sets_sps_total_le_66",
      sql`${t.spsJson} IS NULL OR
          (json_extract(${t.spsJson},'$.hp')+json_extract(${t.spsJson},'$.atk')
          +json_extract(${t.spsJson},'$.def')+json_extract(${t.spsJson},'$.spa')
          +json_extract(${t.spsJson},'$.spd')+json_extract(${t.spsJson},'$.spe')) <= 66`,
    ),
    check(
      "team_sets_sps_per_stat_le_32",
      sql`${t.spsJson} IS NULL OR (
        json_extract(${t.spsJson},'$.hp')  <= 32 AND
        json_extract(${t.spsJson},'$.atk') <= 32 AND
        json_extract(${t.spsJson},'$.def') <= 32 AND
        json_extract(${t.spsJson},'$.spa') <= 32 AND
        json_extract(${t.spsJson},'$.spd') <= 32 AND
        json_extract(${t.spsJson},'$.spe') <= 32
      )`,
    ),
    index("idx_team_sets_species").on(t.speciesRosterId),
    index("idx_team_sets_item").on(t.item),
    index("idx_team_sets_ability").on(t.ability),
    index("idx_team_sets_paste_id").on(t.sourcePasteId),
  ],
);

// ---------------------------------------------------------------------------
// pikalytics slice (Stage 4 — additive)
// ---------------------------------------------------------------------------

/**
 * `pikalytics_snapshots` — owned by the `pikalytics` slice (see
 * `docs/plans/pikalytics.md` §5). One row per `(species_roster_id, as_of)`
 * pair. JSON columns hold bounded arrays of teammates/items/abilities/moves;
 * cross-species queries use `json_each`. The unique index is the skip-existing
 * key for the ingest script.
 */
export const pikalyticsSnapshots = sqliteTable(
  "pikalytics_snapshots",
  {
    id: text("id").primaryKey(),
    format: text("format").notNull(),
    formatSlug: text("format_slug").notNull(),
    speciesRosterId: text("species_roster_id")
      .notNull()
      .references(() => species.id),
    asOf: text("as_of").notNull(),
    usagePercent: real("usage_percent"),
    teammatesJson: text("teammates_json").notNull(),
    itemsJson: text("items_json").notNull(),
    abilitiesJson: text("abilities_json").notNull(),
    movesJson: text("moves_json").notNull(),
    sampleSize: integer("sample_size"),
    sourceUrl: text("source_url").notNull(),
    aiUrl: text("ai_url").notNull(),
    fetchedAt: text("fetched_at").notNull(),
  },
  (t) => [
    uniqueIndex("uq_pikalytics_species_as_of").on(t.speciesRosterId, t.asOf),
    index("idx_pikalytics_species_as_of_desc").on(t.speciesRosterId, t.asOf),
    index("idx_pikalytics_as_of").on(t.asOf),
    check("pikalytics_format_regma", sql`${t.format} = 'RegM-A'`),
    check("pikalytics_format_slug_value", sql`${t.formatSlug} = 'gen9championsvgc2026regma'`),
    check(
      "pikalytics_usage_pct_range",
      sql`${t.usagePercent} IS NULL OR (${t.usagePercent} BETWEEN 0 AND 100)`,
    ),
    check("pikalytics_as_of_iso", sql`${t.asOf} GLOB '????-??-??'`),
  ],
);

// ---------------------------------------------------------------------------
// vgc-knowledge-base slice (Stage 4 — additive)
// ---------------------------------------------------------------------------

/**
 * `knowledge_chunks` — owned by the `vgc-knowledge-base` slice (see
 * `docs/plans/vgc-knowledge-base.md` §5). One row per chunk of a vgcguide
 * article body. The vec0 sidecar `knowledge_chunk_embeddings` is a virtual
 * table declared in the hand-authored migration `0007_knowledge_vec0.sql`
 * (drizzle-kit can't express CREATE VIRTUAL TABLE).
 *
 * `embedding_ref` is the explicit string link `"knowledge_chunk_embeddings:<rowid>"`
 * pointing at the corresponding vec0 row.
 */
export const knowledgeChunks = sqliteTable(
  "knowledge_chunks",
  {
    id: text("id").primaryKey(),
    sourceSite: text("source_site").notNull(),
    articleSlug: text("article_slug").notNull(),
    articleTitle: text("article_title").notNull(),
    articleUrl: text("article_url").notNull(),
    articleSection: text("article_section").notNull(),
    sectionHeading: text("section_heading").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    chunkText: text("chunk_text").notNull(),
    chunkTokenCount: integer("chunk_token_count").notNull(),
    subtype: text("subtype"),
    bodyHash: text("body_hash").notNull(),
    embeddingRef: text("embedding_ref").notNull(),
    fetchedAt: text("fetched_at").notNull(),
    author: text("author"),
    capturedVia: text("captured_via").notNull(),
  },
  (t) => [
    uniqueIndex("uq_knowledge_article_chunk").on(t.sourceSite, t.articleSlug, t.chunkIndex),
    index("idx_knowledge_section").on(t.articleSection),
    index("idx_knowledge_subtype").on(t.subtype),
    index("idx_knowledge_body_hash").on(t.articleSlug, t.bodyHash),
    check(
      "knowledge_source_site_value",
      sql`${t.sourceSite} IN ('vgcguide','metavgc')`,
    ),
    check(
      "knowledge_section_value",
      sql`${t.articleSection} IN ('intro','teambuilding','battling')`,
    ),
    check(
      "knowledge_subtype_value",
      sql`${t.subtype} IS NULL OR ${t.subtype} = 'battle-replay'`,
    ),
    check(
      "knowledge_token_count_range",
      sql`${t.chunkTokenCount} BETWEEN 1 AND 500`,
    ),
    check("knowledge_body_hash_format", sql`${t.bodyHash} GLOB 'sha256:*'`),
    check(
      "knowledge_id_format",
      sql`${t.id} GLOB 'vgcguide:*' OR ${t.id} GLOB 'metavgc:*'`,
    ),
    check(
      "knowledge_embedding_ref_format",
      sql`${t.embeddingRef} GLOB 'knowledge_chunk_embeddings:*'`,
    ),
  ],
);

/**
 * `knowledge_chunk_species_tags` — link table mapping each
 * `knowledge_chunks` row to the canonical Champions species ids it mentions.
 * Built by the metavgc ingest at write time (and by a one-shot backfill for
 * existing vgcguide rows). Per plan §19.3.
 */
export const knowledgeChunkSpeciesTags = sqliteTable(
  "knowledge_chunk_species_tags",
  {
    chunkId: text("chunk_id")
      .notNull()
      .references(() => knowledgeChunks.id, { onDelete: "cascade" }),
    speciesId: text("species_id")
      .notNull()
      .references(() => species.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.chunkId, t.speciesId] }),
    index("idx_kcst_species").on(t.speciesId),
  ],
);

// ---------------------------------------------------------------------------
// user-teams slice (Stage 4 — additive)
// ---------------------------------------------------------------------------

/**
 * `user_teams` — top-level row for a user-owned team. See
 * `docs/plans/user-teams.md` §4.1 / §5. FK to `tournament_teams` uses
 * SET NULL so a tournament-team deletion preserves the user team
 * (Stage-2 Q4).
 */
export const userTeams = sqliteTable(
  "user_teams",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    winCondition: text("win_condition"),
    status: text("status").notNull().default("draft"),
    origin: text("origin").notNull(),
    originPayload: text("origin_payload"),
    sourceTournamentTeamId: text("source_tournament_team_id").references(
      () => tournamentTeams.id,
      { onDelete: "set null" },
    ),
    validationErrors: text("validation_errors").notNull().default("[]"),
    validationWarnings: text("validation_warnings").notNull().default("[]"),
    schemaVersion: integer("schema_version").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    check(
      "user_teams_status_valid",
      sql`${t.status} IN ('draft','saved','archived')`,
    ),
    check(
      "user_teams_origin_valid",
      sql`${t.origin} IN ('paste','builder','ai_prompt','duplicated_from_tournament')`,
    ),
    check(
      "user_teams_origin_tournament_consistency",
      sql`(${t.origin} = 'duplicated_from_tournament') = (${t.sourceTournamentTeamId} IS NOT NULL)`,
    ),
    index("idx_user_teams_status").on(t.status),
    index("idx_user_teams_origin").on(t.origin),
    index("idx_user_teams_updated_at_desc").on(t.updatedAt),
    uniqueIndex("uq_user_teams_name").on(t.name),
  ],
);

/**
 * `user_team_sets` — six-slot child rows. CASCADE on parent delete.
 * Per-stat SPS ≤ 32 enforced as hard CHECK; the ≤66 total is
 * validator-only so drafts can transiently overshoot.
 */
export const userTeamSets = sqliteTable(
  "user_team_sets",
  {
    userTeamId: text("user_team_id")
      .notNull()
      .references(() => userTeams.id, { onDelete: "cascade" }),
    slot: integer("slot").notNull(),
    speciesId: text("species_id").references(() => species.id),
    nickname: text("nickname"),
    itemId: text("item_id").references(() => items.id),
    abilityId: text("ability_id").references(() => abilities.id),
    nature: text("nature"),
    hpSps: integer("hp_sps").notNull().default(0),
    atkSps: integer("atk_sps").notNull().default(0),
    defSps: integer("def_sps").notNull().default(0),
    spaSps: integer("spa_sps").notNull().default(0),
    spdSps: integer("spd_sps").notNull().default(0),
    speSps: integer("spe_sps").notNull().default(0),
    move1Id: text("move_1_id").references(() => moves.id),
    move2Id: text("move_2_id").references(() => moves.id),
    move3Id: text("move_3_id").references(() => moves.id),
    move4Id: text("move_4_id").references(() => moves.id),
    notes: text("notes"),
  },
  (t) => [
    primaryKey({ columns: [t.userTeamId, t.slot] }),
    check("user_team_sets_slot_range", sql`${t.slot} BETWEEN 0 AND 5`),
    check("user_team_sets_hp_sps_le_32", sql`${t.hpSps} BETWEEN 0 AND 32`),
    check("user_team_sets_atk_sps_le_32", sql`${t.atkSps} BETWEEN 0 AND 32`),
    check("user_team_sets_def_sps_le_32", sql`${t.defSps} BETWEEN 0 AND 32`),
    check("user_team_sets_spa_sps_le_32", sql`${t.spaSps} BETWEEN 0 AND 32`),
    check("user_team_sets_spd_sps_le_32", sql`${t.spdSps} BETWEEN 0 AND 32`),
    check("user_team_sets_spe_sps_le_32", sql`${t.speSps} BETWEEN 0 AND 32`),
  ],
);

/**
 * `user_team_revisions` — durable snapshot history. CASCADE on parent.
 * Composite PK (user_team_id, revision_number); revision_number ∈ 1..5.
 */
export const userTeamRevisions = sqliteTable(
  "user_team_revisions",
  {
    userTeamId: text("user_team_id")
      .notNull()
      .references(() => userTeams.id, { onDelete: "cascade" }),
    revisionNumber: integer("revision_number").notNull(),
    label: text("label"),
    snapshotJson: text("snapshot_json").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userTeamId, t.revisionNumber] }),
    check(
      "user_team_revisions_number_range",
      sql`${t.revisionNumber} BETWEEN 1 AND 5`,
    ),
    index("idx_user_team_revisions_team_created").on(
      t.userTeamId,
      t.createdAt,
    ),
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
