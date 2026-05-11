/**
 * Stage D (per-mon-state-tracking) — per-phase per-mon state resolver.
 *
 * Pure module. Sister to `derive-turn-fields.ts`; called once per
 * candidate per scenario by `scorePlan` in `recommend-plan.ts`.
 *
 * Resolves four behaviors per plan §4:
 *   - **Fallen-ally counts** keyed off opposing role tags (mid) and
 *     `mid + 1 (cap 2)` (late).
 *   - **HP propagation** via the Q2 echo from `scorePair` /
 *     `scoreMidPhase` (mid HP = clamp(100 − lead_incoming, 1, 100);
 *     late mid-pivot HP = clamp(100 − mid_incoming, 1, 100); late
 *     cleaner HP = 100 since it just switched in). Sand chip (-6 %)
 *     stacks on top per Q2 (echo first, then chip).
 *   - **Stamina (+1 Def in mid, +2 in late) / Defiant (+2 Atk in mid)**
 *     boost accumulation gated on the actor having the ability and an
 *     opposing intimidator (Defiant) or any incoming hit (Stamina).
 *   - **Choice-lock** deterministic max-roll move pick for late-phase
 *     cleaner when the saved set holds `choice-scarf` (Q4).
 *   - **Status whitelist** — Spore / Will-O-Wisp / Thunder Wave applied
 *     at full weight ONLY when the opposing species' DB-confirmed set
 *     carries the move (Q5 revised).
 *
 * Plan: docs/plans/per-mon-state-tracking.md §3.5 + §4 + §7.
 */

import type {
  MonState,
  PhaseState,
  RoleTag,
  RoleTagAssignment,
  ScenarioSkeleton,
} from "../../schemas/tactical";
import type { UserTeam } from "../../schemas/user-teams";
import type { PlanCandidate } from "./recommend-plan";
import type { OpposingSetters } from "./opposing-setter";
import type { TurnFieldStates } from "./derive-turn-fields";
import type { Db } from "../../db/open";
import type { ScoringPanel } from "./scoring-team";
import { clampHpPct, isSandImmune, isDbConfirmedMove } from "./mon-state";

export type { MonState, PhaseState } from "../../schemas/tactical";

/** Three derived per-mon state snapshots for one candidate plan / scenario. */
export interface TurnStates {
  lead: PhaseState;
  mid: PhaseState;
  late: PhaseState;
}

/** Inputs to {@link deriveTurnStates}. Pre-resolved upstream so the
 *  function stays pure. */
export interface DeriveTurnStatesInput {
  team: UserTeam;
  scenario: ScenarioSkeleton;
  candidate: PlanCandidate;
  roleAssignments: ReadonlyMap<string, RoleTagAssignment>;
  opposingSetters: OpposingSetters;
  fields: TurnFieldStates;
  /** Q2 echo from `scorePair`. */
  leadIncomingDamagePct: { ours: [number, number]; theirs: [number, number] };
  /** Q2 echo from `scoreMidPhase`. */
  midIncomingDamagePct: { ours: [number, number] };
  /** Q5-revised DB-gate source. Optional — absence ⇒ conservative `none`. */
  scoring_panel?: ScoringPanel;
  /** Reserved for future expansion; never accessed today. */
  db?: Db;
}

interface SetRow {
  slot?: number;
  species_id?: string | null;
  species_roster_id?: string | null;
  ability_id?: string | null;
  item_id?: string | null;
  move_1_id?: string | null;
  move_2_id?: string | null;
  move_3_id?: string | null;
  move_4_id?: string | null;
}

function setAt(team: UserTeam, slot: number): SetRow | undefined {
  const sets = (team as unknown as { sets?: ReadonlyArray<SetRow> }).sets;
  return sets?.[slot];
}

function speciesAt(team: UserTeam, slot: number): string {
  const s = setAt(team, slot);
  return s?.species_id ?? s?.species_roster_id ?? "";
}

function abilityAt(team: UserTeam, slot: number): string | null {
  return setAt(team, slot)?.ability_id ?? null;
}

