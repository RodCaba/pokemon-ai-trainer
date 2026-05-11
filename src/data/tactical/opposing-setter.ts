/**
 * Stage 4 scaffold for opposing-setter detection (plan §2.2 + Q3 binding).
 *
 * Given a scenario's `opposing_preview` array of species ids, identify
 * which (if any) carry weather / TR / Tailwind / screen setters that
 * will activate on turn 1 against us. Stage 5 invokes the role
 * classifier on a synthesized RoleTagInput per species (Q3 binding
 * — reuse the classifier rather than maintain a parallel lookup).
 *
 * Stage 4 stub returns an empty `OpposingSetters` so consumers compile.
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

/**
 * Detect opposing setters from a scenario's `opposing_preview`.
 *
 * **When to use it:** called once per scenario by `recommendTeamPlan`
 * (memoizable on `opposing_preview` hash per Q11).
 *
 * @param _db - Open SQLite handle (the classifier needs species +
 *   ability lookups).
 * @param _opposing_preview - Array of species_ids from `ScenarioSkeleton`.
 * @returns Object with optional fields for each detected setter kind.
 * @throws Never (defensive: unknown species silently skipped).
 */
export function detectOpposingSetters(
  _db: Db,
  _opposing_preview: ReadonlyArray<string>,
): OpposingSetters {
  return {};
}
