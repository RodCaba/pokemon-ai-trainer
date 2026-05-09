/**
 * CLI entry point for `pnpm data:tactical`.
 *
 * Argv:
 *   overview   --db <path> <team-id>
 *   pillars    --db <path> <team-id>
 *   recommend  --db <path> <team-id> [scenario-name]
 *   threat-panel --db <path>
 *
 * Stage-4 stub.
 */

export async function main(_argv: string[]): Promise<number> {
  throw new Error("not implemented (Stage 5)");
}

// Allow direct invocation: `tsx scripts/data/tactical.ts <args>`
if (
  typeof process !== "undefined" &&
  process.argv[1] &&
  /scripts\/data\/tactical\.ts$/.test(process.argv[1])
) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}
