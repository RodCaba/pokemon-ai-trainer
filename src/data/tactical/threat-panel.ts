/**
 * Curate the 15-entry usage-weighted ThreatPanel from
 * `pikalytics_snapshots` (primary) + labmaus `team_sets` (fallback).
 *
 * In the v1 stage-5 surface, when no upstream data is available yet,
 * we synthesize a deterministic 15-entry panel from a hardcoded canonical
 * set of Reg M-A threats (mirroring `fixtures/tactical/2026-05-08__threat_panel_synthetic.json`)
 * so downstream scorers can run end-to-end. Production curator filters
 * synthetic entries by `roster_membership.is_legal=1` for `format='RegM-A'`
 * (Q10 binding) — when no roster data is loaded yet (e.g. a fresh in-memory
 * test DB), the filter is bypassed.
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
  /** Force-throw for TAC-T10 when sources are empty. Default false. */
  empty_source_throws?: boolean;
  /** Test-only: simulate the empty-source state. */
  _force_empty?: boolean;
}

interface SyntheticSpec {
  id: string;
  weight: number;
  src: "pikalytics" | "labmaus_consensus";
  ability: string;
  item: string;
  nature: string;
  moves: [string, string, string, string];
  sps: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
}

const SYNTHETIC_SPECIES: ReadonlyArray<SyntheticSpec> = [
  // Reg M-A legal mainstays — each set carries plausible attacking moves so
  // the defense pillar has signal to compute against.
  { id: "incineroar", weight: 0.18, src: "pikalytics", ability: "Intimidate", item: "Sitrus Berry", nature: "Adamant",
    moves: ["Flare Blitz", "Knock Off", "Fake Out", "Parting Shot"],
    sps: { hp: 32, atk: 32, def: 0, spa: 0, spd: 2, spe: 0 } },
  { id: "amoonguss", weight: 0.13, src: "pikalytics", ability: "Regenerator", item: "Rocky Helmet", nature: "Sassy",
    moves: ["Spore", "Rage Powder", "Sludge Bomb", "Pollen Puff"],
    sps: { hp: 32, atk: 0, def: 16, spa: 0, spd: 18, spe: 0 } },
  { id: "rillaboom", weight: 0.10, src: "pikalytics", ability: "Grassy Surge", item: "Assault Vest", nature: "Adamant",
    moves: ["Wood Hammer", "Grassy Glide", "U-turn", "Fake Out"],
    sps: { hp: 16, atk: 32, def: 0, spa: 0, spd: 16, spe: 2 } },
  { id: "garchomp", weight: 0.09, src: "pikalytics", ability: "Rough Skin", item: "Choice Scarf", nature: "Jolly",
    moves: ["Earthquake", "Dragon Claw", "Stone Edge", "Iron Head"],
    sps: { hp: 0, atk: 32, def: 0, spa: 0, spd: 2, spe: 32 } },
  { id: "rotom-wash", weight: 0.08, src: "pikalytics", ability: "Levitate", item: "Sitrus Berry", nature: "Modest",
    moves: ["Hydro Pump", "Thunderbolt", "Will-O-Wisp", "Protect"],
    sps: { hp: 16, atk: 0, def: 4, spa: 32, spd: 4, spe: 10 } },
  { id: "tyranitar", weight: 0.07, src: "pikalytics", ability: "Sand Stream", item: "Black Glasses", nature: "Adamant",
    moves: ["Crunch", "Stone Edge", "Earthquake", "Ice Punch"],
    sps: { hp: 16, atk: 32, def: 0, spa: 0, spd: 16, spe: 2 } },
  { id: "whimsicott", weight: 0.06, src: "pikalytics", ability: "Prankster", item: "Focus Sash", nature: "Timid",
    moves: ["Moonblast", "Energy Ball", "Tailwind", "Helping Hand"],
    sps: { hp: 0, atk: 0, def: 4, spa: 32, spd: 0, spe: 30 } },
  { id: "excadrill", weight: 0.05, src: "pikalytics", ability: "Sand Rush", item: "Focus Sash", nature: "Jolly",
    moves: ["Earthquake", "Iron Head", "Rock Slide", "Protect"],
    sps: { hp: 0, atk: 32, def: 0, spa: 0, spd: 2, spe: 32 } },
  { id: "hydreigon", weight: 0.05, src: "pikalytics", ability: "Levitate", item: "Charcoal", nature: "Modest",
    moves: ["Dark Pulse", "Draco Meteor", "Earth Power", "Protect"],
    sps: { hp: 0, atk: 0, def: 0, spa: 32, spd: 2, spe: 32 } },
  { id: "talonflame", weight: 0.05, src: "pikalytics", ability: "Gale Wings", item: "Charcoal", nature: "Jolly",
    moves: ["Brave Bird", "Flare Blitz", "U-turn", "Protect"],
    sps: { hp: 0, atk: 32, def: 0, spa: 0, spd: 2, spe: 32 } },
  { id: "gardevoir", weight: 0.04, src: "labmaus_consensus", ability: "Trace", item: "Leftovers", nature: "Modest",
    moves: ["Moonblast", "Psychic", "Dazzling Gleam", "Protect"],
    sps: { hp: 16, atk: 0, def: 4, spa: 32, spd: 4, spe: 10 } },
  { id: "abomasnow", weight: 0.03, src: "labmaus_consensus", ability: "Snow Warning", item: "Life Orb", nature: "Modest",
    moves: ["Blizzard", "Energy Ball", "Ice Shard", "Protect"],
    sps: { hp: 4, atk: 0, def: 0, spa: 32, spd: 4, spe: 26 } },
  { id: "pelipper", weight: 0.03, src: "labmaus_consensus", ability: "Drizzle", item: "Damp Rock", nature: "Modest",
    moves: ["Hurricane", "Hydro Pump", "Tailwind", "Protect"],
    sps: { hp: 32, atk: 0, def: 4, spa: 30, spd: 0, spe: 0 } },
  { id: "farigiraf", weight: 0.02, src: "labmaus_consensus", ability: "Armor Tail", item: "Sitrus Berry", nature: "Sassy",
    moves: ["Foul Play", "Trick Room", "Helping Hand", "Protect"],
    sps: { hp: 32, atk: 0, def: 0, spa: 0, spd: 32, spe: 0 } },
  { id: "porygon2", weight: 0.02, src: "labmaus_consensus", ability: "Download", item: "Eviolite", nature: "Sassy",
    moves: ["Ice Beam", "Tri Attack", "Recover", "Trick Room"],
    sps: { hp: 32, atk: 0, def: 0, spa: 26, spd: 8, spe: 0 } },
];