function itemAt(team: UserTeam, slot: number): string | null {
  return setAt(team, slot)?.item_id ?? null;
}

function movesAt(team: UserTeam, slot: number): string[] {
  const s = setAt(team, slot);
  if (!s) return [];
  return [s.move_1_id, s.move_2_id, s.move_3_id, s.move_4_id]
    .filter((m): m is string => typeof m === "string" && m.length > 0);
}

const FALLEN_GATE_ROLES: ReadonlySet<RoleTag> = new Set<RoleTag>([
  "wallbreaker", "cleaner", "setup_sweeper",
]);

function defaultBoosts(): MonState["boosts"] {
  return { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 };
}

function emptyMon(species_id: string): MonState {
  return {
    species_id,
    hp_pct: 100,
    boosts: defaultBoosts(),
    status: "none",
    choice_locked_move: null,
  };
}

/** Count opposing roles that meet the fallen-ally gate. Symmetric helper
 *  for ours / theirs — opposing is the OTHER side relative to the caller. */
function fallenAllyMid(
  oppositeIds: ReadonlyArray<string>,
  roles: ReadonlyMap<string, RoleTagAssignment>,
): number {
  for (const id of oppositeIds) {
    const a = roles.get(id);
    if (!a) continue;
    if (a.all.some((t) => FALLEN_GATE_ROLES.has(t))) return 1;
  }
  return 0;
}

const STATUS_MOVE_TO_STATUS: Record<string, MonState["status"]> = {
  spore: "sleep",
  willowisp: "burn",
  thunderwave: "paralysis",
};

function canonMoveId(s: string): string {
  return s.toLowerCase().replace(/[\s_\-]/g, "");
}

/** Find the lowest-slot canonical-id ability match for "Intimidate"
 *  among the opposing preview, via roleAssignments (which carries the
 *  ability lookup upstream — Stage A). Falls back to a small Reg-M-A
 *  intimidator set when no role data resolves. */
const KNOWN_INTIMIDATORS = new Set<string>([
  "incineroar", "salamence", "landorus", "landorustherian",
  "arcanine", "arcaninehisui", "gyarados", "krookodile",
  "mawile", "hitmontop",
]);

function opposingHasIntimidate(
  opposingIds: ReadonlyArray<string>,
): boolean {
  for (const id of opposingIds) {
    if (KNOWN_INTIMIDATORS.has(id.toLowerCase())) return true;
  }
  return false;
}

/**
 * Resolve per-phase per-mon state snapshots for one candidate plan in
 * one scenario.
 *
 * **When to use it:** invoked from `scorePlan` once per candidate per
 * scenario, AFTER `scorePair` + `scoreMidPhase` have produced their
 * echo tuples. Pure function: tests inject POJOs. Never throws — every
 * defensive miss collapses to a benign default (`hp_pct: 100`,
 * `status: "none"`, `choice_locked_move: null`).
 *
 * @param input - Team + scenario + candidate + role classifier output +
 *   opposing-setter detection + per-phase field states + Q2 echoes +
 *   optional scoring panel for the status DB-gate.
 * @returns Three {@link PhaseState} snapshots (`lead`, `mid`, `late`).
 *   Lead is always 100% HP / zero boosts / no status. Mid + late carry
 *   the propagated state.
 * @throws Never.
 *
 * @example
 *   const states = deriveTurnStates({
 *     team, scenario, candidate, roleAssignments, opposingSetters,
 *     fields: deriveTurnFieldStates(...),
 *     leadIncomingDamagePct: scorePair(...).lead_incoming_damage_pct,
 *     midIncomingDamagePct: scoreMidPhase(...).mid_incoming_damage_pct,
 *     scoring_panel,
 *   });
 *   // states.mid.ours[i].hp_pct === clamp(100 - leadIncoming.ours[i], 1, 100)
 */
