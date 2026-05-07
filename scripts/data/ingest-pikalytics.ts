/**
 * Stage 4 stub for the pikalytics weekly ingest script. Real implementation
 * lands in Stage 5 per `docs/plans/pikalytics.md` §13.
 *
 * Argv:
 *   --db <path>           SQLite path (default ./data/db.sqlite).
 *   --no-network          cache-only (tests and dry runs).
 *   --species <roster-id> debug single-species mode.
 *
 * Env vars:
 *   PIKALYTICS_CACHE_DIR  override cache directory (default data/cache/pikalytics).
 *
 * Exit codes:
 *   0  success (including bounded 404s / parse failures / unknown teammates).
 *   1  PikalyticsTeraLeakError (programmer bug) or DB error.
 */

/**
 * Run the pikalytics ingest. Accepts argv (without `node script.js` prefix);
 * returns the exit code.
 *
 * **When to use it:** the cron / CLI entry point.
 *
 * @param argv — Argv slice (per `docs/plans/pikalytics.md` §13).
 * @returns Process exit code.
 */
export async function main(_argv: string[]): Promise<number> {
  void _argv;
  throw new Error("not implemented (Stage 5): scripts/data/ingest-pikalytics.main");
}
