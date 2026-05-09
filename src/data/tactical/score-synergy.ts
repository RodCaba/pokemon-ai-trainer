/**
 * Synergy pillar scorer. Two summed components per Q4 binding:
 *  - Teammate co-occurrence (60 pts): pikalytics teammate % per C(6,2)=15 pair.
 *  - Archetype detection (40 pts): hard-coded checks (Weather / Redirection /
 *    Fake Out / Trick Room / Good Stuff).
 *
 * Stage-4 stub.
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

export function scoreSynergy(
  _team: UserTeam,
  _deps: SynergyDeps,
): PillarScore {
  throw new Error("not implemented (Stage 5)");
}
