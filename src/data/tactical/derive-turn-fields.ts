/**
 * Stage C (turn-weighted-phase-scoring) — per-phase field-state
 * resolver (plan §4 turn-window model + §4.1 priority abilities +
 * §5 decay).
 *
 * Pure module. Inputs already resolved upstream:
 *   - `roleAssignments` — Stage A classifier output.
 *   - `opposingSetters` — Stage C's `detectOpposingSetters` output.
 *
 * Returns three `ScenarioField` snapshots — one for each phase
 * (T1 / T2 / T4). Each snapshot is fed to its phase scorer.
 *
 * Decay defaults (Q5 ✓): weather 5T, TR 5T, Tailwind 4T, screens 5T.
 * Lead T1: everything active. Mid T2: everything still active (≥ 4).
 * Late T4: Tailwind expired (T5+), TR expired (T5+), screens expired
 * (T5+), weather expired (T5+) by default. Permanent speed modifiers
 * (Choice Scarf) persist — handled by the calc engine, not here.
 *
 * Q4 ✓: weather speed-tie resolution → "theirs wins" (conservative).
 * Q9 ✓: speed-tie general rule → "theirs wins."
 * Q10 ✓: late-phase weather under our setter still alive — if our
 * weather_provided_via_ability setter is in mid OR cleaner slot
 * (assumed alive turn 5+ since it hasn't been the lead), the late
 * field reflects their weather.
 *
 * TODO(stage6-deferred): late-phase-weather-via-hp-tracking —
 * the "assumed alive" assumption falls apart when the lead pair gets
 * KO'd and the back has to switch in earlier. Stage D fixes.
 * TODO(stage6-deferred): tailwind-reset-late-game — Q3 binding
 * acknowledged that Tailwind may be re-set; Stage D needs action
 * selection.
 */

import type {
  RoleTagAssignment,
  ScenarioField,
  ScenarioSkeleton,
} from "../../schemas/tactical";
import type { UserTeam } from "../../schemas/user-teams";
import type { PlanCandidate } from "./recommend-plan";
import type { OpposingSetter, OpposingSetters } from "./opposing-setter";

export interface TurnFieldStates {
  lead: ScenarioField;
  mid: ScenarioField;
  late: ScenarioField;
}

export interface DeriveTurnFieldsInput {
  team: UserTeam;
  scenario: ScenarioSkeleton;
  candidate: PlanCandidate;
  roleAssignments: ReadonlyMap<string, RoleTagAssignment>;
  opposingSetters: OpposingSetters;
}

function speciesAt(team: UserTeam, slot: number): string {
  const sets = (team as unknown as { sets?: Array<{ species_id?: string | null; species_roster_id?: string | null }> }).sets ?? [];
  return sets[slot]?.species_id ?? sets[slot]?.species_roster_id ?? "";
}

/** Find our lead setter — first lead with weather/TR/Tailwind/screen
 *  source via ability OR via a priority-granting status ability. */
interface OurLeadSetter {
  species_id: string;
  weather?: ScenarioField["weather"];
  trick_room?: boolean;
  tailwind_ours?: boolean;
  light_screen?: boolean;
  reflect?: boolean;
  /** True when the source is ability-based (instant on switch-in). */
  via_ability: boolean;
  /** True when the source is priority-promoted (Prankster / Gale Wings). */
  via_priority: boolean;
}

function readOurLeadSetters(
  team: UserTeam,
  candidate: PlanCandidate,
  roles: ReadonlyMap<string, RoleTagAssignment>,
): OurLeadSetter[] {
  const out: OurLeadSetter[] = [];
  for (const slot of candidate.leads) {
    const id = speciesAt(team, slot);
    const r = roles.get(id);
    if (!r) continue;
    const setter: OurLeadSetter = {
      species_id: id,
      via_ability: false,
      via_priority: false,
    };
    let claimed = false;
    if (r.weather_provided_via_ability) {
      setter.weather = r.weather_provided_via_ability;
      setter.via_ability = true;
      claimed = true;
    } else if (r.setter_priority_via_ability) {
      const eff = r.setter_priority_via_ability.effect;
      if (eff === "weather_rain") setter.weather = "rain";
      else if (eff === "weather_sun") setter.weather = "sun";
      else if (eff === "weather_sand") setter.weather = "sand";
      else if (eff === "weather_snow") setter.weather = "snow";
      else if (eff === "trick_room") setter.trick_room = true;
      else if (eff === "tailwind") setter.tailwind_ours = true;
      else if (eff === "reflect") setter.reflect = true;
      else if (eff === "light_screen") setter.light_screen = true;
      else if (eff === "aurora_veil") { setter.reflect = true; setter.light_screen = true; }
      setter.via_priority = true;
      claimed = eff !== "healing";
    } else if (r.weather_provided) {
      setter.weather = r.weather_provided;
      claimed = true;
    }
    if (claimed) out.push(setter);
  }
  return out;
}

/** Resolve the opposing weather setter to its kind + base spe. */
function readOpposingWeather(
  opposingSetters: OpposingSetters,
): { kind: ScenarioField["weather"]; base_spe: number } | null {
  const w = opposingSetters.weather;
  if (!w) return null;
  return { kind: w.kind, base_spe: w.base_spe };
}

/** Q9 ✓ "theirs wins" on speed ties: `a` ≤ `b` means `a` is "slower
 *  or tied" (we treat tied as theirs winning when we're comparing our
 *  setter (a) to theirs (b)). */
function speedDuelOurSide(
  ourSpe: number,
  theirSpe: number,
): "ours" | "theirs" {
  // SLOWER sets last and overwrites. Ties → theirs wins (Q9).
  if (ourSpe < theirSpe) return "ours";
  return "theirs";
}

