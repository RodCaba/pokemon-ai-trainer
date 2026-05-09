/**
 * Defense pillar scorer. Inverse of offense: each panel entry's best
 * move vs each of our slots; outcome = 1.0 if survive 2 hits, 0 if
 * OHKO'd, linear interp.
 *
 * Evidence: which slots are OHKO'd by which threats; weakest slot id.
 *
 * Stage-4 stub.
 */

import type { PillarScore, ThreatPanel } from "../../schemas/tactical";
import type { UserTeam } from "../../schemas/user-teams";
import type { CalcCache } from "./calc-cache";
import type { CalcDeps } from "./score-offense";

export function scoreDefense(
  _team: UserTeam,
  _panel: ThreatPanel,
  _calcCache: CalcCache,
  _deps: CalcDeps,
): PillarScore {
  throw new Error("not implemented (Stage 5)");
}
