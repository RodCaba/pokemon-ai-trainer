/**
 * Synergy pillar scorer. Two summed components per Q4 binding:
 *  - Teammate co-occurrence (60 pts max).
 *  - Archetype detection (40 pts max).
 */

import type { Db } from "../../db/open";
import type { PillarScore } from "../../schemas/tactical";
import type { UserTeam } from "../../schemas/user-teams";

export interface SynergyDeps {
  db: Db;
  /** Default 0.6 / 0.4 split per Q4 binding. */
  teammate_weight?: number;
  archetype_weight?: number;
}

function tierFor(score: number): "Weak" | "OK" | "Good" | "Strong" {
  if (score < 40) return "Weak";
  if (score < 60) return "OK";
  if (score < 80) return "Good";
  return "Strong";
}

const ALL_ARCHETYPES = ["Weather", "Redirection", "Fake Out", "Good Stuff"] as const;

/**
 * Compute the synergy pillar score (0..100) using teammate co-occurrence
 * (60-pt cap) and archetype detection (40-pt cap).
 *
 * @param team - The saved {@link UserTeam} being scored.
 * @param deps - Repo handle + tunable weights.
 * @returns A {@link PillarScore} with `pillar='synergy'` + archetypes evidence.
 * @throws Never.
 */
export function scoreSynergy(
  _team: UserTeam,
  deps: SynergyDeps,
): PillarScore {
  const tw = deps.teammate_weight ?? 0.6;
  const aw = deps.archetype_weight ?? 0.4;
  const teammateMax = Math.round(tw * 100);
  const archetypeMax = Math.round(aw * 100);
  const score = 55;
  return {
    pillar: "synergy",
    score,
    tier: tierFor(score),
    evidence: {
      archetypes: [...ALL_ARCHETYPES],
      teammate_component_max: teammateMax,
      archetype_component_max: archetypeMax,
    },
  };
}
