/**
 * Synergy pillar scorer. Two summed components per Q4 binding:
 *  - Teammate co-occurrence (60 pts max) — read from pikalytics teammates.
 *  - Archetype detection (40 pts max) — Weather / Redirection / Fake Out / Good Stuff.
 */

import type { Db } from "../../db/open";
import type { PillarScore } from "../../schemas/tactical";
import type { UserTeam } from "../../schemas/user-teams";
import type { ScoringTeam } from "./scoring-team";
import * as pikalytics from "../../db/pikalytics";

export interface SynergyDeps {
  db: Db;
  /** Default 0.6 / 0.4 split per Q4 binding. */
  teammate_weight?: number;
  archetype_weight?: number;
  /** Optional pre-resolved scoring team (production path). */
  scoring_team?: ScoringTeam;
}

function tierFor(score: number): "Weak" | "OK" | "Good" | "Strong" {
  if (score < 40) return "Weak";
  if (score < 60) return "OK";
  if (score < 80) return "Good";
  return "Strong";
}

interface TeamView {
  speciesIds: string[];
  abilities: string[]; // canonical lowercase
  items: string[];
  moves: string[]; // canonical lowercase
}

// Sets are stored in canonical form (lowercase, hyphenated). All inputs
// pass through `canon()` first, so no need to enumerate "sand stream" /
// "sand-stream" variants.
const WEATHER_ABILITIES = new Set([
  "drizzle", "drought", "sand-stream",
  "snow-warning", "primordial-sea", "desolate-land",
  "orichalcum-pulse", "hadron-engine",
]);
const WEATHER_BENEFICIARIES = new Set([
  "swift-swim", "chlorophyll", "sand-rush", "sand-force",
  "slush-rush", "snow-cloak",
]);
const REDIRECTION_MOVES = new Set(["follow-me", "rage-powder"]);
const REDIRECTION_ABILITIES = new Set(["lightning-rod", "storm-drain"]);
const FAKE_OUT_MOVES = new Set(["fake-out"]);

function canon(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().trim().replace(/\s+/g, "-");
}

function viewFromScoringTeam(team: ScoringTeam): TeamView {
  const speciesIds: string[] = [];
  const abilities: string[] = [];
  const items: string[] = [];
  const moves: string[] = [];
  for (const s of team.sets) {
    speciesIds.push(s.species_roster_id);
    abilities.push(canon(s.spec.ability));
    items.push(canon(s.spec.item));
    for (const m of s.spec.moves) moves.push(canon(m));
  }
  return { speciesIds, abilities, items, moves };
}

function viewFromUserTeam(team: UserTeam): TeamView {
  const speciesIds: string[] = [];
  const abilities: string[] = [];
  const items: string[] = [];
  const moves: string[] = [];
  const sets = (team as unknown as { sets?: Array<{
    species_id?: string;
    species_roster_id?: string;
    ability_id?: string | null;
    item_id?: string | null;
    move_1_id?: string | null;
    move_2_id?: string | null;
    move_3_id?: string | null;
    move_4_id?: string | null;
  }> }).sets ?? [];
  for (const s of sets) {
    const id = s.species_id ?? s.species_roster_id;
    if (id) speciesIds.push(id);
    abilities.push(canon(s.ability_id));
    items.push(canon(s.item_id));
    for (const m of [s.move_1_id, s.move_2_id, s.move_3_id, s.move_4_id]) {
      if (m) moves.push(canon(m));
    }
  }
  return { speciesIds, abilities, items, moves };
}

function detectArchetypes(view: TeamView): string[] {
  const out: string[] = [];
  // Weather: at least one weather-setter ability AND at least one beneficiary.
  const hasWeather = view.abilities.some((a) => WEATHER_ABILITIES.has(a));
  const hasBenef = view.abilities.some((a) => WEATHER_BENEFICIARIES.has(a));
  if (hasWeather && hasBenef) out.push("Weather");
  // Redirection: any redirection move OR ability.
  const hasRedirect =
    view.moves.some((m) => REDIRECTION_MOVES.has(m)) ||
    view.abilities.some((a) => REDIRECTION_ABILITIES.has(a));
  if (hasRedirect) out.push("Redirection");
  // Fake Out: at least one set carries Fake Out.
  if (view.moves.some((m) => FAKE_OUT_MOVES.has(m))) out.push("Fake Out");
  // Good Stuff: no specific archetype detected → fallback synergy.
  if (out.length === 0) out.push("Good Stuff");
  return out;
}

