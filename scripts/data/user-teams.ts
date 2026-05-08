/**
 * CLI entry point for `pnpm data:user-teams`.
 *
 * Argv:
 *   create  --db <path> [--name <n>] [--description <d>] [--win-condition <wc>]
 *   list    --db <path> [--status <s>] [--origin <o>]
 *   show    --db <path> <id>
 *   delete  --db <path> <id>
 *   from-paste      --db <path> --file <path>
 *   from-tournament --db <path> --tournament-team-id <ttid>
 *   validate        --db <path> <id> [--target draft|saved]
 *   set-status      --db <path> <id> <status>
 *   revisions       --db <path> <id>
 *   restore         --db <path> <id> <revision-number>
 *   checkpoint      --db <path> <id> [--label <s>]
 *
 * Exit codes:
 *   0  success
 *   1  validation / not-found / DB error
 *   2  invalid argv
 */

import { readFileSync } from "node:fs";
import { open } from "../../src/db/open";
import * as userTeams from "../../src/db/user-teams";
import { parsePokepasteToTeam } from "../../src/data/user-teams/parse-pokepaste";
import { duplicateFromTournament } from "../../src/data/user-teams/duplicate-from-tournament";
import { validateTeam, type ValidateDeps } from "../../src/data/team-validate";
import * as itemsRepo from "../../src/db/items";
import * as abilitiesRepo from "../../src/db/abilities";
import * as movesRepo from "../../src/db/moves";
import * as roster from "../../src/db/roster";
import {
  UserTeamError,
  UserTeamNotFoundError,
  UserTeamRevisionNotFoundError,
  UserTeamValidationError,
  RosterDbError,
  RosterDataError,
} from "../../src/schemas/errors";
import type { Db } from "../../src/db/open";
import type {
  UserTeamOrigin,
  UserTeamStatus,
} from "../../src/schemas/user-teams";

interface ParsedArgs {
  subcommand: string;
  db: string;
  positional: string[];
  flags: Record<string, string>;
}

function parseArgs(argv: string[]): ParsedArgs | { error: string } {
  if (argv.length === 0) return { error: "no subcommand" };
  const subcommand = argv[0]!;
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        flags[key] = "true";
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(a);
    }
  }
  const dbPath = flags.db ?? "./data/db.sqlite";
  return { subcommand, db: dbPath, positional, flags };
}

/** Build real `ValidateDeps` from the live ref-table repos. */
function buildValidateDeps(db: Db): ValidateDeps {
  const speciesAbilityCache = new Map<string, string[]>();
  const speciesMoveCache = new Map<string, string[]>();
  return {
    db,
    speciesRepo: {
      has: (d, n) => roster.get(d, n, "RegM-A") !== null,
      get: (d, n) => roster.get(d, n, "RegM-A"),
    },
    itemsRepo: { has: (d, n) => itemsRepo.has(d, n, "RegM-A") },
    abilitiesRepo: { has: (d, n) => abilitiesRepo.has(d, n, "RegM-A") },
    movesRepo: { has: (d, n) => movesRepo.has(d, n, "RegM-A") },
    rosterRepo: {
      isLegalForFormat: (d, id) => {
        // Reuse roster.get's existence check; treat any matched row as
        // legal in this slice (the validator's species_not_legal_warning
        // path is exercised in unit tests with stub deps).
        const found = roster.get(d, id, "RegM-A");
        return {
          in_membership: found !== null,
          is_legal: found !== null,
        };
      },
    },
    speciesAbilities: {
      legalFor: (d, speciesId) => {
        const cached = speciesAbilityCache.get(speciesId);
        if (cached) return cached;
        const entry = roster.get(d, speciesId, "RegM-A");
        const slots = entry?.abilities;
        const list: string[] = [];
        if (slots) {
          if (slots["0"]) list.push(slots["0"]);
          if (slots["1"]) list.push(slots["1"]);
          if (slots.h) list.push(slots.h);
        }
        speciesAbilityCache.set(speciesId, list);
        return list;
      },
    },
    speciesMovepool: {
      legalFor: (d, speciesId) => {
        const cached = speciesMoveCache.get(speciesId);
        if (cached) return cached;
        const entry = roster.get(d, speciesId, "RegM-A");
        const list = entry?.movepool ?? [];
        speciesMoveCache.set(speciesId, list);
        return list;
      },
    },
  };
}

/**
 * CLI dispatch.
 *
 * @param argv — process.argv-style arguments after the script name.
 * @returns Exit code (0 success, 1 user/DB error, 2 invalid argv).
 */
