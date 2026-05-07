CREATE TABLE `team_sets` (
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
	CONSTRAINT "team_sets_slot_range" CHECK("team_sets"."slot" BETWEEN 0 AND 5)
);
--> statement-breakpoint
CREATE INDEX `idx_team_sets_species` ON `team_sets` (`species_roster_id`);--> statement-breakpoint
CREATE INDEX `idx_team_sets_item` ON `team_sets` (`item`);