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

/** Species types known to be immune to sand chip damage (Reg-M-A roster).
 *  Reg-M-A is small enough that this list is curated; a full species-type
 *  lookup would pull the DB into this pure helper. */
const SAND_IMMUNE_TYPE_SPECIES = new Set<string>([
  // Rock
  "tyranitar", "aerodactyl", "garganacl", "glimmora", "stonjourner",
  "archaludon", "diancie", "tyrunt", "tyrantrum",
  // Ground
  "garchomp", "landorus", "landorustherian", "excadrill", "donphan",
  "hippowdon", "krookodile", "rhyperior", "mamoswine", "ironboulder",
  "great-tusk", "greattusk", "ironcrown", "clodsire",
  // Steel
  "metagross", "magnezone", "scizor", "lucario", "ferrothorn",
  "kingambit", "corviknight", "ironhands", "ironbundle",
  "ironvaliant", "ironmoth", "ironjugulis", "ironthorns",
  "ironleaves", "registeel", "heatran", "gholdengo", "ironboulder",
  "ironcrown",
  // Common Reg-M-A Steel-types
  "tinkaton", "skarmory", "scizor", "empoleon",
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
 *   - Rock / Ground / Steel types (curated set for Reg-M-A roster).
 *   - Abilities: Magic Guard, Overcoat, Sand Force, Sand Rush, Sand Veil.
 *
 * @param species_id - Canonical lowercase roster id.
 * @param ability - Resolved ability id (lowercase canonical or display).
 *   May be `null` when the saved set didn't fill it in.
 * @returns `true` when the actor doesn't take sand chip.
 * @throws Never.
 */
export function isSandImmune(species_id: string, ability: string | null): boolean {
  const s = (species_id ?? "").toLowerCase();
  if (SAND_IMMUNE_TYPE_SPECIES.has(s)) return true;
  if (ability !== null) {
    const a = ability.toLowerCase();
    if (SAND_IMMUNE_ABILITIES.has(a)) return true;
  }
  return false;
}

/**
 * Q5-revised DB-confirmed move lookup: does the opposing species'
 * panel-resolved set actually carry the named move?
 *
 * **When to use it:** the status whitelist (Spore / Will-O-Wisp /
 * Thunder Wave) inside `deriveTurnStates` checks this before emitting a
 * status — false positives are conservative misses we accept in v1.
 *
 * @param opposingSpeciesId - Canonical lowercase roster id of an
 *   opposing-preview species.
 * @param moveId - Canonical lowercase move id (e.g. `"willowisp"`).
 * @param panel - The optional `ScoringPanel` threaded through; when
 *   undefined or its entries don't reference the species, returns
 *   `false` (conservative).
 * @returns `true` when at least one panel entry for the species has
 *   `moveId` in its `.moves` list. Case-insensitive match on both
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
      spec?: { moves?: ReadonlyArray<string> };
      set?: { moves?: ReadonlyArray<string> };
    };
    const species = canonId(e.species_roster_id ?? "");
    if (species !== targetSpecies) continue;
    const moves: ReadonlyArray<string> | undefined = e.spec?.moves ?? e.set?.moves;
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
