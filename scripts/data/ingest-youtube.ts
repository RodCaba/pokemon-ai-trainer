/**
 * Stage 4 stub for `pnpm data:ingest:youtube`. Real implementation lands in
 * Stage 5; see `docs/plans/youtube-insights.md` §5.6.
 *
 * Argv:
 *   --url <youtube_url>   required (single video; channel-pull deferred).
 *   --db <path>           SQLite path (default ./data/db.sqlite).
 *   --no-network          cache-only mode for testing.
 *   --no-extract          chunk-only mode (skip Haiku extraction).
 */

import type { Db } from "../../src/db/open";
import type { EmbedClient } from "../../src/tools/knowledge/embed";
import type { YoutubeClient } from "../../src/tools/youtube/client";
import type { AnthropicClientLike } from "../../src/tools/insights/extract";
import type { SpeciesIndex } from "../../src/tools/knowledge/species-tagger";

/** Injection slots for {@link main} — overridable in tests. */
export interface MainDeps {
  db?: Db;
  ytClient?: YoutubeClient;
  embedClient?: EmbedClient;
  anthropic?: AnthropicClientLike;
  speciesIndex?: SpeciesIndex;
}

/**
 * The CLI entry point. Stage 4 stub — throws so tests fail for the right reason.
 *
 * @param _argv — `process.argv.slice(2)`.
 * @param _deps — Optional injection overrides for tests.
 * @returns Process exit code (0 = success / soft-skip; 1 = fail loud).
 */
export async function main(_argv: string[], _deps?: MainDeps): Promise<number> {
  throw new Error("ingest-youtube main: not implemented (Stage 5)");
}
