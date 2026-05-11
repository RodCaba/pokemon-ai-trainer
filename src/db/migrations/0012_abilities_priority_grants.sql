-- Hand-authored migration 0012 — adds `priority_grants_json` to the
-- `abilities` table (Stage C of `turn-weighted-phase-scoring`, plan §5).
--
-- Per memory `single_db_non_destructive_build.md` the migration is
-- additive: every existing `abilities` row survives unchanged with
-- `priority_grants_json = NULL`. Curated backfill JSON
-- (`data/reg-m-a/abilities-priority.json`) is applied by the roster
-- build script, NOT this migration — keeps the SQL data-free.

ALTER TABLE `abilities` ADD COLUMN `priority_grants_json` text DEFAULT NULL;
