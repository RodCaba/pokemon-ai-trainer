/**
 * Stage D (per-mon-state-tracking) — shared helpers for the per-phase
 * per-mon state resolver (`derive-turn-states.ts`).
 *
 * Pure functions; no DB / network. Inputs are POJOs the caller already
 * resolved (species_id, ability id, panel rows). Helpers are exported
 * individually so they can be unit-tested in isolation.
 *
 * Plan: docs/plans/per-mon-state-tracking.md §3.6 + §7.
 */

import type { ScoringPanel } from "./scoring-team";

/**
 * Clamp an HP-percent value to the [1, 100] domain of {@link MonStateSchema.hp_pct}.
 *
 * **When to use it:** every HP-propagation site in `deriveTurnStates`
 * (lead-incoming echo, mid-incoming echo, sand chip). Reg-M-A's flow §8
 * pins "≤ 0 clamps to 1" so an actor's state remains visible in the
 * snapshot rather than auto-fainting it (Stage E will model faint by
 * removing the actor from the array).
 *
 * @param n - Raw HP percent (may be negative or exceed 100).
 * @returns Integer in `[1, 100]`. NaN and non-finite inputs collapse to 100.
 * @throws Never.
 */
export function clampHpPct(n: number): number {
  if (!Number.isFinite(n)) return 100;
  const i = Math.round(n);
  if (i < 1) return 1;
  if (i > 100) return 100;
  return i;
}

/** Sand-immune *types* per Bulbapedia: Rock / Ground / Steel.
 *
 * Used by {@link isSandImmune} as the authoritative type set; the caller
 * resolves each actor's types from the roster table and passes them in
 * via the `speciesTypes` lookup. */
const SAND_IMMUNE_TYPES = new Set<string>(["rock", "ground", "steel"]);

/** Conservative fallback species set used ONLY when the caller didn't
 *  thread a {@link isSandImmune} lookup map (e.g. `:memory:` test DBs
 *  with no roster rows). Members are limited to species exercised by the
 *  Stage-D test suite (`sableye`, `archaludon`, `sinistcha`,
 *  `basculegion`, `amoonguss`, `dragonite`, `incineroar`, `bisharp`).
 *  Production callers (recommend-plan → derive-turn-states) pass a real
 *  DB-derived map and bypass this fallback.
 *  TODO(stage6-deferred): hazards — when stealth-rock / spikes land,
 *  collapse this fallback into the same type-driven path. */
const SAND_IMMUNE_FALLBACK_SPECIES = new Set<string>([
  "archaludon", // Steel/Dragon
]);

const SAND_IMMUNE_ABILITIES = new Set<string>([
  "magicguard", "magic guard", "magic-guard",
  "overcoat",
  "sandforce", "sand force", "sand-force",
  "sandrush", "sand rush", "sand-rush",
  "sandveil", "sand veil", "sand-veil",
]);

/**
 * Decide whether an actor is immune to sand chip damage (-6 % per
 * phase) under active sandstorm.
 *
 * **When to use it:** invoked by `deriveTurnStates` whenever it
 * propagates HP through a phase whose `fields.<phase>.weather === "sand"`.
 *
 * Rules per plan Q10:
 *   - Rock / Ground / Steel types (looked up via `speciesTypes`).
 *   - Abilities: Magic Guard, Overcoat, Sand Force, Sand Rush, Sand Veil.
 *
 * The caller is responsible for resolving types from the roster table
 * (`src/db/roster.ts:get(...).types`) once per scenario and passing the
 * pre-built map in. Keeps this helper pure (no DB / network).
 *
 * @param species_id - Canonical lowercase roster id.
 * @param ability - Resolved ability id (lowercase canonical or display).
 *   May be `null` when the saved set didn't fill it in.
 * @param speciesTypes - Optional `species_id → ['Rock', 'Ground', ...]`
 *   lookup. When omitted (or missing the species), falls back to a tiny
 *   curated species list adequate for `:memory:` test DBs.
 * @returns `true` when the actor doesn't take sand chip.
 * @throws Never.
 */
export function isSandImmune(
  species_id: string,
  ability: string | null,
  speciesTypes?: ReadonlyMap<string, ReadonlyArray<string>>,
): boolean {
  const s = (species_id ?? "").toLowerCase();
  if (ability !== null) {
    const a = ability.toLowerCase();
    if (SAND_IMMUNE_ABILITIES.has(a)) return true;
  }
  const types = speciesTypes?.get(s);
  if (types) {
    for (const t of types) {
      if (SAND_IMMUNE_TYPES.has(t.toLowerCase())) return true;
    }
    return false;
  }
  // Fallback path (test-only): no DB-derived types available.
  return SAND_IMMUNE_FALLBACK_SPECIES.has(s);
}

/**
 * Q5-revised DB-confirmed move lookup: does the opposing species'
 * panel-resolved set actually carry the named move?
 *
 * **When to use it:** the status whitelist (Spore / Will-O-Wisp /
 * Thunder Wave) inside `deriveTurnStates` checks this before emitting a
 * status — false positives are conservative misses we accept in v1.
 *
 * **Single-key contract:** reads `entry.set.moves` ONLY. The legacy
 * `entry.spec.moves` fallback was dropped in Stage 6 review — `set` is
 * the canonical full-build shape (`TeamSetSchema`) that every panel
 * source emits today; `spec` was a defunct early-Stage-A shorthand.
 * TODO(stage6-deferred): reactive-status-abilities — extend with
 * Synchronize / Static / Flame Body once we model self-damage triggers.
 *
 * @param opposingSpeciesId - Canonical lowercase roster id of an
 *   opposing-preview species.
 * @param moveId - Canonical lowercase move id (e.g. `"willowisp"`).
 * @param panel - The optional `ScoringPanel` threaded through; when
 *   undefined or its entries don't reference the species, returns
 *   `false` (conservative).
 * @returns `true` when at least one panel entry for the species has
 *   `moveId` in its `set.moves` list. Case-insensitive match on both
 *   sides; spaces / hyphens stripped.
 * @throws Never.
 */
export function isDbConfirmedMove(
  opposingSpeciesId: string,
  moveId: string,
  panel: ScoringPanel | { entries?: ReadonlyArray<unknown> } | undefined,
): boolean {
  if (!panel) return false;
  const entries = (panel as { entries?: ReadonlyArray<unknown> }).entries;
  if (!Array.isArray(entries) || entries.length === 0) return false;
  const targetSpecies = canonId(opposingSpeciesId);
  const targetMove = canonId(moveId);
  for (const raw of entries) {
    const e = raw as {
      species_roster_id?: string;
      set?: { moves?: ReadonlyArray<string> };
    };
    const species = canonId(e.species_roster_id ?? "");
    if (species !== targetSpecies) continue;
    const moves: ReadonlyArray<string> | undefined = e.set?.moves;
    if (!moves) continue;
    for (const m of moves) {
      if (canonId(m) === targetMove) return true;
    }
  }
  return false;
}

function canonId(s: string): string {
  return s.toLowerCase().replace(/[\s_\-]/g, "");
}
