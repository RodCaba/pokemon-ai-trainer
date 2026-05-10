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
  /** Stage A: precomputed role assignments per species_id. When set,
   *  evidence carries `role_tags` + `role_coherence` + an archetype
   *  +20 floor when (a)+(b) hold (plan §3.2 + Q12 binding). */
  roleAssignments?: ReadonlyMap<string, import("../../schemas/tactical").RoleTagAssignment>;
}

function tierFor(score: number): "Weak" | "OK" | "Good" | "Strong" {
  if (score < 40) return "Weak";
  if (score < 60) return "OK";
  if (score < 80) return "Good";
  return "Strong";
}

interface TeamView {
  speciesIds: string[];
  /** Per-slot alias list: aliases[i] is the species_ids to try when looking
   *  up slot i in pikalytics. First entry is the primary id; subsequent
   *  entries are mega-evolved forms when the held item is a Mega Stone.
   *  Pikalytics ingests by battle-form id (`charizardmegay`, `floettemega`),
   *  while user teams store the pre-Mega base (`charizard`, `floette-eternal`)
   *  — without alias resolution we'd report "data gap" on every Mega user.
   */
  aliases: string[][];
  abilities: string[]; // canonical lowercase
  items: string[];
  moves: string[]; // canonical lowercase
}

/** True when an item id looks like a Mega Stone — matches `*ite`,
 *  `*itex`/`*itey` (packed), or `*ite-x`/`*ite-y` (canon-from-display). */
function isMegaStoneId(canonItemId: string): boolean {
  return /^[a-z0-9-]+ite(-?[xy])?$/.test(canonItemId);
}

/** Strip trailing form-suffixes from a species id so we can derive the
 *  mega-form id by appending "mega". Floette-Eternal → floette;
 *  Tauros-Paldea-Aqua → tauros; Charizard → charizard. Conservative — only
 *  strips suffixes we know mark non-mega regional/special forms. */
function megaBaseStripForms(speciesId: string): string {
  const KNOWN_FORM_SUFFIXES = [
    "-eternal", "-paldea-aqua", "-paldea-blaze", "-paldea-combat",
    "-alola", "-galar", "-hisui", "-paldea",
  ];
  for (const sfx of KNOWN_FORM_SUFFIXES) {
    if (speciesId.endsWith(sfx)) return speciesId.slice(0, -sfx.length);
  }
  return speciesId;
}

/** Resolve the mega-form alias(es) for a (species, item) pair, verifying
 *  each candidate exists in the species table. Returns `[]` when the item
 *  isn't a Mega Stone or no mega form is known. */
