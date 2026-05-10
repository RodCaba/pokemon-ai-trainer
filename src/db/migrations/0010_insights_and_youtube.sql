-- Hand-authored migration 0010 — adds the YouTube source_site / subtype to
-- knowledge_chunks, the new metadata JSON column, and the parallel insights
-- + insight_subjects + insight_embeddings (vec0) tables.
--
-- Plan: docs/plans/youtube-insights.md §4. Per memory single_db_non_destructive_build.md
-- the migration is additive: every existing knowledge_chunks row survives unchanged
-- (metadata defaults to NULL); every existing knowledge_chunk_embeddings vec0 row is
-- left untouched.
--
-- Phase 1 — knowledge_chunks table-rebuild (CHECK widening + metadata column).
-- Phase 2 — `insights` relational table.
-- Phase 3 — `insight_subjects` link table.
-- Phase 4 — `insight_embeddings` vec0 sidecar.

-- ============================================================
-- Phase 1 — knowledge_chunks table-rebuild
-- ============================================================
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_knowledge_chunks` (
  `id` text PRIMARY KEY NOT NULL,
  `source_site` text NOT NULL,
  `article_slug` text NOT NULL,
  `article_title` text NOT NULL,
  `article_url` text NOT NULL,
  `article_section` text NOT NULL,
  `section_heading` text NOT NULL,
  `chunk_index` integer NOT NULL,
  `chunk_text` text NOT NULL,
  `chunk_token_count` integer NOT NULL,
  `subtype` text,
  `body_hash` text NOT NULL,
  `embedding_ref` text NOT NULL,
  `fetched_at` text NOT NULL,
  `author` text,
  `captured_via` text NOT NULL,
  `metadata` text,
  CONSTRAINT "knowledge_source_site_value" CHECK("__new_knowledge_chunks"."source_site" IN ('vgcguide','metavgc','youtube')),
  CONSTRAINT "knowledge_section_value" CHECK("__new_knowledge_chunks"."article_section" IN ('intro','teambuilding','battling')),
  CONSTRAINT "knowledge_subtype_value" CHECK("__new_knowledge_chunks"."subtype" IS NULL OR "__new_knowledge_chunks"."subtype" IN ('battle-replay','youtube-transcript')),
  CONSTRAINT "knowledge_token_count_range" CHECK("__new_knowledge_chunks"."chunk_token_count" BETWEEN 1 AND 500),
  CONSTRAINT "knowledge_body_hash_format" CHECK("__new_knowledge_chunks"."body_hash" GLOB 'sha256:*'),
  CONSTRAINT "knowledge_id_format" CHECK("__new_knowledge_chunks"."id" GLOB 'vgcguide:*' OR "__new_knowledge_chunks"."id" GLOB 'metavgc:*' OR "__new_knowledge_chunks"."id" GLOB 'youtube:*'),
  CONSTRAINT "knowledge_embedding_ref_format" CHECK("__new_knowledge_chunks"."embedding_ref" GLOB 'knowledge_chunk_embeddings:*')
);
--> statement-breakpoint
INSERT INTO `__new_knowledge_chunks`
  (id, source_site, article_slug, article_title, article_url,
   article_section, section_heading, chunk_index, chunk_text,
   chunk_token_count, subtype, body_hash, embedding_ref,
   fetched_at, author, captured_via, metadata)
SELECT
   id, source_site, article_slug, article_title, article_url,
   article_section, section_heading, chunk_index, chunk_text,
   chunk_token_count, subtype, body_hash, embedding_ref,
   fetched_at, author, captured_via, NULL
FROM `knowledge_chunks`;
--> statement-breakpoint
DROP TABLE `knowledge_chunks`;
--> statement-breakpoint
ALTER TABLE `__new_knowledge_chunks` RENAME TO `knowledge_chunks`;
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_knowledge_article_chunk` ON `knowledge_chunks` (`source_site`,`article_slug`,`chunk_index`);
--> statement-breakpoint
CREATE INDEX `idx_knowledge_section` ON `knowledge_chunks` (`article_section`);
--> statement-breakpoint
CREATE INDEX `idx_knowledge_subtype` ON `knowledge_chunks` (`subtype`);
--> statement-breakpoint
CREATE INDEX `idx_knowledge_body_hash` ON `knowledge_chunks` (`article_slug`,`body_hash`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint

-- ============================================================
-- Phase 2 — insights relational table
-- ============================================================
CREATE TABLE `insights` (
  `id` text PRIMARY KEY NOT NULL,
  `schema_version` integer NOT NULL,
  `claim` text NOT NULL,
  `claim_type` text NOT NULL,
  `confidence` text NOT NULL,
  `stance` text NOT NULL,
  `source_type` text NOT NULL,
  `source_url` text NOT NULL,
  `source_author` text,
  `source_published_at` text,
  `source_excerpt` text NOT NULL,
  `source_timestamp_seconds` integer,
  `extracted_by_model` text NOT NULL,
  `extracted_by_prompt_version` text NOT NULL,
  `extracted_at` text NOT NULL,
  `embedding_ref` text NOT NULL,
  `chunk_id` text REFERENCES `knowledge_chunks`(`id`) ON DELETE CASCADE,
  CONSTRAINT "insights_schema_version" CHECK(`schema_version` = 1),
  CONSTRAINT "insights_claim_len" CHECK(length(`claim`) BETWEEN 1 AND 280),
  CONSTRAINT "insights_claim_type" CHECK(`claim_type` IN ('matchup','set','lead','meta_trend','tech','counter')),
  CONSTRAINT "insights_confidence" CHECK(`confidence` IN ('low','medium','high')),
  CONSTRAINT "insights_stance" CHECK(`stance` IN ('supports','refutes','neutral')),
  CONSTRAINT "insights_source_type" CHECK(`source_type` IN ('youtube','article','tournament','replay','user_note')),
  CONSTRAINT "insights_excerpt_len" CHECK(length(`source_excerpt`) BETWEEN 0 AND 500),
  CONSTRAINT "insights_embedding_ref_format" CHECK(`embedding_ref` GLOB 'insight_embeddings:*'),
  CONSTRAINT "insights_extracted_at_iso" CHECK(`extracted_at` GLOB '????-??-??T??:??:??*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_insights_chunk_claim` ON `insights` (`chunk_id`, `claim`);
--> statement-breakpoint
CREATE INDEX `idx_insights_chunk` ON `insights` (`chunk_id`);
--> statement-breakpoint

-- ============================================================
-- Phase 3 — insight_subjects link table
-- ============================================================
CREATE TABLE `insight_subjects` (
  `insight_id` text NOT NULL,
  `subject_kind` text NOT NULL,
  `subject_value` text NOT NULL,
  PRIMARY KEY (`insight_id`, `subject_kind`, `subject_value`),
  FOREIGN KEY (`insight_id`) REFERENCES `insights`(`id`) ON DELETE CASCADE,
  CONSTRAINT "insight_subjects_kind" CHECK(`subject_kind` IN ('pokemon','move','item','archetype','format'))
);
--> statement-breakpoint
CREATE INDEX `idx_insight_subjects_value` ON `insight_subjects` (`subject_kind`, `subject_value`);
--> statement-breakpoint

-- ============================================================
-- Phase 4 — insight_embeddings vec0 sidecar (512-dim cosine, mirrors knowledge_chunk_embeddings)
-- ============================================================
CREATE VIRTUAL TABLE `insight_embeddings` USING vec0(
  embedding float[512] distance_metric=cosine
);
