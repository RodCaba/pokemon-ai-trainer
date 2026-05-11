/**
 * Stage D (per-mon-state-tracking) — per-phase per-mon state resolver.
 *
 * Stage 4 stub: exports the function symbol so red tests fail at the
 * assertion layer, not the import layer. Stage 5 ships the real
 * implementation per `docs/plans/per-mon-state-tracking.md` §3 + §7.
 */

import type {
  RoleTagAssignment,
  ScenarioSkeleton,
} from "../../schemas/tactical";
import type { UserTeam } from "../../schemas/user-teams";
import type { PlanCandidate } from "./recommend-plan";
import type { OpposingSetters } from "./opposing-setter";
import type { TurnFieldStates } from "./derive-turn-fields";
import type { Db } from "../../db/open";
import type { ScoringPanel } from "./scoring-team";

/** Per-actor state snapshot for one phase. Stage 5 fills in the real shape. */
export interface MonState {
  species_id: string;
  hp_pct: number;
  boosts: {
    atk: number;
    def: number;
    spa: number;
    spd: number;
    spe: number;
    acc: number;
    eva: number;
  };
  status: "none" | "burn" | "paralysis" | "sleep" | "poison" | "toxic";
  choice_locked_move: string | null;
}

export interface PhaseState {
  ours: MonState[];
  theirs: MonState[];
  fallen_allies_ours: number;
  fallen_allies_theirs: number;
}

export interface TurnStates {
  lead: PhaseState;
  mid: PhaseState;
  late: PhaseState;
}

export interface DeriveTurnStatesInput {
  team: UserTeam;
  scenario: ScenarioSkeleton;
  candidate: PlanCandidate;
  roleAssignments: ReadonlyMap<string, RoleTagAssignment>;
  opposingSetters: OpposingSetters;
  fields: TurnFieldStates;
  leadIncomingDamagePct: { ours: [number, number]; theirs: [number, number] };
  midIncomingDamagePct: { ours: [number, number] };
  scoring_panel?: ScoringPanel;
  db?: Db;
}

/**
 * Stage 5 will resolve fallen-ally counts, HP propagation, Stamina/Defiant
 * boost accumulation, choice-lock pick, and the status whitelist.
 * Stage 4 stub: throws so red tests assert on absence of behavior.
 */
export function deriveTurnStates(_input: DeriveTurnStatesInput): TurnStates {
  throw new Error("stage 5 not yet implemented");
}