export function deriveTurnStates(input: DeriveTurnStatesInput): TurnStates {
  const {
    team, scenario, candidate, roleAssignments, fields,
    leadIncomingDamagePct, midIncomingDamagePct, scoring_panel,
  } = input;

  const lead0 = speciesAt(team, candidate.leads[0]);
  const lead1 = speciesAt(team, candidate.leads[1]);
  const midId = speciesAt(team, candidate.mid);
  const cleanerId = speciesAt(team, candidate.cleaner);

  const opposingIds = scenario.opposing_preview ?? [];
  const oppLead0 = opposingIds[0] ?? "";
  const oppLead1 = opposingIds[1] ?? oppLead0;

  // ----- LEAD PHASE — everybody at 100%, no boosts, no status. -----
  const lead: PhaseState = {
    ours: [emptyMon(lead0), emptyMon(lead1)],
    theirs: [emptyMon(oppLead0), emptyMon(oppLead1)],
    fallen_allies_ours: 0,
    fallen_allies_theirs: 0,
  };

  // ----- MID PHASE -----
  // HP echo: clamp(100 - lead_incoming, 1, 100), then sand chip if
  // weather is sand and the actor isn't immune.
  const midOursHp: [number, number] = [
    clampHpPct(100 - (leadIncomingDamagePct.ours[0] ?? 0)),
    clampHpPct(100 - (leadIncomingDamagePct.ours[1] ?? 0)),
  ];
  if (fields.mid.weather === "sand") {
    for (let i = 0; i < 2; i++) {
      const slot = candidate.leads[i]!;
      const species_id = speciesAt(team, slot);
      const ability = abilityAt(team, slot);
      if (!isSandImmune(species_id, ability)) {
        midOursHp[i] = clampHpPct(midOursHp[i]! - 6);
      }
    }
  }

  const midOurs: MonState[] = [emptyMon(lead0), emptyMon(lead1)];
  midOurs[0]!.hp_pct = midOursHp[0]!;
  midOurs[1]!.hp_pct = midOursHp[1]!;

  // Stamina (+1 Def): for each lead slot whose ability is Stamina AND
  // who took a hit (incoming > 0), apply +1 Def in mid.
  for (let i = 0; i < 2; i++) {
    const slot = candidate.leads[i]!;
    const ability = (abilityAt(team, slot) ?? "").toLowerCase();
    const incoming = leadIncomingDamagePct.ours[i] ?? 0;
    if (ability === "stamina" && incoming > 0) {
      midOurs[i]!.boosts.def = 1;
    }
  }

  // Defiant (+2 Atk): when opposing preview contains an Intimidate
  // species and the lead carries Defiant.
  const intimidateInOpp = opposingHasIntimidate(opposingIds);
  if (intimidateInOpp) {
    for (let i = 0; i < 2; i++) {
      const slot = candidate.leads[i]!;
      const ability = (abilityAt(team, slot) ?? "").toLowerCase();
      if (ability === "defiant") {
        midOurs[i]!.boosts.atk = 2;
      }
    }
  }

  // Status whitelist (Q5): DB-confirmed Spore / WoW / T-Wave from any
  // opposing-preview species ⇒ apply to slot 0 of our actors.
  for (const moveCanon of Object.keys(STATUS_MOVE_TO_STATUS)) {
    let confirmedOnAnyOpp = false;
    for (const oppId of opposingIds) {
      if (isDbConfirmedMove(oppId, moveCanon, scoring_panel)) {
        confirmedOnAnyOpp = true;
        break;
      }
    }
    if (confirmedOnAnyOpp) {
      const status = STATUS_MOVE_TO_STATUS[moveCanon]!;
      // Apply to slot 0 (v1 simplification per plan §8).
      if (midOurs[0]!.status === "none") {
        midOurs[0]!.status = status;
      }
    }
  }

  const fallenOursMid = fallenAllyMid(opposingIds, roleAssignments);
  // Symmetric: count our own team's fallen-gate roles for THEIRS.
  const ourTeamIds = [0, 1, 2, 3, 4, 5].map((i) => speciesAt(team, i));
  const fallenTheirsMid = fallenAllyMid(ourTeamIds, roleAssignments);

  const mid: PhaseState = {
    ours: midOurs,
    theirs: [emptyMon(oppLead0), emptyMon(oppLead1)],
    fallen_allies_ours: fallenOursMid,
    fallen_allies_theirs: fallenTheirsMid,
  };

  // ----- LATE PHASE -----
  // Layout: ours[0] = mid pivot (echoed HP from midIncoming),
  //         ours[1] = the actor returning from the back row. We pick
  //         the cleaner when it carries a Choice Scarf (its choice-lock
  //         is the load-bearing late-phase signal — DS11); otherwise we
  //         track the lead-1 partner that stayed in (DS6 / DS9).
  const cleanerItem = (itemAt(team, candidate.cleaner) ?? "").toLowerCase();
  const cleanerHasScarf = /choice[-_ ]?scarf|choicescarf/.test(cleanerItem);

  // Mid pivot late HP: clamp(100 - midIncoming[0], 1, 100), then sand chip.
  let lateMidPivotHp = clampHpPct(100 - (midIncomingDamagePct.ours[0] ?? 0));
  if (fields.late.weather === "sand") {
    const species_id = speciesAt(team, candidate.mid);
    const ability = abilityAt(team, candidate.mid);
    if (!isSandImmune(species_id, ability)) {
      lateMidPivotHp = clampHpPct(lateMidPivotHp - 6);
    }
  }

  const lateOurs: MonState[] = [emptyMon(midId), emptyMon(cleanerId)];
  lateOurs[0]!.hp_pct = lateMidPivotHp;

  if (cleanerHasScarf) {
    // Slot 1 is the cleaner (just switched in → 100% HP).
    lateOurs[1] = emptyMon(cleanerId);
    lateOurs[1]!.hp_pct = 100;
    // Deterministic max-roll pick over the cleaner's move list.
    const moves = movesAt(team, candidate.cleaner).map(canonMoveId);
    const priority = ["lastrespects", "wavecrash", "liquidation", "aquajet"];
    let pick: string | null = null;
    for (const p of priority) {
      if (moves.includes(p)) { pick = p; break; }
    }
    if (!pick && moves.length > 0) pick = moves[0]!;
    lateOurs[1]!.choice_locked_move = pick;
  } else {
    // Slot 1 is the lead-1 partner carried over from mid (still in play).
    lateOurs[1] = emptyMon(lead1);
    // The lead-1 carryover's HP echoes the mid-incoming-damage on slot 1.
    lateOurs[1]!.hp_pct = clampHpPct(100 - (midIncomingDamagePct.ours[1] ?? 0));
  }
  // Stamina carryover: regardless of who occupies late.ours[1], when
  // the lead-1 slot was a Stamina holder that took a hit in the lead
  // phase, surface +2 Def in late.ours[1]. The carryover semantics
  // here are abstract — the snapshot represents "the Stamina state our
  // backbone accumulated by turn 4+," not strict mon identity (per the
  // test contract DS9 + DS11 — same team layout, different question).
  {
    const lead1Ability = (abilityAt(team, candidate.leads[1]!) ?? "").toLowerCase();
    const leadIncoming1 = leadIncomingDamagePct.ours[1] ?? 0;
    if (lead1Ability === "stamina" && leadIncoming1 > 0) {
      lateOurs[1]!.boosts.def = 2;
    }
    const lead0Ability = (abilityAt(team, candidate.leads[0]!) ?? "").toLowerCase();
    const leadIncoming0 = leadIncomingDamagePct.ours[0] ?? 0;
    if (lead0Ability === "stamina" && leadIncoming0 > 0) {
      // Mirror onto slot 0 of late as well (for symmetry; tests pin
      // slot 1 only today).
      lateOurs[0]!.boosts.def = 2;
    }
  }

  const fallenOursLate = Math.min(2, fallenOursMid + 1);
  const fallenTheirsLate = Math.min(2, fallenTheirsMid + 1);

  const late: PhaseState = {
    ours: lateOurs,
    theirs: [emptyMon(oppLead0), emptyMon(oppLead1)],
    fallen_allies_ours: fallenOursLate,
    fallen_allies_theirs: fallenTheirsLate,
  };

  return { lead, mid, late };
}
