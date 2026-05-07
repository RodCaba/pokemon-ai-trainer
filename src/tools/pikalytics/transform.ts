/**
 * Transform raw pikalytics markdown into a validated {@link PikalyticsSnapshot}.
 *
 * Orchestrates: `parsePikalyticsMarkdown` → tera-strip property check →
 * roster-id resolution for teammates → schema validate. Builds the `id`
 * (`pikalytics:<format-slug>:<species_roster_id>:<as_of>`) and the `source`
 * block (both URLs + `fetched_at`).
 */

import type { Db } from "../../db/open";
import type { PikalyticsSnapshot } from "../../schemas/pikalytics";
import { PikalyticsSnapshotSchema } from "../../schemas/pikalytics";
import {
  PikalyticsParseError,
  PikalyticsTeraLeakError,
} from "../../schemas/errors";
import { parsePikalyticsMarkdown, type RawSnapshot } from "./parse-markdown";

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

const FORMAT_SLUG = "gen9championsvgc2026regma";

/**
 * Recursively scan an arbitrary value for any object key matching /tera/i.
 * Programmer-bug guard — returns the offending key path if found, else null.
 */
function findTeraKey(value: unknown, path: string[] = []): string[] | null {
  if (value === null || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = findTeraKey(value[i], [...path, String(i)]);
      if (hit) return hit;
    }
    return null;
  }
  for (const [k, v] of Object.entries(value)) {
    if (/tera/i.test(k)) return [...path, k];
    const hit = findTeraKey(v, [...path, k]);
    if (hit) return hit;
  }
  return null;
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
  input: PikalyticsTransformInput,
  deps: PikalyticsTransformDeps,
): PikalyticsTransformResult {
  const parsed: RawSnapshot = parsePikalyticsMarkdown(input.raw_markdown);

  // Defense-in-depth: if the parser ever forwards a `tera_*` key into the
  // intermediate struct, fail loud (programmer bug). The parser today does
  // NOT emit such keys, so this is a future-regression guard.
  const parsedHit = findTeraKey(parsed);
  if (parsedHit) {
    throw new PikalyticsTeraLeakError(
      `tera-shaped key surfaced in parsed pikalytics struct: ${parsedHit.join(".")}`,
      { species_roster_id: input.species_roster_id },
    );
  }

  // Resolve teammate display names → canonical roster ids. Unresolved names
  // are dropped from `teammates` and accumulated in `unknown_teammate_names`.
  const teammates: Array<{ roster_id: string; percent: number }> = [];
  const unknown_teammate_names: string[] = [];
  for (const t of parsed.teammates) {
    const hit = deps.rosterRepo.get(deps.db, t.display_name, "RegM-A");
    if (hit) {
      teammates.push({ roster_id: hit.id, percent: t.percent });
    } else {
      unknown_teammate_names.push(t.display_name);
    }
  }

  const snapshot: PikalyticsSnapshot = PikalyticsSnapshotSchema.parse({
    schema_version: 1,
    id: `pikalytics:${FORMAT_SLUG}:${input.species_roster_id}:${parsed.as_of}`,
    format: "RegM-A",
    format_slug: FORMAT_SLUG,
    species_roster_id: input.species_roster_id,
    as_of: parsed.as_of,
    usage_percent: parsed.usage_percent,
    teammates,
    items: parsed.items,
    abilities: parsed.abilities,
    moves: parsed.moves,
    sample_size: null,
    source: {
      site: "pikalytics",
      source_url: input.source_url,
      ai_url: input.ai_url,
      fetched_at: input.fetched_at,
    },
  });

  // Final defense-in-depth: walk the assembled snapshot for any tera-shaped
  // key. Schema is `.strict()` and has no tera_* fields, so this should never
  // trip; the explicit walk catches future regressions where the schema gains
  // an `additionalProperties: true` field.
  const finalHit = findTeraKey(snapshot);
  if (finalHit) {
    throw new PikalyticsTeraLeakError(
      `tera-shaped key surfaced in assembled pikalytics snapshot: ${finalHit.join(".")}`,
      { species_roster_id: input.species_roster_id },
    );
  }

  return { snapshot, unknown_teammate_names };
}

// Re-export for callers that want type guards on parse failure without
// reaching into ../../schemas/errors directly.
export { PikalyticsParseError };
