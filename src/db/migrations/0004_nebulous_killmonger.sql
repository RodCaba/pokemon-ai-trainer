PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_team_sets` (
	`tournament_team_id` text NOT NULL,
	`slot` integer NOT NULL,
	`species_roster_id` text NOT NULL,
	`item` text,
	`ability` text,
	`level` integer,
	`moves_json` text NOT NULL,
	`sps_json` text,
	`ivs_json` text,
	`nature` text,
	`completeness` text NOT NULL,
	`source_site` text NOT NULL,
	`source_paste_id` text NOT NULL,
	`source_url` text NOT NULL,
	`fetched_at` text NOT NULL,
	PRIMARY KEY(`tournament_team_id`, `slot`),
	FOREIGN KEY (`tournament_team_id`) REFERENCES `tournament_teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`species_roster_id`) REFERENCES `species`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "team_sets_slot_range" CHECK("__new_team_sets"."slot" BETWEEN 0 AND 5),
	CONSTRAINT "team_sets_completeness_valid" CHECK("__new_team_sets"."completeness" IN ('minimal','partial','full')),
	CONSTRAINT "team_sets_source_site_pokepaste" CHECK("__new_team_sets"."source_site" = 'pokepaste'),
	CONSTRAINT "team_sets_level_range" CHECK("__new_team_sets"."level" IS NULL OR ("__new_team_sets"."level" BETWEEN 1 AND 100)),
	CONSTRAINT "team_sets_moves_len" CHECK(json_array_length("__new_team_sets"."moves_json") BETWEEN 0 AND 4),
	CONSTRAINT "team_sets_sps_total_le_66" CHECK("__new_team_sets"."sps_json" IS NULL OR
          (json_extract("__new_team_sets"."sps_json",'$.hp')+json_extract("__new_team_sets"."sps_json",'$.atk')
          +json_extract("__new_team_sets"."sps_json",'$.def')+json_extract("__new_team_sets"."sps_json",'$.spa')
          +json_extract("__new_team_sets"."sps_json",'$.spd')+json_extract("__new_team_sets"."sps_json",'$.spe')) <= 66),
	CONSTRAINT "team_sets_sps_per_stat_le_32" CHECK("__new_team_sets"."sps_json" IS NULL OR (
        json_extract("__new_team_sets"."sps_json",'$.hp')  <= 32 AND
        json_extract("__new_team_sets"."sps_json",'$.atk') <= 32 AND
        json_extract("__new_team_sets"."sps_json",'$.def') <= 32 AND
        json_extract("__new_team_sets"."sps_json",'$.spa') <= 32 AND
        json_extract("__new_team_sets"."sps_json",'$.spd') <= 32 AND
        json_extract("__new_team_sets"."sps_json",'$.spe') <= 32
      ))
);
--> statement-breakpoint
INSERT INTO `__new_team_sets`("tournament_team_id", "slot", "species_roster_id", "item", "ability", "level", "moves_json", "sps_json", "ivs_json", "nature", "completeness", "source_site", "source_paste_id", "source_url", "fetched_at") SELECT "tournament_team_id", "slot", "species_roster_id", "item", "ability", "level", "moves_json", "sps_json", "ivs_json", "nature", "completeness", "source_site", "source_paste_id", "source_url", "fetched_at" FROM `team_sets`;--> statement-breakpoint
DROP TABLE `team_sets`;--> statement-breakpoint
ALTER TABLE `__new_team_sets` RENAME TO `team_sets`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_team_sets_species` ON `team_sets` (`species_roster_id`);--> statement-breakpoint
CREATE INDEX `idx_team_sets_item` ON `team_sets` (`item`);--> statement-breakpoint
CREATE INDEX `idx_team_sets_ability` ON `team_sets` (`ability`);--> statement-breakpoint
CREATE INDEX `idx_team_sets_paste_id` ON `team_sets` (`source_paste_id`);