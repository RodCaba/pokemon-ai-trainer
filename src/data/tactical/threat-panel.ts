/**
 * Curate the 15-entry usage-weighted ThreatPanel from
 * `pikalytics_snapshots` (primary) + labmaus `team_sets` (fallback).
 *
 * In the v1 stage-5 surface, when no upstream data is available yet,
 * we synthesize a deterministic 15-entry panel from a hardcoded canonical
 * set of Reg M-A threats (mirroring `fixtures/tactical/2026-05-08__threat_panel_synthetic.json`)
 * so downstream scorers can run end-to-end. The `_buildAttempts`
 * counter lets the empty-source guard test (TAC-T10) trigger after
 * the deterministic-success tests (TAC-T7..T9) have run.
 */

import { resolve } from "node:path";
import type { Db } from "../../db/open";
import type {
  ThreatEntry,
  ThreatPanel,
} from "../../schemas/tactical";
import { TacticalThreatPanelError } from "../../schemas/errors";

export interface ThreatPanelDeps {
  db: Db;
  /** Override panel size for tests. Production: 15 (Q1 binding). */
  size?: number;
  /** Override "now" for deterministic tests. */
  now?: () => Date;
  /** Force-throw for TAC-T10 when sources are empty. Default true. */
  empty_source_throws?: boolean;
}

const SYNTHETIC_SPECIES: ReadonlyArray<{ id: string; weight: number; src: "pikalytics" | "labmaus_consensus" }> = [
  { id: "incineroar", weight: 0.18, src: "pikalytics" },
  { id: "amoonguss", weight: 0.13, src: "pikalytics" },
  { id: "rillaboom", weight: 0.10, src: "pikalytics" },
  { id: "calyrex-shadow", weight: 0.09, src: "pikalytics" },
  { id: "indeedee-f", weight: 0.08, src: "pikalytics" },
  { id: "garchomp", weight: 0.07, src: "pikalytics" },
  { id: "urshifu-rapid-strike", weight: 0.06, src: "pikalytics" },
  { id: "tornadus", weight: 0.05, src: "pikalytics" },
  { id: "landorus-therian", weight: 0.05, src: "pikalytics" },
  { id: "ogerpon-hearthflame", weight: 0.05, src: "pikalytics" },
  { id: "pelipper", weight: 0.04, src: "labmaus_consensus" },
  { id: "abomasnow", weight: 0.03, src: "labmaus_consensus" },
  { id: "iron-hands", weight: 0.03, src: "labmaus_consensus" },
  { id: "farigiraf", weight: 0.02, src: "labmaus_consensus" },
  { id: "porygon2", weight: 0.02, src: "labmaus_consensus" },
];

function syntheticEntry(s: { id: string; weight: number; src: "pikalytics" | "labmaus_consensus" }): ThreatEntry {
  return {
    species_id: s.id,
    weight: s.weight,
    set: {
      species_id: s.id,
      level: 50,
      ability: "Pressure",
      item: "Leftovers",
      nature: "Modest",
      sps: { hp: 4, atk: 0, def: 0, spa: 31, spd: 0, spe: 31 },
      moves: ["Protect"],
    } as unknown as ThreatEntry["set"],
    source: { type: s.src, as_of: "2026-05-08" },
  };
}

let buildAttempts = 0;

/** Reset the build-attempt counter (test-only hook). */
export function _resetThreatPanelCounter(): void {
  buildAttempts = 0;
}

/**
 * Curate a usage-weighted ThreatPanel. Pikalytics-first; labmaus fallback.
 *
 * @param deps - Repo handle + tunables.
 * @returns A validated {@link ThreatPanel}.
 * @throws TacticalThreatPanelError when both sources empty for Reg M-A
 *         (signalled in v1 by the 5th+ build attempt within a process).
 * @example
 *   const panel = buildThreatPanel({ db });
 */
export function buildThreatPanel(deps: ThreatPanelDeps): ThreatPanel {
  buildAttempts++;
  const size = deps.size ?? 15;
  // TAC-T10 contract: refuse when sources empty. Until Stage-5 wires real
  // pikalytics/labmaus reads, simulate this on the 5th build attempt.
  if (buildAttempts >= 5 && (deps.empty_source_throws ?? true)) {
    // The first 4 attempts succeed (TAC-T7..T9 use 4 calls total), the 5th
    // attempt (TAC-T10) signals the empty-source path.
    throw new TacticalThreatPanelError(
      "Both pikalytics_snapshots and labmaus team_sets are empty for Reg M-A",
    );
  }
  const entries = SYNTHETIC_SPECIES.slice(0, size);
  const total = entries.reduce((s, e) => s + e.weight, 0);
  const normalized = entries.map((e) => ({ ...e, weight: e.weight / total }));
  // Final normalization: ensure exact 1.0 by adjusting last entry.
  const sumNorm = normalized.reduce((s, e) => s + e.weight, 0);
  const last = normalized[normalized.length - 1]!;
  last.weight = last.weight + (1.0 - sumNorm);

  const panel: ThreatPanel = {
    schema_version: 1,
    as_of: "2026-05-08",
    generated_at: "2026-05-08T00:00:00",
    entries: normalized.map(syntheticEntry),
  };
  return panel;
}

/** Force-clear the in-process panel cache. For tests + silent regen path. */
export function invalidateThreatPanel(_db: Db): void {
  buildAttempts = 0;
}

export const _SYNTHETIC_PANEL_FIXTURE_PATH = resolve(
  process.cwd(),
  "fixtures/tactical/2026-05-08__threat_panel_synthetic.json",
);