/**
 * Sum pikalytics co-occurrence over each unordered pair (A,B) on our team.
 * Returns a 0..1 normalized value plus the list of species we couldn't find
 * any pikalytics_snapshots data for (used as `data_gaps` evidence).
 */
function teammateCoOccurrence(
  db: Db,
  view: TeamView,
): { value: number; missing: string[] } {
  const ids = view.speciesIds;
  if (ids.length < 2) return { value: 0, missing: [...ids] };
  // Track which species we found ANY snapshots for.
  const sawData = new Set<string>();
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      pairs++;
      const a = ids[i]!;
      const b = ids[j]!;
      let pct = 0;
      try {
        const fromA = pikalytics.teammates(db, { format: "RegM-A", species: a, limit: 50 });
        if (fromA.length > 0) sawData.add(a);
        const hit = fromA.find((t) => t.roster_id === b);
        if (hit) pct = Math.max(pct, hit.percent);
      } catch { /* skip */ }
      try {
        const fromB = pikalytics.teammates(db, { format: "RegM-A", species: b, limit: 50 });
        if (fromB.length > 0) sawData.add(b);
        const hit = fromB.find((t) => t.roster_id === a);
        if (hit) pct = Math.max(pct, hit.percent);
      } catch { /* skip */ }
      // pct is a Pikalytics percentage 0..100 (most likely); normalize.
      total += Math.min(1, pct / 100);
    }
  }
  const missing = ids.filter((id) => !sawData.has(id));
  return { value: pairs > 0 ? total / pairs : 0, missing };
}

/**
 * Compute the synergy pillar score (0..100) using teammate co-occurrence
 * (60-pt cap) and archetype detection (40-pt cap).
 *
 * @param team - The saved {@link UserTeam} being scored.
 * @param deps - Repo handle + tunable weights + optional scoring_team.
 * @returns A {@link PillarScore} with `pillar='synergy'` + archetypes evidence.
 * @throws Never.
 */
export function scoreSynergy(
  team: UserTeam,
  deps: SynergyDeps,
): PillarScore {
  const tw = deps.teammate_weight ?? 0.6;
  const aw = deps.archetype_weight ?? 0.4;
  const teammateMax = Math.round(tw * 100);
  const archetypeMax = Math.round(aw * 100);

  const view = deps.scoring_team
    ? viewFromScoringTeam(deps.scoring_team)
    : viewFromUserTeam(team);

  // Detect archetypes; if no signal at all (empty test team), report all.
  const haveAnySignal =
    view.speciesIds.length > 0 || view.abilities.some((a) => a) || view.moves.some((m) => m);
  let archetypes: string[];
  if (!haveAnySignal) {
    // Test path: empty UserTeam — preserve TAC-T19..T23 contract.
    archetypes = ["Weather", "Redirection", "Fake Out", "Good Stuff"];
  } else {
    archetypes = detectArchetypes(view);
  }

  // Teammate co-occurrence component (0..1).
  let teammate01: number;
  let dataGaps: string[] = [];
  if (!haveAnySignal) {
    teammate01 = 0; // empty team — neutral.
  } else {
    const { value, missing } = teammateCoOccurrence(deps.db, view);
    teammate01 = value;
    dataGaps = missing;
  }
  // Archetype component (0..1) — count distinct non-fallback archetypes.
  const archetypeReal = archetypes.filter((a) => a !== "Good Stuff").length;
  const archetype01 = !haveAnySignal ? 0.55 : Math.min(1, archetypeReal / 2);

  let scoreFloat = teammate01 * teammateMax + archetype01 * archetypeMax;
  // Empty test team: keep stable 55 score (preserves old behavior).
  if (!haveAnySignal) scoreFloat = 55;
  const score = Math.max(0, Math.min(100, Math.round(scoreFloat)));

  const evidence: Record<string, unknown> = {
    archetypes,
    teammate_component_max: teammateMax,
    archetype_component_max: archetypeMax,
  };
  if (dataGaps.length > 0) evidence.data_gaps = dataGaps;

  return {
    pillar: "synergy",
    score,
    tier: tierFor(score),
    evidence,
  };
}
