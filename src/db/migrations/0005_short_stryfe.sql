CREATE TABLE `pikalytics_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`format` text NOT NULL,
	`format_slug` text NOT NULL,
	`species_roster_id` text NOT NULL,
	`as_of` text NOT NULL,
	`usage_percent` real,
	`teammates_json` text NOT NULL,
	`items_json` text NOT NULL,
	`abilities_json` text NOT NULL,
	`moves_json` text NOT NULL,
	`sample_size` integer,
	`source_url` text NOT NULL,
	`ai_url` text NOT NULL,
	`fetched_at` text NOT NULL,
	FOREIGN KEY (`species_roster_id`) REFERENCES `species`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "pikalytics_format_regma" CHECK("pikalytics_snapshots"."format" = 'RegM-A'),
	CONSTRAINT "pikalytics_format_slug_value" CHECK("pikalytics_snapshots"."format_slug" = 'gen9championsvgc2026regma'),
	CONSTRAINT "pikalytics_usage_pct_range" CHECK("pikalytics_snapshots"."usage_percent" IS NULL OR ("pikalytics_snapshots"."usage_percent" BETWEEN 0 AND 100)),
	CONSTRAINT "pikalytics_as_of_iso" CHECK("pikalytics_snapshots"."as_of" GLOB '????-??-??')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_pikalytics_species_as_of` ON `pikalytics_snapshots` (`species_roster_id`,`as_of`);--> statement-breakpoint
CREATE INDEX `idx_pikalytics_species_as_of_desc` ON `pikalytics_snapshots` (`species_roster_id`,`as_of`);--> statement-breakpoint
CREATE INDEX `idx_pikalytics_as_of` ON `pikalytics_snapshots` (`as_of`);