export async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if ("error" in parsed) {
    process.stderr.write(`user-teams: ${parsed.error}\n`);
    return 2;
  }
  const { subcommand, db: dbPath, positional, flags } = parsed;

  let db: Db;
  try {
    db = open(dbPath);
  } catch (e) {
    process.stderr.write(
      `user-teams: failed to open db ${dbPath}: ${(e as Error).message}\n`,
    );
    return 1;
  }

  try {
    switch (subcommand) {
      case "create": {
        const team = userTeams.create(db, {
          origin: "builder",
          name: flags.name,
          description: flags.description ?? null,
          win_condition: flags["win-condition"] ?? null,
        });
        process.stdout.write(`${team.id}\n`);
        return 0;
      }
      case "list": {
        const filter: { status?: UserTeamStatus; origin?: UserTeamOrigin } = {};
        if (flags.status !== undefined)
          filter.status = flags.status as UserTeamStatus;
        if (flags.origin !== undefined)
          filter.origin = flags.origin as UserTeamOrigin;
        const all = userTeams.list(db, filter);
        for (const t of all) {
          process.stdout.write(`${t.id}\t${t.status}\t${t.origin}\t${t.name}\n`);
        }
        return 0;
      }
      case "show": {
        const id = positional[0];
        if (!id) {
          process.stderr.write("show: missing <id>\n");
          return 2;
        }
        const team = userTeams.get(db, id);
        if (!team) {
          process.stderr.write(`show: ${id} not found\n`);
          return 1;
        }
        process.stdout.write(`${JSON.stringify(team, null, 2)}\n`);
        return 0;
      }
      case "delete": {
        const id = positional[0];
        if (!id) return 2;
        userTeams.deleteTeam(db, id);
        return 0;
      }
      case "from-paste": {
        const file = flags.file;
        if (!file) {
          process.stderr.write("from-paste: --file required\n");
          return 2;
        }
        const text = readFileSync(file, "utf8");
        const result = parsePokepasteToTeam(text, {
          db,
          transform: {
            db,
            rosterRepo: {
              has: (d, n) => roster.get(d, n, "RegM-A") !== null,
              get: (d, n) => roster.get(d, n, "RegM-A"),
            },
            itemsRepo: { has: (d, n) => itemsRepo.has(d, n, "RegM-A") },
            abilitiesRepo: { has: (d, n) => abilitiesRepo.has(d, n, "RegM-A") },
            movesRepo: { has: (d, n) => movesRepo.has(d, n, "RegM-A") },
          },
        });
        const team = userTeams.create(db, {
          origin: "paste",
          origin_payload: result.team.origin_payload,
          description: result.team.description,
          win_condition: result.team.win_condition,
          sets: result.team.sets,
        });
        // Persist regardless (auto-persist contract: drafts survive parse
        // failures so the user can edit and re-validate). But surface the
        // parse outcome via exit code: 0 clean, 3 partial-with-errors. The
        // team id is always printed so callers can locate the draft.
        process.stdout.write(`${team.id}\n`);
        if (result.parse_errors.length > 0) {
          process.stderr.write(
            `from-paste: parse errors: ${JSON.stringify(result.parse_errors)}\n`,
          );
          return 3;
        }
        return 0;
      }
      case "from-tournament": {
        const ttid = flags["tournament-team-id"];
        if (!ttid) {
          process.stderr.write("from-tournament: --tournament-team-id required\n");
          return 2;
        }
        const dup = duplicateFromTournament(db, ttid);
        const team = userTeams.create(db, {
          origin: "duplicated_from_tournament",
          source_tournament_team_id: dup.source_tournament_team_id,
          description: dup.team.description,
          win_condition: dup.team.win_condition,
          sets: dup.team.sets,
        });
        process.stdout.write(`${team.id}\n`);
        return 0;
      }
      case "validate": {
        const id = positional[0];
        if (!id) return 2;
        const team = userTeams.get(db, id);
        if (!team) {
          process.stderr.write(`validate: ${id} not found\n`);
          return 1;
        }
        const target = (flags.target as "draft" | "saved" | undefined) ?? "draft";
        const result = validateTeam(team, buildValidateDeps(db), {
          target_status: target,
        });
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return 0;
      }
      case "set-status": {
        const id = positional[0];
        const status = positional[1] as UserTeamStatus | undefined;
        if (!id || !status) return 2;
        userTeams.setStatus(db, id, status, buildValidateDeps(db));
        return 0;
      }
      case "revisions": {
        const id = positional[0];
        if (!id) return 2;
        const revs = userTeams.listRevisions(db, id);
        for (const r of revs) {
          process.stdout.write(`${r.revision_number}\t${r.created_at}\n`);
        }
        return 0;
      }
      case "restore": {
        const id = positional[0];
        const num = positional[1];
        if (!id || !num) return 2;
        userTeams.restoreRevision(db, id, Number.parseInt(num, 10));
        return 0;
      }
      case "checkpoint": {
        const id = positional[0];
        if (!id) return 2;
        const meta = userTeams.checkpoint(db, id, flags.label);
        process.stdout.write(`${meta.revision_number}\n`);
        return 0;
      }
      default:
        process.stderr.write(`unknown subcommand: ${subcommand}\n`);
        return 2;
    }
  } catch (e) {
    if (e instanceof UserTeamValidationError) {
      process.stderr.write(`validation: ${JSON.stringify(e.result)}\n`);
      return 1;
    }
    if (
      e instanceof UserTeamNotFoundError ||
      e instanceof UserTeamRevisionNotFoundError ||
      e instanceof UserTeamError ||
      e instanceof RosterDbError ||
      e instanceof RosterDataError
    ) {
      process.stderr.write(`${e.name}: ${e.message}\n`);
      return 1;
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

// Allow direct invocation: `tsx scripts/data/user-teams.ts <subcmd> ...`
const isMain =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1]?.endsWith("user-teams.ts");
if (isMain) {
  void main(process.argv.slice(2)).then((code) => process.exit(code));
}