/** Our team has a base-spe lookup we can resolve from species_id, but
 *  Stage C avoids passing the DB into a pure function. Stage 5
 *  defensive: when species base spe is unknown to the caller, we
 *  fall back to 80 (the neutral baseline). The classifier upstream
 *  could carry base_spe on the assignment to remove this fallback —
 *  documented as a Stage-D refinement. */
function baseSpeedOf(
  species_id: string,
  team: UserTeam,
): number {
  // Heuristic: look up the lead's known shape via the team data. Stage 5
  // stage doesn't have a species → base_spe map available without
  // pulling the DB in; we accept 80 as the default. The opposing-setter
  // detector DOES carry base_spe (resolved from the DB at detection
  // time), so weather duels are accurate on the opposing side; ours
  // is approximate.
  void species_id; void team;
  return 80;
}

export function deriveTurnFieldStates(input: DeriveTurnFieldsInput): TurnFieldStates {
  const { team, scenario, candidate, roleAssignments, opposingSetters } = input;
  const base = scenario.field;

  // Resolve the lead-phase field.
  const lead: ScenarioField = {
    weather: base.weather,
    terrain: base.terrain,
    trick_room: base.trick_room,
    tailwind_ours: base.tailwind_ours,
    tailwind_theirs: base.tailwind_theirs,
    light_screen: base.light_screen,
    reflect: base.reflect,
    gravity: base.gravity,
  };

  const ourSetters = readOurLeadSetters(team, candidate, roleAssignments);
  const opposing = readOpposingWeather(opposingSetters);

  // ----- WEATHER -----
  // Pick "our weather contribution" from leads that fire turn-1 (ability
  // setter or priority-promoted). If both leads bring weather, the slower
  // one wins the intra-team duel.
  const turn1WeatherSetters = ourSetters.filter(
    (s) => s.weather !== undefined && (s.via_ability || s.via_priority),
  );
  let ourWeather: { kind: ScenarioField["weather"]; base_spe: number } | null = null;
  if (turn1WeatherSetters.length > 0) {
    let pick = turn1WeatherSetters[0]!;
    for (const candidate2 of turn1WeatherSetters.slice(1)) {
      const a = baseSpeedOf(pick.species_id, team);
      const b = baseSpeedOf(candidate2.species_id, team);
      // Slower wins intra-team duel.
      if (b < a) pick = candidate2;
    }
    ourWeather = {
      kind: pick.weather!,
      base_spe: baseSpeedOf(pick.species_id, team),
    };
  }

  if (ourWeather && opposing) {
    // Weather duel: SLOWER sets second, theirs wins ties (Q9 ✓).
    const winner = speedDuelOurSide(ourWeather.base_spe, opposing.base_spe);
    lead.weather = winner === "ours" ? ourWeather.kind : opposing.kind;
  } else if (ourWeather) {
    lead.weather = ourWeather.kind;
  } else if (opposing) {
    lead.weather = opposing.kind;
  }
  // else: leave scenario default.

  // ----- TR / TAILWIND / SCREENS from priority-promoted lead setters -----
  for (const s of ourSetters) {
    if (s.trick_room) lead.trick_room = true;
    if (s.tailwind_ours) lead.tailwind_ours = true;
    if (s.reflect) lead.reflect = true;
    if (s.light_screen) lead.light_screen = true;
  }

  // ----- MID PHASE -----
  // Start from the lead field. Add move-based setters that finish turn 1
  // (so are up at turn 2). Decay nothing yet — Tailwind 4T, screens/TR/
  // weather 5T are all still active at turn 2-4.
  const mid: ScenarioField = { ...lead };
  for (const slot of candidate.leads) {
    const id = speciesAt(team, slot);
    const r = roleAssignments.get(id);
    if (!r) continue;
    // Move-only weather setter (not via ability, not via priority):
    // lands turn 1, active turn 2+.
    if (
      r.weather_provided !== undefined &&
      r.weather_provided_via_ability === undefined &&
      r.setter_priority_via_ability === undefined
    ) {
      mid.weather = r.weather_provided;
    }
  }

  // ----- LATE PHASE -----
  // Q6 ✓: temporary OUR-side effects (tailwind_ours, trick_room, screens)
  // decay by turn 5+. WEATHER is a special case: the scenario.field
  // represents the opposing archetype's persistent weather (Sun scenario
  // means the opp team has Drought up the whole battle), so weather
  // doesn't auto-decay in the late phase — it persists from the scenario
  // unless WE override it (Q10).
  const late: ScenarioField = {
    weather: base.weather,
    terrain: base.terrain,
    trick_room: false,
    tailwind_ours: false,
    tailwind_theirs: false,
    light_screen: false,
    reflect: false,
    gravity: base.gravity,
  };

  // Q10 ✓: if our weather-via-ability setter is in mid OR cleaner slot
  // (assumed still alive turn 5+), late weather = our weather.
  let lateWeatherOverridden = false;
  for (const slot of [candidate.mid, candidate.cleaner]) {
    const id = speciesAt(team, slot);
    const r = roleAssignments.get(id);
    if (r?.weather_provided_via_ability !== undefined) {
      late.weather = r.weather_provided_via_ability;
      lateWeatherOverridden = true;
      break;
    }
  }

  // No-op when not overridden: late.weather defaults to base.weather
  // (already set above). This represents "opposing archetype weather
  // persists" — the scenario field carries weather because the opposing
  // team is maintaining it, and we don't track decay of opposing setup.
  void lateWeatherOverridden;

  return { lead, mid, late };
}
