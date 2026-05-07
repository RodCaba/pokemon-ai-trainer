CREATE TABLE `species_alias_labmaus` (
	`id` text PRIMARY KEY NOT NULL,
	`roster_id` text NOT NULL,
	`source_json` text NOT NULL,
	FOREIGN KEY (`roster_id`) REFERENCES `species`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_species_alias_labmaus_roster_id` ON `species_alias_labmaus` (`roster_id`);--> statement-breakpoint
CREATE TABLE `tournament_team_species` (
	`team_id` text NOT NULL,
	`slot` integer NOT NULL,
	`labmaus_id` text NOT NULL,
	`roster_id` text NOT NULL,
	PRIMARY KEY(`team_id`, `slot`),
	FOREIGN KEY (`team_id`) REFERENCES `tournament_teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`roster_id`) REFERENCES `species`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "tournament_team_species_slot_range" CHECK("tournament_team_species"."slot" BETWEEN 0 AND 5)
);
--> statement-breakpoint
CREATE INDEX `idx_tournament_team_species_roster_id` ON `tournament_team_species` (`roster_id`);--> statement-breakpoint
CREATE TABLE `tournament_teams` (
	`id` text PRIMARY KEY NOT NULL,
	`tournament_id` text NOT NULL,
	`external_team_id` integer NOT NULL,
	`player` text NOT NULL,
	`player_key` text NOT NULL,
	`country` text,
	`placement` integer,
	`record` text NOT NULL,
	`team_url` text NOT NULL,
	`fetched_at` text NOT NULL,
	FOREIGN KEY (`tournament_id`) REFERENCES `tournaments`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "tournament_teams_country_iso2" CHECK("tournament_teams"."country" IS NULL OR length("tournament_teams"."country") = 2),
	CONSTRAINT "tournament_teams_placement_positive" CHECK("tournament_teams"."placement" IS NULL OR "tournament_teams"."placement" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tournament_teams_tournament_external_uq` ON `tournament_teams` (`tournament_id`,`external_team_id`);--> statement-breakpoint
CREATE INDEX `idx_tournament_teams_tournament_placement` ON `tournament_teams` (`tournament_id`,`placement`);--> statement-breakpoint
CREATE INDEX `idx_tournament_teams_player_key` ON `tournament_teams` (`player_key`);--> statement-breakpoint
CREATE TABLE `tournaments` (
	`id` text PRIMARY KEY NOT NULL,
	`external_id` integer NOT NULL,
	`tournament_code` text,
	`name` text NOT NULL,
	`organizer` text,
	`format` text NOT NULL,
	`division` text NOT NULL,
	`status` text NOT NULL,
	`date` text NOT NULL,
	`num_players` integer NOT NULL,
	`num_phase_2` integer,
	`source_site` text NOT NULL,
	`source_site_source` text,
	`source_url` text NOT NULL,
	`fetched_at` text NOT NULL,
	CONSTRAINT "tournaments_format_regma" CHECK("tournaments"."format" = 'RegM-A'),
	CONSTRAINT "tournaments_division_valid" CHECK("tournaments"."division" IN ('Masters','Seniors','Juniors')),
	CONSTRAINT "tournaments_status_valid" CHECK("tournaments"."status" IN ('official','unofficial'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tournaments_site_external_uq` ON `tournaments` (`source_site`,`external_id`);--> statement-breakpoint
CREATE INDEX `idx_tournaments_format_date` ON `tournaments` (`format`,`date`);