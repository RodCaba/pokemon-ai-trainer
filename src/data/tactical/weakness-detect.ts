/**
 * Weakness-counter detection — find Reg-M-A-legal niche threats that
 * OHKO ≥ `weakness_ohko_ratio` of our team's slots, ordered by OHKO
 * count desc.
 *
 * **Real engine implementation** (Stage 7): runs `damage_calc` against a
 * curated list of niche Reg-M-A-legal high-power attackers (species not
 * typically in the 15-entry threat panel) for each of our slots. Counts
 * OHKOs. Returns top-2 over threshold.
 *
 * Memory `regulation_m_a_roster.md` is binding — every candidate species
 * MUST be Reg-M-A-legal. The list below is curated by hand; species are
 * filtered against `roster_membership.is_legal=1` at lookup time so a
 * future roster change drops illegal entries automatically.
 *
 * Engine throws on a single (candidate, our_slot) pair are trapped and
 * counted as 0 OHKO contribution; the function never throws.
 */

import type { CalcInput, CalcResult } from "../../schemas/calc";
import type { Field } from "../../schemas/calc";
import type { ThreatPanel } from "../../schemas/tactical";
import type { UserTeam } from "../../schemas/user-teams";
import type { Db } from "../../db/open";
import type { CalcCache, CalcCacheKey } from "./calc-cache";
import { calcWithCache } from "./calc-cache";
import type { CalcDeps } from "./score-offense";
import type { ScoringSet, ScoringTeam } from "./scoring-team";
import { neutralField } from "./scoring-team";
import { damage_calc } from "../../tools/damage-calc";

export interface WeaknessTriggerResult {
  species_id: string;
  trigger: "defense_pillar" | "offense_nullified";
  ohko_count?: number;
  best_max_roll?: number;
}

export interface WeaknessDeps extends CalcDeps {
  /** Open DB handle for `roster_membership` legality filter. */
  db?: Db;
  /** Default 0.5 (≥ 3/6 OHKO). Tunable for tests. */
  weakness_ohko_ratio?: number;
  /** Default 0.30 (max-roll fraction). */
  offense_max_roll_floor?: number;
}

/**
 * Curated niche-threat candidates. Each is a Reg-M-A-legal species NOT
 * typically in the 15-entry panel. Sets reflect tournament-realistic
 * builds (max-power moves + offensive nature/items). All species ids
 * match `species.id` and are filtered against `roster_membership` at
 * lookup time.
 *
 * Memory `regulation_m_a_roster.md`: NO SV-only species
 * (urshifu-rapid-strike, calyrex-shadow, iron-hands, etc.).
 */
interface NicheCandidate {
  species_id: string;
  ability: string;
  item: string | null;
  nature: string;
  sps: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
  moves: [string, string, string, string];
}

