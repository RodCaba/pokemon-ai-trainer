CREATE TABLE `abilities` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`source_json` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_abilities_display_name_nocase` ON `abilities` ("display_name" COLLATE NOCASE);--> statement-breakpoint
CREATE TABLE `items` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`category` text NOT NULL,
	`source_json` text NOT NULL,
	CONSTRAINT "items_category_valid" CHECK("items"."category" IN ('berry','mega-stone','held','choice','plate','memory','seed','gem','weather-rock','terrain-extender','other'))
);
--> statement-breakpoint
CREATE INDEX `idx_items_display_name_nocase` ON `items` ("display_name" COLLATE NOCASE);--> statement-breakpoint
CREATE TABLE `moves` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`type` text NOT NULL,
	`category` text NOT NULL,
	`base_power` integer NOT NULL,
	`accuracy` integer,
	`source_json` text NOT NULL,
	CONSTRAINT "moves_category_valid" CHECK("moves"."category" IN ('Physical','Special','Status')),
	CONSTRAINT "moves_base_power_nonneg" CHECK("moves"."base_power" >= 0),
	CONSTRAINT "moves_accuracy_range" CHECK("moves"."accuracy" IS NULL OR ("moves"."accuracy" >= 0 AND "moves"."accuracy" <= 100))
);
--> statement-breakpoint
CREATE INDEX `idx_moves_display_name_nocase` ON `moves` ("display_name" COLLATE NOCASE);--> statement-breakpoint
CREATE INDEX `idx_moves_type` ON `moves` (`type`);--> statement-breakpoint
CREATE INDEX `idx_moves_category` ON `moves` (`category`);--> statement-breakpoint
CREATE TABLE `roster_membership` (
	`species_id` text NOT NULL,
	`format` text NOT NULL,
	`is_legal` integer NOT NULL,
	`is_mega` integer NOT NULL,
	`notes` text,
	PRIMARY KEY(`species_id`, `format`),
	FOREIGN KEY (`species_id`) REFERENCES `species`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "roster_membership_format_regma" CHECK("roster_membership"."format" = 'RegM-A'),
	CONSTRAINT "roster_membership_is_legal_bool" CHECK("roster_membership"."is_legal" IN (0,1)),
	CONSTRAINT "roster_membership_is_mega_bool" CHECK("roster_membership"."is_mega" IN (0,1))
);
--> statement-breakpoint
CREATE INDEX `idx_roster_membership_format_legal` ON `roster_membership` (`format`,`is_legal`);--> statement-breakpoint
CREATE TABLE `sample_sets` (
	`rowid` integer PRIMARY KEY NOT NULL,
	`species_id` text NOT NULL,
	`set_name` text NOT NULL,
	`ability` text NOT NULL,
	`item` text,
	`nature` text NOT NULL,
	`moves_json` text NOT NULL,
	`sps_json` text NOT NULL,
	`source_json` text NOT NULL,
	FOREIGN KEY (`species_id`) REFERENCES `species`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "sample_sets_moves_len_4" CHECK(json_array_length("sample_sets"."moves_json") = 4),
	CONSTRAINT "sample_sets_sps_total_le_66" CHECK((json_extract("sample_sets"."sps_json",'$.hp')+json_extract("sample_sets"."sps_json",'$.atk')+json_extract("sample_sets"."sps_json",'$.def')+json_extract("sample_sets"."sps_json",'$.spa')+json_extract("sample_sets"."sps_json",'$.spd')+json_extract("sample_sets"."sps_json",'$.spe')) <= 66),
	CONSTRAINT "sample_sets_sps_per_stat_le_32" CHECK(json_extract("sample_sets"."sps_json",'$.hp')  <= 32
       AND json_extract("sample_sets"."sps_json",'$.atk') <= 32
       AND json_extract("sample_sets"."sps_json",'$.def') <= 32
       AND json_extract("sample_sets"."sps_json",'$.spa') <= 32
       AND json_extract("sample_sets"."sps_json",'$.spd') <= 32
       AND json_extract("sample_sets"."sps_json",'$.spe') <= 32)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sample_sets_species_set_uq` ON `sample_sets` (`species_id`,`set_name`);--> statement-breakpoint
CREATE TABLE `species` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`form_id` text,
	`is_mega` integer NOT NULL,
	`types` text NOT NULL,
	`weight_kg` real NOT NULL,
	`aliases` text DEFAULT '[]' NOT NULL,
	`movepool` text DEFAULT '[]' NOT NULL,
	`source_json` text NOT NULL,
	CONSTRAINT "species_is_mega_bool" CHECK("species"."is_mega" IN (0,1)),
	CONSTRAINT "species_weight_positive" CHECK("species"."weight_kg" > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_species_display_name_nocase` ON `species` ("display_name" COLLATE NOCASE);--> statement-breakpoint
CREATE TABLE `species_abilities` (
	`species_id` text NOT NULL,
	`slot` text NOT NULL,
	`ability_name` text NOT NULL,
	PRIMARY KEY(`species_id`, `slot`),
	FOREIGN KEY (`species_id`) REFERENCES `species`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "species_abilities_slot_valid" CHECK("species_abilities"."slot" IN ('0','1','h'))
);
--> statement-breakpoint
CREATE INDEX `idx_species_abilities_ability_name` ON `species_abilities` ("ability_name" COLLATE NOCASE);--> statement-breakpoint
CREATE TABLE `species_stats` (
	`species_id` text PRIMARY KEY NOT NULL,
	`hp` integer NOT NULL,
	`atk` integer NOT NULL,
	`def` integer NOT NULL,
	`spa` integer NOT NULL,
	`spd` integer NOT NULL,
	`spe` integer NOT NULL,
	`bst` integer NOT NULL,
	FOREIGN KEY (`species_id`) REFERENCES `species`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "species_stats_hp_positive" CHECK("species_stats"."hp" > 0),
	CONSTRAINT "species_stats_atk_positive" CHECK("species_stats"."atk" > 0),
	CONSTRAINT "species_stats_def_positive" CHECK("species_stats"."def" > 0),
	CONSTRAINT "species_stats_spa_positive" CHECK("species_stats"."spa" > 0),
	CONSTRAINT "species_stats_spd_positive" CHECK("species_stats"."spd" > 0),
	CONSTRAINT "species_stats_spe_positive" CHECK("species_stats"."spe" > 0),
	CONSTRAINT "species_stats_bst_consistent" CHECK("species_stats"."bst" = "species_stats"."hp" + "species_stats"."atk" + "species_stats"."def" + "species_stats"."spa" + "species_stats"."spd" + "species_stats"."spe")
);
