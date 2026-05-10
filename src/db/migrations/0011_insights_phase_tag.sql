-- Hand-authored migration 0011 — adds `phase_tag` to the `insights` table
-- (Stage A of `team-support-pillar`, plan §15).
--
-- Per memory `single_db_non_destructive_build.md` the migration is additive:
-- every existing `insights` row survives unchanged with `phase_tag = NULL`.
--
-- The `phase_tag` column is one of: 'lead' | 'mid' | 'late' | NULL.
-- NULL is the default (the speaker didn't tie the claim to a specific phase).
-- Stage B's `recommend_team_plan` is the first downstream consumer; for
-- Stage A it is accepted on insert and read back on select but does not
-- influence retrieval scoring beyond an optional WHERE filter.

ALTER TABLE `insights` ADD COLUMN `phase_tag` text DEFAULT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_insights_phase_tag` ON `insights` (`phase_tag`);