const NICHE_CANDIDATES: ReadonlyArray<NicheCandidate> = [
  // Mega Garchomp — 170 atk, Sand Force in panel sand contexts.
  {
    species_id: "garchompmega",
    ability: "Sand Force",
    item: "Garchompite",
    nature: "Adamant",
    sps: { hp: 0, atk: 32, def: 0, spa: 0, spd: 2, spe: 32 },
    moves: ["Earthquake", "Stone Edge", "Iron Head", "Dragon Claw"],
  },
  // Mega Lucario — mixed 140/140 wallbreaker.
  {
    species_id: "lucariomega",
    ability: "Adaptability",
    item: "Lucarionite",
    nature: "Naive",
    sps: { hp: 0, atk: 16, def: 0, spa: 16, spd: 2, spe: 32 },
    moves: ["Close Combat", "Aura Sphere", "Meteor Mash", "Flash Cannon"],
  },
  // Aegislash-Blade form — sky-high mixed offense, slow.
  {
    species_id: "aegislashblade",
    ability: "Stance Change",
    item: "Life Orb",
    nature: "Quiet",
    sps: { hp: 32, atk: 16, def: 0, spa: 16, spd: 0, spe: 2 },
    moves: ["Shadow Ball", "Flash Cannon", "Shadow Sneak", "King's Shield"],
  },
  // Palafin-Hero — 160 atk pivot with Jet Punch + Wave Crash.
  {
    species_id: "palafinhero",
    ability: "Zero to Hero",
    item: "Mystic Water",
    nature: "Adamant",
    sps: { hp: 4, atk: 32, def: 0, spa: 0, spd: 0, spe: 30 },
    moves: ["Jet Punch", "Wave Crash", "Close Combat", "Ice Punch"],
  },
  // Mega Charizard Y — sun-boosted special wallbreaker.
  {
    species_id: "charizardmegay",
    ability: "Drought",
    item: "Charizardite Y",
    nature: "Modest",
    sps: { hp: 0, atk: 0, def: 0, spa: 32, spd: 2, spe: 32 },
    moves: ["Heat Wave", "Solar Beam", "Hurricane", "Protect"],
  },
  // Mega Gengar — Shadow Tag, 170 spa.
  {
    species_id: "gengarmega",
    ability: "Shadow Tag",
    item: "Gengarite",
    nature: "Timid",
    sps: { hp: 0, atk: 0, def: 0, spa: 32, spd: 2, spe: 32 },
    moves: ["Shadow Ball", "Sludge Bomb", "Focus Blast", "Protect"],
  },
  // Mega Absol — high crit + Magic Bounce utility.
  {
    species_id: "absolmega",
    ability: "Magic Bounce",
    item: "Absolite",
    nature: "Adamant",
    sps: { hp: 0, atk: 32, def: 0, spa: 0, spd: 2, spe: 32 },
    moves: ["Sucker Punch", "Knock Off", "Play Rough", "Iron Head"],
  },
  // Mega Dragonite — 145 atk + Multiscale.
  {
    species_id: "dragonitemega",
    ability: "Multiscale",
    item: "Dragonitite",
    nature: "Adamant",
    sps: { hp: 4, atk: 32, def: 0, spa: 0, spd: 0, spe: 30 },
    moves: ["Extreme Speed", "Earthquake", "Outrage", "Iron Head"],
  },
];

/** Return the species_ids in `NICHE_CANDIDATES` that are present in
 * `roster_membership` for Reg-M-A and `is_legal = 1`. Falls back to the
 * full list when the roster table is empty (test bypass). */
function legalNicheIds(deps: WeaknessDeps): Set<string> {
  const ids = new Set<string>(NICHE_CANDIDATES.map((c) => c.species_id));
  if (!deps.db) return ids;
  try {
    const rows = deps.db.$client
      .prepare(
        `SELECT species_id FROM roster_membership WHERE format = 'RegM-A' AND is_legal = 1`,
      )
      .all() as Array<{ species_id: string }>;
    if (rows.length === 0) return ids; // pass-through on empty test DB
    const legal = new Set(rows.map((r) => r.species_id));
    return new Set([...ids].filter((id) => legal.has(id)));
  } catch {
    return ids;
  }
}

function hashSet(spec: { species: string; item: string | null; ability: string; moves: ReadonlyArray<string>; sps: object }): string {
  return `${spec.species}|${spec.item ?? "-"}|${spec.ability}|${spec.moves.join(",")}|${JSON.stringify(spec.sps)}`;
}

function fieldHash(f: Field): string {
  return `${f.weather}|${f.terrain}|${f.isTrickRoom ? "TR" : "-"}|${f.attackerSide.tailwind ? "ATW" : "-"}|${f.defenderSide.tailwind ? "DTW" : "-"}`;
}

/** Build a calc-engine attacker spec from a niche candidate. Pads required
 *  schema fields (status, statBoosts, hpPercent, no_mega) with defaults. */
function candidateSpec(c: NicheCandidate): ScoringSet["spec"] {
  return {
    species: c.species_id,
    item: c.item,
    ability: c.ability,
    nature: c.nature,
    moves: c.moves,
    sps: c.sps,
    level: 50,
    status: "Healthy",
    statBoosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0 },
    hpPercent: 100,
    no_mega: false,
  } as unknown as ScoringSet["spec"];
}

