/**
 * CLI entry point for `pnpm data:ingest:vgcguide` (cron-driven; weekly).
 *
 * Argv:
 *   --db <path>        SQLite path (default ./data/db.sqlite).
 *   --no-network       cache-only (tests and dry runs).
 *   --slug <slug>      debug single-article mode; bypasses sitemap.
 *
 * Env vars:
 *   VOYAGE_API_KEY     required unless --no-network.
 *   VGCGUIDE_CACHE_DIR override cache directory (default data/cache/vgcguide).
 *
 * Exit codes:
 *   0  success (including bounded 404s / parse / network / embedding failures).
 *   1  KnowledgeAuthError, KnowledgeStorageError, DB error, uncaught exception.
 *
 * Stage 4 stub: throws `not implemented (Stage 5)`. Tests live in
 * `tests/scripts/ingest-vgcguide.test.ts` and `-idempotency.test.ts`.
 */

import type { VgcGuideClient } from "../../src/tools/vgcguide/client";
import type { EmbedClient } from "../../src/tools/knowledge/embed";

/** Injection slots for {@link main} — overridable in tests. */
export interface MainDeps {
  client?: VgcGuideClient;
  embedClient?: EmbedClient;
}

/**
 * Run the vgcguide ingest. Accepts argv (without `node script.js` prefix);
 * returns the exit code.
 *
 * **When to use it:** the cron / CLI entry point. Tests inject `client` +
 * `embedClient` to avoid real network and Voyage calls.
 *
 * @param argv — Argv slice.
 * @param deps — Optional injection slots; defaults wire to production.
 * @returns Process exit code (0 success, 1 fatal).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function main(argv: string[], deps: MainDeps = {}): Promise<number> {
  throw new Error("not implemented (Stage 5)");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(e);
      process.exit(1);
    },
  );
}
