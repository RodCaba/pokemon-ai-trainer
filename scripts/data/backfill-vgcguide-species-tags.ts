/**
 * Stage 4 scaffold — signatures only. Stage 5 implements per
 * `docs/plans/metavgc-guides.md` §19.4.
 */

import type { Db } from "../../src/db/open";

export interface BackfillDeps {
  db?: Db;
}

export async function main(
  _argv: string[],
  _deps: BackfillDeps = {},
): Promise<number> {
  void _argv;
  void _deps;
  throw new Error("not implemented (Stage 5)");
}
