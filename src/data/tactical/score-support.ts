/**
 * Stage 4 scaffold for the support pillar scorer (plan §3.2 + §5).
 *
 * Stage 5 ships the per-mechanism distinct-tag formula + role coherence
 * bonus + tier mapping. Today this stub emits a Weak/0 score so the
 * pillars bundle compiles. SU-series tests fail at assertion, not import.
 */

import type { PillarScore, RoleTagAssignment } from "../../schemas/tactical";

/**
 * Compute the support pillar score from a precomputed role-assignments map.
 *
 * **When to use it:** call once per overview from `pillars.ts` after
 * `deriveRoleTags` runs across the saved team.
 *
 * @param _roleAssignments - species_id → assignment map.
 * @returns A 0–100 {@link PillarScore} with mechanism + coherence evidence.
 * @throws Never.
 */
export function scoreSupport(
  _roleAssignments: Map<string, RoleTagAssignment>,
): PillarScore {
  return {
    pillar: "support",
    score: 0,
    tier: "Weak",
    evidence: {
      role_tags: {},
      mechanisms: {
        screens: [],
        weather_setters: [],
        speed_control: [],
        redirection: [],
        healers: [],
        disruption: [],
        pivots: [],
        anti_priority: [],
      },
      role_coherence: false,
      coherence_chain: null,
    },
  };
}
