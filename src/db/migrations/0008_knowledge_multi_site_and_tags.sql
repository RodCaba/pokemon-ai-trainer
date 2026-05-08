-- Hand-authored: drizzle-kit can express CHECK constraint changes via the
-- standard SQLite 12-step table-rebuild, but doing so by hand here is the
-- documented exception when the rebuild must preserve unrelated rows
-- (`db_orm_drizzle.md`) AND we are widening — not narrowing — the constraint.
--
-- Plan: docs/plans/metavgc-guides.md §19. Widens `knowledge_chunks`:
--   1. CHECK on source_site widened from `= 'vgcguide'` to
--      `IN ('vgcguide','metavgc')`.
--   2. Unique index widened from `(article_slug, chunk_index)` to
--      `(source_site, article_slug, chunk_index)` — same slug+chunk on two
--      sites must coexist.
--   3. CHECK on `id` widened from `GLOB 'vgcguide:*'` to allow `metavgc:*`.
--
-- Adds a normalized link table `knowledge_chunk_species_tags` with composite
-- PK + cascading FKs so per-chunk species tagging is queryable via a JOIN
-- (plan §19.3 — JSON_EACH was rejected for a link table from the start).
--
-- Vec0 sidecar `knowledge_chunk_embeddings` is intentionally untouched: its
-- rowids are the link target of `knowledge_chunks.embedding_ref` strings, and
-- those strings copy verbatim through the table-rebuild's INSERT … SELECT.
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
  CONSTRAINT "knowledge_source_site_value" CHECK("__new_knowledge_chunks"."source_site" IN ('vgcguide','metavgc')),
  CONSTRAINT "knowledge_section_value" CHECK("__new_knowledge_chunks"."article_section" IN ('intro','teambuilding','battling')),
  CONSTRAINT "knowledge_subtype_value" CHECK("__new_knowledge_chunks"."subtype" IS NULL OR "__new_knowledge_chunks"."subtype" = 'battle-replay'),
  CONSTRAINT "knowledge_token_count_range" CHECK("__new_knowledge_chunks"."chunk_token_count" BETWEEN 1 AND 500),
  CONSTRAINT "knowledge_body_hash_format" CHECK("__new_knowledge_chunks"."body_hash" GLOB 'sha256:*'),
  CONSTRAINT "knowledge_id_format" CHECK("__new_knowledge_chunks"."id" GLOB 'vgcguide:*' OR "__new_knowledge_chunks"."id" GLOB 'metavgc:*'),
  CONSTRAINT "knowledge_embedding_ref_format" CHECK("__new_knowledge_chunks"."embedding_ref" GLOB 'knowledge_chunk_embeddings:*')
);
--> statement-breakpoint
INSERT INTO `__new_knowledge_chunks`
  (id, source_site, article_slug, article_title, article_url,
   article_section, section_heading, chunk_index, chunk_text,
   chunk_token_count, subtype, body_hash, embedding_ref,
   fetched_at, author, captured_via)
SELECT
   id, source_site, article_slug, article_title, article_url,
   article_section, section_heading, chunk_index, chunk_text,
   chunk_token_count, subtype, body_hash, embedding_ref,
   fetched_at, author, captured_via
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
CREATE TABLE `knowledge_chunk_species_tags` (
  `chunk_id` text NOT NULL,
  `species_id` text NOT NULL,
  PRIMARY KEY (`chunk_id`, `species_id`),
  FOREIGN KEY (`chunk_id`) REFERENCES `knowledge_chunks`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`species_id`) REFERENCES `species`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `idx_kcst_species` ON `knowledge_chunk_species_tags` (`species_id`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;
