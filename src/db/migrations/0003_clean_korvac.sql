DROP TABLE `species_alias_labmaus`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tournament_team_species` (
	`team_id` text NOT NULL,
	`slot` integer NOT NULL,
	`labmaus_id` text NOT NULL,
	PRIMARY KEY(`team_id`, `slot`),
	FOREIGN KEY (`team_id`) REFERENCES `tournament_teams`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "tournament_team_species_slot_range" CHECK("__new_tournament_team_species"."slot" BETWEEN 0 AND 5)
);
--> statement-breakpoint
INSERT INTO `__new_tournament_team_species`("team_id", "slot", "labmaus_id") SELECT "team_id", "slot", "labmaus_id" FROM `tournament_team_species`;--> statement-breakpoint
DROP TABLE `tournament_team_species`;--> statement-breakpoint
ALTER TABLE `__new_tournament_team_species` RENAME TO `tournament_team_species`;--> statement-breakpoint
PRAGMA foreign_keys=ON;