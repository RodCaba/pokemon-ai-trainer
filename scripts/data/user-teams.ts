/**
 * CLI entry point for `pnpm data:user-teams`.
 *
 * Argv:
 *   create  --name <n> [--description <d>] [--win-condition <wc>]
 *   list    [--status <s>] [--origin <o>]
 *   show    <id>
 *   delete  <id>
 *   from-paste --file <path>
 *   from-tournament --tournament-team-id <ttid>
 *   validate <id>
 *   set-status <id> <status>
 *   revisions <id>
 *   restore <id> <revision-number>
 *   checkpoint <id> [--label <s>]
 *
 * Exit codes:
 *   0  success
 *   1  validation / not-found / DB error
 *   2  invalid argv
 */

/**
 * Run the user-teams CLI with the given argv.
 *
 * @param argv — process.argv-style arguments after the script name.
 * @returns Exit code (0 success, 1 user/DB error, 2 invalid argv).
 *
 * Stage-4 stub: every subcommand throws.
 */
export async function main(argv: string[]): Promise<number> {
  void argv;
  throw new Error(
    "not implemented (Stage 5): scripts/data/user-teams.ts::main",
  );
}
