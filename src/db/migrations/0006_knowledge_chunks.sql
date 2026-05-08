CREATE TABLE `knowledge_chunks` (
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
	CONSTRAINT "knowledge_source_site_value" CHECK("knowledge_chunks"."source_site" = 'vgcguide'),
	CONSTRAINT "knowledge_section_value" CHECK("knowledge_chunks"."article_section" IN ('intro','teambuilding','battling')),
	CONSTRAINT "knowledge_subtype_value" CHECK("knowledge_chunks"."subtype" IS NULL OR "knowledge_chunks"."subtype" = 'battle-replay'),
	CONSTRAINT "knowledge_token_count_range" CHECK("knowledge_chunks"."chunk_token_count" BETWEEN 1 AND 500),
	CONSTRAINT "knowledge_body_hash_format" CHECK("knowledge_chunks"."body_hash" GLOB 'sha256:*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_knowledge_article_chunk` ON `knowledge_chunks` (`article_slug`,`chunk_index`);--> statement-breakpoint
CREATE INDEX `idx_knowledge_section` ON `knowledge_chunks` (`article_section`);--> statement-breakpoint
CREATE INDEX `idx_knowledge_subtype` ON `knowledge_chunks` (`subtype`);--> statement-breakpoint
CREATE INDEX `idx_knowledge_body_hash` ON `knowledge_chunks` (`article_slug`,`body_hash`);
