/**
 * CLI entry point for `pnpm data:tactical`.
 *
 * Argv:
 *   overview     --db <path> <team-id>
 *   pillars      --db <path> <team-id>
 *   recommend    --db <path> <team-id> [scenario-name]
 *   threat-panel --db <path>
 */

import { open } from "../../src/db/open";
import { buildOverview } from "../../src/data/tactical/overview";
import { buildThreatPanel } from "../../src/data/tactical/threat-panel";
import { handleScorePillars, handleRecommendLeads } from "../../src/agents/tactical-tools";
import { TacticalError } from "../../src/schemas/errors";

interface ParsedArgs {
  command: string;
  dbPath: string;
  positional: string[];
}

function parseArgs(argv: ReadonlyArray<string>): ParsedArgs {
  const command = argv[0] ?? "overview";
  const positional: string[] = [];
  let dbPath = "data/reg-m-a/db.sqlite";
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--db" && argv[i + 1]) {
      dbPath = argv[++i]!;
    } else if (a === "--scenario" && argv[i + 1]) {
      positional.push(argv[++i]!);
    } else {
      positional.push(a);
    }
  }
  return { command, dbPath, positional };
}

/**
 * CLI dispatcher for the tactical slice.
 *
 * @param argv - argv slice (no node/script prefix).
 * @returns Exit code: 0 on success, 2 on `TacticalError`, 1 otherwise.
 * @throws Never — all errors are caught and surfaced to stderr.
 */
export async function main(argv: ReadonlyArray<string>): Promise<number> {
  const { command, dbPath, positional } = parseArgs(argv);
  let db;
  try {
    db = open(dbPath);
  } catch (e) {
    process.stderr.write(`Failed to open DB at ${dbPath}: ${(e as Error).message}\n`);
    return 1;
  }
  const deps = {
    db,
    calc: { calc: () => ({}) },
    speed: {},
    synergy: { db },
  };

  try {
    switch (command) {
      case "overview": {
        const teamId = positional[0]!;
        const ov = buildOverview(teamId, deps);
        process.stdout.write(JSON.stringify(ov, null, 2) + "\n");
        return 0;
      }
      case "pillars":
      case "score-pillars": {
        const teamId = positional[0]!;
        const out = handleScorePillars({ team_id: teamId }, deps);
        process.stdout.write(JSON.stringify(out, null, 2) + "\n");
        return 0;
      }
      case "recommend":
      case "recommend-leads": {
        const teamId = positional[0]!;
        const scenario = positional[1];
        const out = handleRecommendLeads(
          { team_id: teamId, ...(scenario ? { scenario_name: scenario } : {}) },
          deps,
        );
        process.stdout.write(JSON.stringify(out, null, 2) + "\n");
        return 0;
      }
      case "threat-panel": {
        const panel = buildThreatPanel({ db, empty_source_throws: false });
        process.stdout.write(JSON.stringify(panel, null, 2) + "\n");
        return 0;
      }
      default:
        process.stderr.write(`Unknown command: ${command}\n`);
        return 1;
    }
  } catch (e) {
    if (e instanceof TacticalError) {
      process.stderr.write(`tactical: ${e.message}\n`);
      return 2;
    }
    process.stderr.write(`error: ${(e as Error).message}\n`);
    return 1;
  } finally {
    try {
      db.$client.close();
    } catch {
      /* noop */
    }
  }
}

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
