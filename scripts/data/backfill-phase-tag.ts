/**
 * Stage 4 scaffold for the `phase_tag` backfill (Q12 §17).
 *
 * Re-runs a single-purpose Haiku classifier prompt over `insights` rows
 * with `phase_tag IS NULL`, parses the emitted `phase_tag`, and updates
 * the row in place. Idempotent: rows that already carry `phase_tag !=
 * NULL` are skipped.
 *
 * Stage 5 wires the real Anthropic call + retries + summary report.
 */

import type { Db } from "../../src/db/open";
import type { EmbedClient } from "../../src/tools/knowledge/embed";

export interface BackfillDeps {
  db: Db;
  embedClient: EmbedClient;
  anthropic: {
    messages: { create(args: unknown): Promise<unknown> };
  };
}

export interface BackfillSummary {
  scanned: number;
  tagged: number;
  skipped: number;
}

export async function main(_deps: BackfillDeps): Promise<BackfillSummary> {
  return { scanned: 0, tagged: 0, skipped: 0 };
}
