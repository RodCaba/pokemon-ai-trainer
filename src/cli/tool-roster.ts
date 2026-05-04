import { fileURLToPath } from "node:url";
import { open } from "../db/open";
import * as roster from "../db/roster";
import { RosterDataError, RosterDbError } from "../schemas/errors";
import type { Pokemon } from "../schemas/pokemon";

const DEFAULT_DB_PATH = "data/reg-m-a/db.sqlite";

/**
 * Result of one CLI invocation. Returned by `main()` so tests can inspect
 * exit code and output without spawning a subprocess.
 */
export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Programmatic entry point for `pnpm tool:roster <species> [--json]`.
 *
 * **When to use it:** tests call this directly with a synthetic `argv`. The
 * top-level shim at the bottom of this file calls it with `process.argv` and
 * forwards `exitCode`/output to the real process when invoked as a script.
 *
 * @param argv — Command-line arguments AFTER `node script.js` (i.e., `process.argv.slice(2)`).
 * @param opts — Test-only overrides. `dbPath` defaults to `data/reg-m-a/db.sqlite`.
 * @returns A `CliResult` with `exitCode`, `stdout`, `stderr`. Exit codes:
 *   `0` success, `1` `RosterDataError`, `2` species not found, `3` `RosterDbError`,
 *   `64` argv usage error.
 *
 * @example
 *   const r = await main(["Garchomp"]);
 *   r.exitCode; // 0
 *   r.stdout;   // "Species:  Garchomp (garchomp)\n..."
 */
export async function main(
  argv: string[],
  opts: { dbPath?: string } = {},
): Promise<CliResult> {
  const dbPath = opts.dbPath ?? DEFAULT_DB_PATH;

  // Argv parsing — manual, no extra deps.
  const positional = argv.filter((a) => !a.startsWith("--"));
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const json = flags.has("--json");
  const species = positional[0];

  const usage =
    "Usage: pnpm tool:roster <species> [--json]\n" +
    "  Looks up a Reg M-A Pokemon by Showdown id, display name, or alias.\n";

  if (flags.has("--help")) {
    return { exitCode: 0, stdout: usage, stderr: "" };
  }
  if (!species) {
    return { exitCode: 64, stdout: "", stderr: usage };
  }

  let result: Pokemon | null;
  try {
    const db = open(dbPath, { readonly: true });
    try {
      result = roster.get(db, species, "RegM-A");
    } finally {
      db.$client.close();
    }
  } catch (e) {
    if (e instanceof RosterDataError) {
      return { exitCode: 1, stdout: "", stderr: `RosterDataError: ${e.message}\n` };
    }
    if (e instanceof RosterDbError) {
      return { exitCode: 3, stdout: "", stderr: `RosterDbError: ${e.message}\n` };
    }
    return { exitCode: 3, stdout: "", stderr: `unexpected error: ${(e as Error).message}\n` };
  }

  if (!result) {
    return { exitCode: 2, stdout: "", stderr: `not found: ${species}\n` };
  }

  if (json) {
    return { exitCode: 0, stdout: `${JSON.stringify(result, null, 2)}\n`, stderr: "" };
  }
  return { exitCode: 0, stdout: prettyPrint(result), stderr: "" };
}

function prettyPrint(p: Pokemon): string {
  const stats = p.base_stats;
  const bst = stats.hp + stats.atk + stats.def + stats.spa + stats.spd + stats.spe;
  const abilities: string[] = [];
  abilities.push(`0=${p.abilities["0"]}`);
  if (p.abilities["1"]) abilities.push(`1=${p.abilities["1"]}`);
  if (p.abilities.h) abilities.push(`H=${p.abilities.h}`);
  const movepoolPreview = p.movepool.slice(0, 3).join(", ");
  const moreSuffix = p.movepool.length > 3 ? ", ..." : "";

  return [
    `Species:   ${p.display_name} (${p.id})`,
    `Types:     ${p.types.join(" / ")}`,
    `Stats:     HP ${stats.hp}  Atk ${stats.atk}  Def ${stats.def}  SpA ${stats.spa}  SpD ${stats.spd}  Spe ${stats.spe}  (BST ${bst})`,
    `Abilities: ${abilities.join("  ")}`,
    `Movepool:  ${p.movepool.length} moves (${movepoolPreview}${moreSuffix})`,
    `Weight:    ${p.weight_kg} kg`,
    `Mega:      ${p.is_mega ? "yes" : "no"}`,
    `Source:    @smogon/calc engine_sha=${p.source.engine_sha.slice(0, 8)} (fetched ${p.source.fetched_at.slice(0, 10)})`,
    "",
  ].join("\n");
}

// Top-level shim: only run when invoked directly (not when imported by tests).
const me = fileURLToPath(import.meta.url);
if (process.argv[1] === me) {
  main(process.argv.slice(2))
    .then((r) => {
      if (r.stdout) process.stdout.write(r.stdout);
      if (r.stderr) process.stderr.write(r.stderr);
      process.exit(r.exitCode);
    })
    .catch((e: unknown) => {
      console.error(e);
      process.exit(1);
    });
}
