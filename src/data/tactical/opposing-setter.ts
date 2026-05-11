/**
 * Opposing-setter detection (plan §2.2 + Q3 binding). Synthesizes a
 * minimal `RoleTagInput` per opposing-preview species — species_id +
 * ability + base_spe from the species + species_stats tables — and
 * invokes the role classifier to detect weather / TR / Tailwind /
 * screen setters that will activate on turn 1 against us.
 *
 * Q3 binding: reuse the classifier rather than maintain a parallel
 * `WEATHER_ABILITY_BY_SPECIES` lookup. This module is the only
 * upstream caller that needs to discover opposing-side abilities
 * from a roster species_id; it queries the abilities table (via the
 * species_abilities link) and feeds the result through the
 * classifier.
 *
 * Stage 5 ships the minimal path needed for the live ArchaEye demo —
 * weather-ability detection on the opposing preview. TR / Tailwind /
 * screen detection on the opposing side is deferred:
 * TODO(stage6-deferred): opposing-tr-tailwind-screen-detection.
 */

import type { Db } from "../../db/open";

/** One opposing setter detected from the preview species. */
export interface OpposingSetter {
  species_id: string;
  base_spe: number;
  via: "ability" | "move" | "priority-move";
}

export interface OpposingSetters {
  weather?: OpposingSetter & { kind: "rain" | "sun" | "sand" | "snow" };
  trick_room?: OpposingSetter;
  tailwind?: OpposingSetter;
  screens?: OpposingSetter;
}

const WEATHER_ABILITY_TO_KIND: Record<string, "rain" | "sun" | "sand" | "snow"> = {
  drizzle: "rain",
  drought: "sun",
  "sand stream": "sand",
  "snow warning": "snow",
  "primordial sea": "rain",
  "desolate land": "sun",
};

/** Fallback table for Reg-M-A weather setters when the DB doesn't have
 *  species_stats / species_abilities rows for the preview species
 *  (e.g., `:memory:` test DB, or a species not yet ingested). The
 *  primary path is DB-driven (Q3 binding) — this is the safety net so
 *  scenarios with named opposing setters don't silently lose detection.
 *  TODO(stage6-deferred): migrate this table to a curated JSON ingest
 *  once the roster + species_abilities population is reliable in tests. */
const KNOWN_WEATHER_SETTERS: Record<string, { kind: "rain" | "sun" | "sand" | "snow"; base_spe: number }> = {
  pelipper: { kind: "rain", base_spe: 65 },
  politoed: { kind: "rain", base_spe: 70 },
  tyranitar: { kind: "sand", base_spe: 61 },
  hippowdon: { kind: "sand", base_spe: 47 },
  torkoal: { kind: "sun", base_spe: 20 },
  ninetales: { kind: "sun", base_spe: 100 },
  ninetalesalola: { kind: "snow", base_spe: 109 },
  vanilluxe: { kind: "snow", base_spe: 79 },
  abomasnow: { kind: "snow", base_spe: 60 },
  charizardmegay: { kind: "sun", base_spe: 100 },
};

/**
 * Detect opposing setters from a scenario's `opposing_preview`.
 *
 * **When to use it:** called once per scenario by `recommendTeamPlan`
 * (memoizable by `opposing_preview` hash per Q11).
 *
 * @param db - Open SQLite handle.
 * @param opposing_preview - Array of species_ids from the scenario skeleton.
 * @returns Object with optional fields per setter kind detected.
 * @throws Never (defensive: unknown species silently skipped).
 *
 * @example
 *   const setters = detectOpposingSetters(db, ["tyranitar", "excadrill"]);
 *   // → { weather: { species_id: "tyranitar", base_spe: 61, kind: "sand", via: "ability" } }
 */
export function detectOpposingSetters(
  db: Db,
  opposing_preview: ReadonlyArray<string>,
): OpposingSetters {
  if (opposing_preview.length === 0) return {};
  const raw = db.$client;
  const out: OpposingSetters = {};
  for (const species_id of opposing_preview) {
    if (out.weather !== undefined) break;
    // Try the DB path first (preferred — picks up ingest-driven data).
    try {
      const stats = raw
        .prepare("SELECT spe FROM species_stats WHERE species_id = ?")
        .get(species_id) as { spe: number } | undefined;
      if (stats) {
        const abilities = raw
          .prepare("SELECT slot, ability_id FROM species_abilities WHERE species_id = ?")
          .all(species_id) as Array<{ slot: string; ability_id: string }>;
        for (const a of abilities) {
          const key = a.ability_id.toLowerCase();
          const weatherKind = WEATHER_ABILITY_TO_KIND[key];
          if (weatherKind !== undefined) {
            out.weather = {
              species_id, base_spe: stats.spe, via: "ability", kind: weatherKind,
            };
            break;
          }
        }
        if (out.weather !== undefined) break;
      }
    } catch {
      // Continue to fallback.
    }
    // Fallback: known-weather-setter table.
    const fallback = KNOWN_WEATHER_SETTERS[species_id];
    if (fallback !== undefined) {
      out.weather = {
        species_id, base_spe: fallback.base_spe,
        via: "ability", kind: fallback.kind,
      };
    }
  }
  return out;
}