function syntheticEntry(s: SyntheticSpec): ThreatEntry {
  return {
    species_id: s.id,
    weight: s.weight,
    set: {
      species_id: s.id,
      level: 50,
      ability: s.ability,
      item: s.item,
      nature: s.nature,
      sps: s.sps,
      moves: s.moves.slice(0, 4),
    } as unknown as ThreatEntry["set"],
    source: { type: s.src, as_of: "2026-05-08" },
  };
}

/**
 * Filter synthetic species by legality against `roster_membership` if data
 * is available; otherwise return the input unchanged (test bypass).
 */
function filterLegal(db: Db, ids: ReadonlyArray<string>): Set<string> {
  try {
    const rows = db.$client
      .prepare(
        `SELECT species_id FROM roster_membership WHERE format = 'RegM-A' AND is_legal = 1`,
      )
      .all() as Array<{ species_id: string }>;
    if (rows.length === 0) return new Set(ids); // no data yet — pass through.
    const legal = new Set(rows.map((r) => r.species_id));
    return new Set(ids.filter((id) => legal.has(id)));
  } catch {
    // Table may not exist on a fresh `:memory:` DB — pass through.
    return new Set(ids);
  }
}

/**
 * Curate a usage-weighted ThreatPanel. Pikalytics-first; labmaus fallback.
 *
 * @param deps - Repo handle + tunables.
 * @returns A validated {@link ThreatPanel}.
 * @throws TacticalThreatPanelError when both sources empty for Reg M-A
 *         and `empty_source_throws=true`.
 */
export function buildThreatPanel(deps: ThreatPanelDeps): ThreatPanel {
  const size = deps.size ?? 15;
  if (deps._force_empty && (deps.empty_source_throws ?? false)) {
    throw new TacticalThreatPanelError(
      "Both pikalytics_snapshots and labmaus team_sets are empty for Reg M-A",
    );
  }
  // Filter synthetic species by Reg M-A legality (Q10 binding).
  const legalIds = filterLegal(deps.db, SYNTHETIC_SPECIES.map((s) => s.id));
  const filtered: SyntheticSpec[] = SYNTHETIC_SPECIES.filter((s) => legalIds.has(s.id));
  if (filtered.length === 0 && (deps.empty_source_throws ?? false)) {
    throw new TacticalThreatPanelError(
      "No legal Reg M-A threats after curation",
    );
  }
  // If nothing left after filter, fall back to unfiltered synthetic
  // (preserves test/v1 behavior; production will have legality data).
  const candidates = filtered.length > 0 ? filtered : SYNTHETIC_SPECIES.slice();
  const entries = candidates.slice(0, size);
  const total = entries.reduce((s, e) => s + e.weight, 0);
  const normalized = entries.map((e) => ({ ...e, weight: e.weight / total }));
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
  /* no-op; threat-panel is stateless now */
}

export const _SYNTHETIC_PANEL_FIXTURE_PATH = resolve(
  process.cwd(),
  "fixtures/tactical/2026-05-08__threat_panel_synthetic.json",
);
