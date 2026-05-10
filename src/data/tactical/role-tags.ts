/**
 * Stage 4 scaffold for the deterministic role classifier (plan §3.1).
 *
 * Stage 5 implements the rule table; today this stub returns `untagged`
 * for every input so the import surface compiles. The R-series tests in
 * `tests/data/tactical/role-tags.test.ts` + `role-tags.golden.test.ts`
 * fail at the assertion layer, not the import layer.
 */

import type { RoleTagAssignment, RoleTag } from "../../schemas/tactical";

/** Per-set inputs for {@link deriveRoleTags}. */
export interface RoleTagInput {
  species_id: string;
  item: string | null;
  ability: string | null;
  moves: readonly string[];
  base_stats: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
}

/** Injection slots — currently just a logger for the Stage-5 error path. */
export interface DeriveRoleTagsDeps {
  logWarn: (message: string) => void;
}

/**
 * Classify one set into a {@link RoleTagAssignment}.
 *
 * **When to use it:** team-level role classification (Stage A pipeline)
 * calls this once per saved set; the support pillar + pair scorer +
 * synergy extension all read from the resulting map.
 *
 * @param _input - Per-set features.
 * @param _deps - Logger injection.
 * @returns Assignment with `primary` + `all` (sorted by priority).
 * @throws Never.
 */
export function deriveRoleTags(
  _input: RoleTagInput,
  _deps: DeriveRoleTagsDeps,
): RoleTagAssignment {
  const untagged: RoleTag = "untagged";
  return { primary: untagged, all: [untagged] };
}
