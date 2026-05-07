/**
 * Stage 4 stub for the pikalytics transform layer. Real implementation lands in
 * Stage 5 per `docs/plans/pikalytics.md` §2 / §3.
 */

import type { Db } from "../../db/open";
import type { PikalyticsSnapshot } from "../../schemas/pikalytics";
import {
  PikalyticsParseError,
  PikalyticsTeraLeakError,
} from "../../schemas/errors";

const _ERROR_REFS = [PikalyticsParseError, PikalyticsTeraLeakError];
void _ERROR_REFS;

/** Repository deps the transform needs for roster-id resolution. */
export interface PikalyticsTransformDeps {
  db: Db;
  rosterRepo: {
    has(db: Db, name: string, format: "RegM-A"): boolean;
    get(db: Db, name: string, format: "RegM-A"): { id: string } | null;
  };
}

/** Inputs for {@link transformPikalyticsMarkdown}. */
export interface PikalyticsTransformInput {
  species_roster_id: string;
  raw_markdown: string;
  source_url: string;
  ai_url: string;
  /** ISO-8601 UTC. */
  fetched_at: string;
}

/**
 * Result of one transform — the validated snapshot plus any teammate display
 * names that couldn't be resolved through `roster.get` (Option B per flow §6 Q7).
 */
export interface PikalyticsTransformResult {
  snapshot: PikalyticsSnapshot;
  unknown_teammate_names: string[];
}

/**
 * Transform raw pikalytics markdown into a validated {@link PikalyticsSnapshot}.
 *
 * **When to use it:** the only translation layer between the upstream markdown
 * shape and our domain. Orchestrates parse → tera-strip → roster-id resolution
 * → schema validation.
 *
 * @param input — Roster id, raw markdown, both URLs, fetch timestamp.
 * @param deps — DB + roster repo (used for teammate name → roster id).
 * @returns A {@link PikalyticsTransformResult} (snapshot + unresolved-teammate names).
 * @throws {PikalyticsParseError} On parser failure (missing required sections).
 * @throws {PikalyticsTeraLeakError} On any `tera_*`-shaped key surfacing.
 */
export function transformPikalyticsMarkdown(
  _input: PikalyticsTransformInput,
  _deps: PikalyticsTransformDeps,
): PikalyticsTransformResult {
  void _input;
  void _deps;
  throw new Error("not implemented (Stage 5): transformPikalyticsMarkdown");
}
