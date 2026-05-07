/**
 * Operator demo script: prints the top-N Pikalytics teammates for one species
 * (defaults to `sneasler`). Mirrors `scripts/labmaus-latest.ts` shape.
 *
 * No live network — reads from the local DB only. Run after a successful
 * `pnpm data:ingest:pikalytics` to sanity-check the persisted data.
 *
 * Argv:
 *   --db <path>           SQLite path (default ./data/db.sqlite).
 *   --species <roster-id> species to inspect (default sneasler).
 *   --limit <n>           top-N (default 10).
 */

import { open } from "../src/db/open";
import * as pikalytics from "../src/db/pikalytics";

function parseArgs(argv: string[]): { dbPath: string; species: string; limit: number } {
  const out = { dbPath: "./data/db.sqlite", species: "sneasler", limit: 10 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--db") out.dbPath = argv[++i] ?? "";
    else if (a === "--species") out.species = argv[++i] ?? "";
    else if (a === "--limit") out.limit = Number.parseInt(argv[++i] ?? "10", 10);
  }
  return out;
}

function main(argv: string[]): number {
  const { dbPath, species, limit } = parseArgs(argv);
  const db = open(dbPath, { readonly: true });
  try {
    const out = pikalytics.teammates(db, { format: "RegM-A", species, limit });
    console.log(JSON.stringify({ species, teammates: out }, null, 2));
    return 0;
  } finally {
    db.$client.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}

export { main };
