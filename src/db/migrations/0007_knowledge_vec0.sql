-- Hand-authored: drizzle-kit can't emit CREATE VIRTUAL TABLE. Per
-- `db_orm_drizzle.md`, virtual tables (FTS5, vec0, etc.) are the documented
-- exception to "never hand-edit generated SQL". The vec0 module ships with
-- the sqlite-vec extension which `src/db/open.ts` loads before this file
-- runs.
CREATE VIRTUAL TABLE `knowledge_chunk_embeddings` USING vec0(
  embedding float[1024] distance_metric=cosine
);
