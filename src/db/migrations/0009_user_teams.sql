-- Plan: docs/plans/user-teams.md §5. Three new tables — `user_teams`,
-- `user_team_sets`, `user_team_revisions` — additive only. No existing
-- tables touched (memory `single_db_non_destructive_build.md`).
--
-- FK on `user_teams.source_tournament_team_id` → `tournament_teams.id`
-- uses ON DELETE SET NULL (Stage-2 Q4). CASCADE applies on parent
-- `user_teams` → `user_team_sets` and `user_team_revisions`.
CREATE TABLE `user_teams` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `description` text,
  `win_condition` text,
  `status` text NOT NULL DEFAULT 'draft',
  `origin` text NOT NULL,
  `origin_payload` text,
  `source_tournament_team_id` text,
  `validation_errors` text NOT NULL DEFAULT '[]',
  `validation_warnings` text NOT NULL DEFAULT '[]',
  `schema_version` integer NOT NULL DEFAULT 1,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`source_tournament_team_id`) REFERENCES `tournament_teams`(`id`) ON DELETE SET NULL,
  CONSTRAINT "user_teams_status_valid" CHECK(`status` IN ('draft','saved','archived')),
  CONSTRAINT "user_teams_origin_valid" CHECK(`origin` IN ('paste','builder','ai_prompt','duplicated_from_tournament')),
  CONSTRAINT "user_teams_origin_tournament_consistency" CHECK(
    (`origin` = 'duplicated_from_tournament') = (`source_tournament_team_id` IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE INDEX `idx_user_teams_status` ON `user_teams` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_user_teams_origin` ON `user_teams` (`origin`);
--> statement-breakpoint
CREATE INDEX `idx_user_teams_updated_at_desc` ON `user_teams` (`updated_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_user_teams_name` ON `user_teams` (`name`);
--> statement-breakpoint
CREATE TABLE `user_team_sets` (
  `user_team_id` text NOT NULL,
  `slot` integer NOT NULL,
  `species_id` text,
  `nickname` text,
  `item_id` text,
  `ability_id` text,
  `nature` text,
  `hp_sps` integer NOT NULL DEFAULT 0,
  `atk_sps` integer NOT NULL DEFAULT 0,
  `def_sps` integer NOT NULL DEFAULT 0,
  `spa_sps` integer NOT NULL DEFAULT 0,
  `spd_sps` integer NOT NULL DEFAULT 0,
  `spe_sps` integer NOT NULL DEFAULT 0,
  `move_1_id` text,
  `move_2_id` text,
  `move_3_id` text,
  `move_4_id` text,
  `notes` text,
  PRIMARY KEY (`user_team_id`, `slot`),
  FOREIGN KEY (`user_team_id`) REFERENCES `user_teams`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`species_id`) REFERENCES `species`(`id`),
  FOREIGN KEY (`item_id`) REFERENCES `items`(`id`),
  FOREIGN KEY (`ability_id`) REFERENCES `abilities`(`id`),
  FOREIGN KEY (`move_1_id`) REFERENCES `moves`(`id`),
  FOREIGN KEY (`move_2_id`) REFERENCES `moves`(`id`),
  FOREIGN KEY (`move_3_id`) REFERENCES `moves`(`id`),
  FOREIGN KEY (`move_4_id`) REFERENCES `moves`(`id`),
  CONSTRAINT "user_team_sets_slot_range" CHECK(`slot` BETWEEN 0 AND 5),
  CONSTRAINT "user_team_sets_hp_sps_le_32" CHECK(`hp_sps` BETWEEN 0 AND 32),
  CONSTRAINT "user_team_sets_atk_sps_le_32" CHECK(`atk_sps` BETWEEN 0 AND 32),
  CONSTRAINT "user_team_sets_def_sps_le_32" CHECK(`def_sps` BETWEEN 0 AND 32),
  CONSTRAINT "user_team_sets_spa_sps_le_32" CHECK(`spa_sps` BETWEEN 0 AND 32),
  CONSTRAINT "user_team_sets_spd_sps_le_32" CHECK(`spd_sps` BETWEEN 0 AND 32),
  CONSTRAINT "user_team_sets_spe_sps_le_32" CHECK(`spe_sps` BETWEEN 0 AND 32)
);
--> statement-breakpoint
CREATE TABLE `user_team_revisions` (
  `user_team_id` text NOT NULL,
  `revision_number` integer NOT NULL,
  `label` text,
  `snapshot_json` text NOT NULL,
  `created_at` text NOT NULL,
  PRIMARY KEY (`user_team_id`, `revision_number`),
  FOREIGN KEY (`user_team_id`) REFERENCES `user_teams`(`id`) ON DELETE CASCADE,
  CONSTRAINT "user_team_revisions_number_range" CHECK(`revision_number` BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE INDEX `idx_user_team_revisions_team_created` ON `user_team_revisions` (`user_team_id`,`created_at`);
