/**
 * CLI entry point for `pnpm data:ingest:labmaus`. Stage 4 stub.
 *
 * Argv (final form lands in Stage 5):
 *   --from YYYY-MM-DD       cold-start window start (default 2026-04-06)
 *   --to   YYYY-MM-DD       cold-start window end   (default today)
 *   --mode full|incremental default full
 *   --db   <path>           SQLite path (default ./data/db.sqlite)
 *   --no-network            cache-only replay (tests, dry runs)
 *   --concurrency <n>       parallel getTournament fan-out (default 4)
 *
 * Exit codes:
 *   0  success (including bounded cross-check warnings)
 *   1  schema drift, unknown species, DB error, network exhaustion
 *   2  invalid argv
 */

/**
 * Run the labmaus ingest end-to-end.
 *
 * @param argv — Process argv slice (typically `process.argv.slice(2)`).
 * @returns Process exit code.
 */
export async function main(argv: string[]): Promise<number> {
  void argv;
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