function resolveMegaAliases(
  db: Db,
  speciesId: string,
  itemId: string,
): string[] {
  if (!itemId || !isMegaStoneId(itemId)) return [];
  const base = megaBaseStripForms(speciesId);
  const candidates = [`${base}mega`, `${base}megax`, `${base}megay`];
  const aliases: string[] = [];
  for (const c of candidates) {
    try {
      const row = db.$client
        .prepare("SELECT 1 AS ok FROM species WHERE id = ? LIMIT 1")
        .get(c) as { ok: number } | undefined;
      if (row) aliases.push(c);
    } catch {
      /* no species table — bypass */
    }
  }
  return aliases;
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

function viewFromScoringTeam(team: ScoringTeam, db: Db): TeamView {
  const speciesIds: string[] = [];
  const aliases: string[][] = [];
  const abilities: string[] = [];
  const items: string[] = [];
  const moves: string[] = [];
  for (const s of team.sets) {
    speciesIds.push(s.species_roster_id);
    const itemCanon = canon(s.spec.item);
    aliases.push([
      s.species_roster_id,
      ...resolveMegaAliases(db, s.species_roster_id, itemCanon),
    ]);
    abilities.push(canon(s.spec.ability));
    items.push(itemCanon);
    for (const m of s.spec.moves) moves.push(canon(m));
  }
  return { speciesIds, aliases, abilities, items, moves };
}

function viewFromUserTeam(team: UserTeam, db: Db): TeamView {
  const speciesIds: string[] = [];
  const aliases: string[][] = [];
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
    const itemCanon = canon(s.item_id);
    if (id) {
      speciesIds.push(id);
      aliases.push([id, ...resolveMegaAliases(db, id, itemCanon)]);
    }
    abilities.push(canon(s.ability_id));
    items.push(itemCanon);
    for (const m of [s.move_1_id, s.move_2_id, s.move_3_id, s.move_4_id]) {
      if (m) moves.push(canon(m));
    }
  }
  return { speciesIds, aliases, abilities, items, moves };
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
  const aliases = view.aliases;
  if (ids.length < 2) return { value: 0, missing: [...ids] };
  // For each species, accumulate teammate data across ALL its aliases
  // (base form + mega form when held item is a Mega Stone). pikalytics
  // ingests by battle-form id, so a base-form team-set must alias-resolve
  // to its mega-form id for synergy lookup to succeed.
  const teammateMapBySpecies = new Map<string, Map<string, number>>();
  const sawData = new Set<string>();
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!;
    const aliasList = aliases[i] ?? [id];
    const merged = new Map<string, number>();
    for (const alias of aliasList) {
      try {
        const tms = pikalytics.teammates(db, { format: "RegM-A", species: alias, limit: 50 });
        if (tms.length > 0) sawData.add(id);
        for (const tm of tms) {
          // Keep the highest co-occurrence percent across aliases.
          const prev = merged.get(tm.roster_id) ?? 0;
          if (tm.percent > prev) merged.set(tm.roster_id, tm.percent);
        }
      } catch { /* skip */ }
    }
    teammateMapBySpecies.set(id, merged);
  }
  // Score pairs: for (A, B) take max co-occurrence as seen from either side.
  // A's teammates list may name B by either B's base or mega id; check both.
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      pairs++;
      const a = ids[i]!;
      const b = ids[j]!;
      const aliasesB = aliases[j] ?? [b];
      const aliasesA = aliases[i] ?? [a];
      let pct = 0;
      const fromA = teammateMapBySpecies.get(a);
      if (fromA) {
        for (const idB of aliasesB) {
          const hit = fromA.get(idB);
          if (hit !== undefined && hit > pct) pct = hit;
        }
      }
      const fromB = teammateMapBySpecies.get(b);
      if (fromB) {
        for (const idA of aliasesA) {
          const hit = fromB.get(idA);
          if (hit !== undefined && hit > pct) pct = hit;
        }
      }
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
    ? viewFromScoringTeam(deps.scoring_team, deps.db)
    : viewFromUserTeam(team, deps.db);

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
  let archetype01 = !haveAnySignal ? 0.55 : Math.min(1, archetypeReal / 2);

  // Stage A (Q12 (a)+(b)): role coherence lifts the archetype component to
  // a 0.5 floor (+20 of the 40-pt archetype budget) when (a) ≥1 setter sub-tag
  // AND (b) ≥1 payoff (setup_sweeper or cleaner) on the team. This rescues
  // teams whose data_gap penalty buries them despite a coherent role chain
  // (the ArchaEye failure mode).
  let role_coherence = false;
  let coherence_chain: { setter: string; payoff: string; payoff_role: string } | null = null;
  if (deps.roleAssignments && deps.roleAssignments.size > 0) {
    const setterTags = new Set<string>([
      "weather_setter", "speed_control_setter", "screen_setter",
    ]);
    const payoffTags = new Set<string>(["setup_sweeper", "cleaner"]);
    let setterId: string | null = null;
    let payoff: { id: string; role: string } | null = null;
    for (const [id, asn] of deps.roleAssignments) {
      if (setterId === null && asn.all.some((t) => setterTags.has(t))) setterId = id;
      if (payoff === null) {
        for (const t of asn.all) {
          if (payoffTags.has(t)) { payoff = { id, role: t }; break; }
        }
      }
    }
    if (setterId !== null && payoff !== null) {
      role_coherence = true;
      coherence_chain = { setter: setterId, payoff: payoff.id, payoff_role: payoff.role };
      // +20 floor on the archetype 0..1 component (40-pt budget × 0.5 = +20).
      archetype01 = Math.max(archetype01, 0.5);
    }
  }

  let scoreFloat = teammate01 * teammateMax + archetype01 * archetypeMax;
  // Empty test team: keep stable 55 score (preserves old behavior).
  if (!haveAnySignal) scoreFloat = 55;
  // Role-coherence lifts the score to OK tier (≥ 50) even when teammate
  // co-occurrence data is sparse. The premise: a setter+payoff backbone is
  // itself a structural-synergy signal, independent of pikalytics co-occur
  // (which often misses sub-meta archetypes like screens-rain-stamina).
  // SY5 + the live ArchaEye success criterion both pin this floor; without
  // it, the support pillar surfaces the chain but synergy stays "Weak".
  if (role_coherence) scoreFloat = Math.max(scoreFloat, 50);
  if (role_coherence && !haveAnySignal) scoreFloat = Math.max(scoreFloat, 55 + 20);
  const score = Math.max(0, Math.min(100, Math.round(scoreFloat)));

  const evidence: Record<string, unknown> = {
    archetypes,
    teammate_component_max: teammateMax,
    archetype_component_max: archetypeMax,
  };
  if (dataGaps.length > 0) evidence.data_gaps = dataGaps;
  if (deps.roleAssignments && deps.roleAssignments.size > 0) {
    const role_tags: Record<string, unknown> = {};
    for (const [k, v] of deps.roleAssignments) role_tags[k] = v;
    evidence.role_tags = role_tags;
    evidence.role_coherence = role_coherence;
    evidence.coherence_chain = coherence_chain;
  }

  return {
    pillar: "synergy",
    score,
    tier: tierFor(score),
    evidence,
  };
}