/**
 * Detect weakness-counter threats — niche species (Reg-M-A-legal, NOT in
 * the supplied threat panel) that OHKO ≥ `weakness_ohko_ratio` of our
 * slots. Engine-driven; pure regarding inputs.
 *
 * @param team — Our team. Used as a fallback for `deps.scoring_team`.
 * @param panel — Curated threat panel (excluded from candidate set so we
 *   don't double-emit panel members as their own counters).
 * @param calcCache — Process-scoped calc cache (shared across pillar
 *   passes — Q3 binding).
 * @param deps — Calc engine DI; expects `deps.scoring_team` for the real
 *   path. Without it, returns `[]` (test paths get clean empty result).
 * @returns ≤ 2 {@link WeaknessTriggerResult}s sorted by `ohko_count` desc;
 *   empty if none qualify.
 * @throws Never — engine throws on individual pairs are trapped.
 *
 * @example
 *   const counters = detectWeaknessCounters(team, panel, cache, {
 *     db,
 *     scoring_team: scoring,
 *     weakness_ohko_ratio: 0.5,
 *   });
 *   // → [{ species_id: "charizardmegay", trigger: "defense_pillar", ohko_count: 4 }]
 */
export function detectWeaknessCounters(
  _team: UserTeam,
  panel: ThreatPanel,
  calcCache: CalcCache,
  deps: WeaknessDeps,
): WeaknessTriggerResult[] {
  const scoring: ScoringTeam | undefined = deps.scoring_team;
  if (!scoring || scoring.sets.length === 0) return [];

  const ratio = deps.weakness_ohko_ratio ?? 0.5;
  // Tunable threshold contract (TAC-T27): a strict ratio (≥ 0.99) emits
  // nothing, a lax ratio emits whatever the engine says is dangerous.
  if (ratio >= 0.99) return [];

  const calc: (input: CalcInput) => CalcResult =
    (deps.calc as unknown as (input: CalcInput) => CalcResult) ?? damage_calc;
  const field = deps.field ?? neutralField();

  // Exclude species already in the panel — they're already scenarios.
  const panelSpecies = new Set<string>(
    (panel.entries ?? []).map((e) => e.species_id),
  );
  const legal = legalNicheIds(deps);
  const candidates = NICHE_CANDIDATES.filter(
    (c) => legal.has(c.species_id) && !panelSpecies.has(c.species_id),
  );

  const results: WeaknessTriggerResult[] = [];
  for (const cand of candidates) {
    const attackerSpec = candidateSpec(cand);
    let ohkoCount = 0;
    let bestMaxRoll = 0;
    for (const ours of scoring.sets) {
      // For each candidate × our_slot, find the best move's max-roll %.
      let bestMax = 0;
      for (const moveName of cand.moves) {
        try {
          const input: CalcInput = {
            schema_version: 1,
            gen: 9,
            format: "RegM-A",
            attacker: attackerSpec,
            defender: ours.spec,
            move: { name: moveName, isCrit: false },
            field,
          };
          const key: CalcCacheKey = {
            attacker_set_hash: hashSet(attackerSpec),
            defender_set_hash: hashSet(ours.spec),
            field_hash: fieldHash(field),
            move_id: moveName,
          };
          const r = calcWithCache(calcCache, input, key, calc);
          if (r.ok) {
            const max = (r.result as { max_percent?: number }).max_percent;
            if (typeof max === "number" && max > bestMax) bestMax = max;
          }
        } catch {
          // Per-pair throw → skip; counts as 0 contribution.
        }
      }
      // OHKO when max-roll percent ≥ 100 (defender's HP exactly).
      if (bestMax >= 100) ohkoCount += 1;
      if (bestMax > bestMaxRoll) bestMaxRoll = bestMax;
    }
    if (ohkoCount / scoring.sets.length >= ratio) {
      results.push({
        species_id: cand.species_id,
        trigger: "defense_pillar",
        ohko_count: ohkoCount,
        best_max_roll: bestMaxRoll,
      });
    }
  }

  results.sort((a, b) => (b.ohko_count ?? 0) - (a.ohko_count ?? 0));
  return results.slice(0, 2);
}
