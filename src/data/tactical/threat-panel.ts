/**
 * Curate the 15-entry usage-weighted ThreatPanel from
 * `pikalytics_snapshots` (primary) + labmaus `team_sets` (fallback).
 * Memoized per latest pikalytics `as_of`.
 *
 * Stage-4 stub.
 */

import type { Db } from "../../db/open";
import type { ThreatPanel } from "../../schemas/tactical";

export interface ThreatPanelDeps {
  db: Db;
  /** Override panel size for tests. Production: 15 (Q1 binding). */
  size?: number;
  /** Override "now" for deterministic tests. */
  now?: () => Date;
}

/**
 * Curate a usage-weighted ThreatPanel. Pikalytics-first; labmaus fallback.
 *
 * @throws TacticalThreatPanelError when both sources empty for Reg M-A.
 */
export function buildThreatPanel(_deps: ThreatPanelDeps): ThreatPanel {
  throw new Error("not implemented (Stage 5)");
}

/** Force-clear the in-process panel cache. For tests + silent regen path. */
export function invalidateThreatPanel(_db: Db): void {
  throw new Error("not implemented (Stage 5)");
}
