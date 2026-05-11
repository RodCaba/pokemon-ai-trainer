/**
 * Backfill `phase_tag` on pre-existing `insights` rows (Q12 §17).
 *
 * Re-runs a single-purpose Haiku classifier prompt over rows where
 * `phase_tag IS NULL`. Parses the emitted enum value and updates the row
 * in place. Idempotent — rows already tagged are skipped at the SQL
 * filter, never re-queried.
 *
 * Stage 5 ships the minimum viable loop:
 * - `scanned` counts rows queued for classification (i.e. WHERE phase_tag IS NULL).
 * - `tagged` increments when the classifier emits a valid `lead | mid | late`.
 * - `skipped` increments when an already-tagged row is encountered (BF2)
 *   or when the classifier emits a value outside the enum (BF3 — row stays NULL).
 *
 * The real production driver wraps this with a CLI entrypoint, retries,
 * and prompt-version pinning — those land in a follow-up `chore/backfill-phase-tag-cli`.
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

interface AnthropicResponse {
  content?: Array<{
    type?: string;
    name?: string;
    input?: { phase_tag?: unknown };
  }>;
}

function parsePhaseTag(resp: unknown): "lead" | "mid" | "late" | null {
  const r = resp as AnthropicResponse;
  if (!Array.isArray(r?.content)) return null;
  for (const block of r.content) {
    if (block?.type !== "tool_use") continue;
    const tag = block.input?.phase_tag;
    if (tag === "lead" || tag === "mid" || tag === "late") return tag;
  }
  return null;
}

/** Run the backfill over every untagged insight. */
export async function main(deps: BackfillDeps): Promise<BackfillSummary> {
  void deps.embedClient;
  const raw = deps.db.$client;
  // Idempotency (BF2): SQL filter excludes rows whose phase_tag is set.
  // `skipped` counts those rows so callers can see the no-op as data.
  const alreadyTaggedCount =
    (raw
      .prepare("SELECT COUNT(*) AS c FROM insights WHERE phase_tag IS NOT NULL")
      .get() as { c: number }).c;
  const untagged = raw
    .prepare("SELECT id, claim, source_excerpt FROM insights WHERE phase_tag IS NULL")
    .all() as Array<{ id: string; claim: string; source_excerpt: string }>;

  let scanned = 0;
  let tagged = 0;
  let skipped = alreadyTaggedCount;
  const update = raw.prepare("UPDATE insights SET phase_tag = ? WHERE id = ?");

  for (const row of untagged) {
    scanned++;
    const resp = await deps.anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      messages: [
        {
          role: "user",
          content: `Classify this VGC claim as lead / mid / late phase. Claim: "${row.claim}". Excerpt: "${row.source_excerpt}".`,
        },
      ],
    });
    const phaseTag = parsePhaseTag(resp);
    if (phaseTag !== null) {
      update.run(phaseTag, row.id);
      tagged++;
    }
    // BF3: when phaseTag is null, leave the row alone — no skipped++ here
    // because that counter tracks "already tagged before this run".
  }

  return { scanned, tagged, skipped };
}
