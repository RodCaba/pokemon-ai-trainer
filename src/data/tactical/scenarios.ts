/**
 * Generate 5–7 ScenarioOverview *skeletons*. 3 archetype clusters +
 * 2–3 individual top-usage threats + 0–2 weakness-counter scenarios.
 */

import type { Db } from "../../db/open";
import type {
  ScenarioField,
  ScenarioOverview,
  ThreatPanel,
} from "../../schemas/tactical";
import type { UserTeam } from "../../schemas/user-teams";
import type { CalcCache } from "./calc-cache";
import { detectWeaknessCounters } from "./weakness-detect";
import { TacticalScenarioError } from "../../schemas/errors";
import type { ScoringTeam } from "./scoring-team";

export interface ScenarioGenDeps {
  db: Db;
  panel: ThreatPanel;
  team: UserTeam;
  calcCache: CalcCache;
  weakness_ohko_ratio?: number;
  /** Scoring team for engine-driven weakness detection (Stage 7). */
  scoring_team?: ScoringTeam;
}

const FIELD_NEUTRAL: ScenarioField = {
  weather: "none",
  terrain: "none",
  trick_room: false,
  tailwind_ours: false,
  tailwind_theirs: false,
  light_screen: false,
  reflect: false,
  gravity: false,
};

const FIELD_SUN: ScenarioField = { ...FIELD_NEUTRAL, weather: "sun" };
const FIELD_RAIN: ScenarioField = { ...FIELD_NEUTRAL, weather: "rain" };
const FIELD_SAND: ScenarioField = { ...FIELD_NEUTRAL, weather: "sand" };
const FIELD_SNOW: ScenarioField = { ...FIELD_NEUTRAL, weather: "snow" };
const FIELD_TR: ScenarioField = { ...FIELD_NEUTRAL, trick_room: true };

const PLACEHOLDER: Pick<
  ScenarioOverview,
  "recommended_leads" | "recommended_backline" | "rejected_bench" | "reasoning" | "key_calcs" | "citations" | "pair_score"
> = {
  recommended_leads: ["incineroar", "amoonguss"],
  recommended_backline: ["rillaboom", "garchomp"],
  rejected_bench: ["porygon2", "pelipper"],
  reasoning: "Filled by recommendLeads.",
  key_calcs: [],
  citations: [],
  pair_score: 0,
};

/**
 * Author a scenario `description` (1–2 paragraphs, ≤ 800 chars) explaining
 * what the scenario tests and why it matters in Reg M-A. Plain text; no
 * markdown headers (the consumer picks formatting). Kept deterministic
 * (templated, not AI-generated) so re-runs produce identical output.
 */
function describeScenario(
  name: string,
  type: "archetype" | "individual" | "weakness_counter" | "meta_team" | "mirror_match",
  field: ScenarioField,
  opposing_preview: ReadonlyArray<string>,
): string {
  const oppList = opposing_preview.slice(0, 3).join(", ");
  if (type === "archetype") {
    if (field.weather === "sun") {
      return (
        "Sun archetype scenario. Sun-setting cores typically pair a Drought/Drought-substitute setter (Torkoal, Ninetales) with sun-abusing hitters that benefit from 1.5× Fire damage and Solar Beam without a charge turn. " +
        `The recommended leads are scored against representative sun-side leads (${oppList || "Torkoal, Venusaur"}). Field is sun, weather damage applies, Solar Beam fires immediately. Bring leads that can break the setter on turn 1 or that ignore the sun bonus.`
      );
    }
    if (field.weather === "rain") {
      return (
        "Rain archetype scenario. Rain teams pair a Drizzle setter (Pelipper) with Swift Swim / Hydration sweepers that benefit from 1.5× Water damage and 100%-accurate Hurricane / Thunder. " +
        `Recommended leads are scored against representative rain-side leads (${oppList || "Pelipper, Barraskewda"}). Field is rain. Bring leads that pressure the setter or that resist the rain-boosted Water/Electric attacks; Choice Scarf users are especially valuable to win speed once swimmers double.`
      );
    }
    if (field.weather === "sand") {
      return (
        "Sand archetype scenario. Sand teams pair a Sand Stream setter (Tyranitar, Hippowdon) with Sand Rush abusers (Excadrill) that double their speed in sand and benefit from the chip damage on non-Rock/Ground/Steel opponents. " +
        `Recommended leads are scored against representative sand-side leads (${oppList || "Tyranitar, Excadrill"}). Field is sand, ¹⁄₁₆ chip damage every turn for non-immune Pokémon, Rock-types get 1.5× SpD. Bring leads that resist the chip or that can break the setter on turn 1.`
      );
    }
    if (field.weather === "snow") {
      return (
        "Snow archetype scenario. Snow teams pair a Snow Warning setter (Ninetales-Alola, Vanilluxe, Abomasnow) with Slush Rush abusers and ice-type attackers. Aurora Veil is the load-bearing benefit — halves damage from both physical and special attacks while snow is up. " +
        `Recommended leads are scored against representative snow-side leads (${oppList || "Ninetales-Alola, Abomasnow"}). Field is snow, Ice-types get 1.5× Defense. Bring leads that can break Aurora Veil quickly (Brick Break, Defog) or that out-pressure the setter before it sets up.`
      );
    }
    if (field.trick_room) {
      return (
        "Trick Room archetype scenario. TR teams flip the speed order — slow attackers (base spe < 60) move first while fast Pokémon move last, for the 5 turns TR is active. " +
        `Recommended leads are scored against typical TR-side leads (${oppList || "Porygon2, Farigiraf"}). Field has Trick Room active. Bring leads that can KO the setter before it sets up, or that thrive in inverted speed (your slowest hitters become priority threats while their fast attackers are stranded).`
      );
    }
    if (name === "Perish Trap") {
      return (
        "Perish Trap archetype scenario. Mega Gengar's Shadow Tag locks the opponent into the field while a teammate (or Gengar itself) sets Perish Song — three turns later, every Pokémon on the field faints unless it switches out. The trap is to pin two attackers in then stall via Protect / Substitute while the counter ticks down. " +
        `Recommended leads are scored against the labmaus-attested setter pair (${oppList || "Gengar, Politoed"}). Bring fast offense that KOs the Shadow Tag user before it traps you, OR a teammate with U-turn / Volt Switch that can dodge the trap by triggering its own switch (the Pokémon that switched in is no longer trapped if Mega Gengar is KO'd before its next move). Status moves like Taunt also disable Perish Song.`
      );
    }
    return (
      `Archetype scenario "${name}". Tests how the team holds up against representative meta-core opposing leads (${oppList}). Use the recommended leads as a default opener; the backline pair covers second-pivots after one or both leads has answered the immediate threat.`
    );
  }
  if (type === "weakness_counter") {
    return (
      `Weakness-counter scenario. The detector flagged ${oppList || "an unnamed niche threat"} as a species that OHKOs ≥ 50% of your team's slots — a structural hole worth a contingency plan. ` +
      `The recommended leads are the team's best answer to this specific threat: typically a fast attacker that can KO before the threat moves, plus a teammate that absorbs a hit. Treat this scenario as a build-time signal: if you can't comfortably address it, consider swapping a slot.`
    );
  }
  if (type === "meta_team") {
    return (
      `Tournament-meta team scenario. ${name.replace(/^vs /, "")} is one of the most-frequent 6-species compositions appearing in Reg M-A tournament play — multiple teams have run this exact lineup at recent events. ` +
      `Recommended leads are scored against the two visible front-runners of the composition (${oppList}); the broader team includes the other 4 species that may rotate in. Treat this as a likely matchup at any open-bracket tournament; the more-frequent the composition, the higher the chance you face it.`
    );
  }
  if (type === "mirror_match") {
    return (
      `Mirror match scenario. Your team's 6-species composition matches one of the most-frequent tournament archetypes in current Reg M-A — you WILL face this exact lineup at open-bracket events. ` +
      `Both sides bring identical species; the matchup comes down to (a) lead prediction — guessing what your opponent leads and bringing the counter-lead, (b) item / SPS spread differences (your specific build may differ from theirs), and (c) turn-1 priority plays (Fake Out, Tailwind, Sucker Punch). Recommended leads are scored against the canonical labmaus consensus build of your own composition — the spread that the typical mirror runs. Bring leads that win the speed tier and KO their counterpart on turn 1.`
    );
  }
  // individual
  return (
    `Specific-opponent scenario versus ${oppList || "an individual top-usage threat"}. Tests the team's response when the opponent leads or threatens to bring this exact mon. The recommended leads optimize the matchup against this single species; the backline pair covers follow-up turns where the threat may switch out or be replaced.`
  );
}

/** Threat panel entry shape we read for archetype filtering — duck-typed
 *  so the function still works with `{}`-shaped test fixtures. */
type PanelEntryLike = {
  species_id?: string;
  set?: { ability?: string; moves?: ReadonlyArray<string>; item?: string };
};

/**
 * Pick the first N species ids from the threat panel; falls back to a small
 * Reg-M-A-legal seed when the panel is empty (test paths). Memory
 * `regulation_m_a_roster.md`: never hardcode SV/VGC species like
 * urshifu-rapid-strike, calyrex-shadow, iron-hands.
 *
 * @param panel — The curated threat panel.
 * @param n — Max ids to return.
 * @param seed — Fallback ids when the panel doesn't yield enough.
 * @param accept — Optional predicate to filter panel entries (e.g. "Drizzle
 *   ability for Rain"). When set, panel entries that fail the predicate
 *   are skipped before the seed is consulted.
 */
function previewFromPanel(
  panel: ThreatPanel,
  n: number,
  seed: ReadonlyArray<string>,
  accept?: (entry: PanelEntryLike) => boolean,
): string[] {
  const out: string[] = [];
  const entries = (panel as { entries?: ReadonlyArray<PanelEntryLike> }).entries ?? [];
  for (const e of entries) {
    if (!e.species_id) continue;
    if (accept && !accept(e)) continue;
    out.push(e.species_id);
    if (out.length >= n) break;
  }
  for (const s of seed) {
    if (out.length >= n) break;
    if (!out.includes(s)) out.push(s);
  }
  return out.slice(0, n);
}

const SUN_ABILITIES = new Set(["Drought", "Orichalcum Pulse"]);
const SUN_BENEFICIARIES = new Set(["Chlorophyll", "Solar Power", "Flower Gift"]);
const RAIN_ABILITIES = new Set(["Drizzle", "Primordial Sea"]);
const RAIN_BENEFICIARIES = new Set(["Swift Swim", "Rain Dish", "Hydration", "Dry Skin"]);
const SAND_ABILITIES = new Set(["Sand Stream", "Sand Spit"]);
const SAND_BENEFICIARIES = new Set(["Sand Rush", "Sand Force", "Sand Veil"]);
const SNOW_ABILITIES = new Set(["Snow Warning"]);
const SNOW_BENEFICIARIES = new Set(["Slush Rush", "Snow Cloak", "Ice Body"]);

function fitsArchetype(
  entry: PanelEntryLike,
  setterAbilities: ReadonlySet<string>,
  beneficiaryAbilities: ReadonlySet<string>,
): boolean {
  const a = entry.set?.ability ?? "";
  return setterAbilities.has(a) || beneficiaryAbilities.has(a);
}

function fitsTrickRoom(entry: PanelEntryLike): boolean {
  const moves = entry.set?.moves ?? [];
  return moves.some(
    (m) => m.toLowerCase().replace(/[^a-z]/g, "") === "trickroom",
  );
}

/**
 * Detect a Perish Trap setter from labmaus team_sets:
 *   any species with `Shadow Tag` ability and at least one teammate
 *   running `Perish Song`. Returns `[setter, perish_song_user]` or `null`.
 *
 * In current Reg M-A, Mega Gengar is the only Shadow Tag user; Politoed
 * and Gengar itself are top Perish Song movers (29 + 19 sets).
 */
function perishTrapFromLabmaus(db: Db): [string, string] | null {
  try {
    const setterRow = db.$client
      .prepare(
        `SELECT species_roster_id, COUNT(*) AS n
           FROM team_sets
          WHERE ability = 'Shadow Tag'
          GROUP BY species_roster_id
          ORDER BY n DESC LIMIT 1`,
      )
      .get() as { species_roster_id: string; n: number } | undefined;
    if (!setterRow) return null;
    // Pick the most-common Perish Song teammate sharing tournament_team_id.
    const songRow = db.$client
      .prepare(
        `SELECT t.species_roster_id AS partner, COUNT(DISTINCT t.tournament_team_id) AS shared
           FROM team_sets s
           JOIN team_sets t ON t.tournament_team_id = s.tournament_team_id
          WHERE s.species_roster_id = ?
            AND t.species_roster_id != ?
            AND t.moves_json LIKE '%Perish Song%'
          GROUP BY t.species_roster_id
          ORDER BY shared DESC LIMIT 1`,
      )
      .all(setterRow.species_roster_id, setterRow.species_roster_id) as Array<{ partner: string; shared: number }>;
    const partner = songRow[0]?.partner;
    if (partner) return [setterRow.species_roster_id, partner];
    // Fallback: setter itself runs Perish Song too (Gengar typically does).
    const selfPerish = db.$client
      .prepare(
        `SELECT 1 AS ok FROM team_sets
          WHERE species_roster_id = ? AND moves_json LIKE '%Perish Song%' LIMIT 1`,
      )
      .get(setterRow.species_roster_id) as { ok: number } | undefined;
    if (selfPerish) {
      // Pair the setter with its top tournament teammate (whatever they are).
      const tmRow = db.$client
        .prepare(
          `SELECT t.species_roster_id AS partner, COUNT(DISTINCT t.tournament_team_id) AS shared
             FROM team_sets s
             JOIN team_sets t ON t.tournament_team_id = s.tournament_team_id
            WHERE s.species_roster_id = ?
              AND t.species_roster_id != ?
            GROUP BY t.species_roster_id
            ORDER BY shared DESC LIMIT 1`,
        )
        .all(setterRow.species_roster_id, setterRow.species_roster_id) as Array<{ partner: string; shared: number }>;
      const tmPartner = tmRow[0]?.partner;
      if (tmPartner) return [setterRow.species_roster_id, tmPartner];
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Detect whether the user's 6-species composition matches a high-
 * frequency tournament cluster. Returns the matched cluster (with
 * frequency) when found — caller emits a `mirror_match` scenario so
 * the user knows they're on a meta team and will face mirrors.
 *
 * Threshold: ≥ 3 tournament teams running the same composition (after
 * mega-form normalization). Below 3 the user's team is unique enough
 * that mirror matches aren't probable.
 *
 * @param db — Open DB.
 * @param userSpecies — User's team species ids.
 * @returns `{ species, frequency }` of the matched cluster, or null.
 */
function findMirrorCluster(
  db: Db,
  userSpecies: ReadonlyArray<string>,
): { species: string[]; frequency: number } | null {
  if (userSpecies.length < 6) return null;
  const normalizeId = (id: string): string =>
    id
      .replace(/-(eternal|alola|galar|hisui|paldea(-\w+)?)$/, "")
      .replace(/(megax|megay|mega)$/, "");
  const userNormalized = new Set(userSpecies.map(normalizeId));
  try {
    const rows = db.$client
      .prepare(
        `WITH compositions AS (
           SELECT tournament_team_id, GROUP_CONCAT(species_roster_id, ',') AS species_set
             FROM (SELECT tournament_team_id, species_roster_id FROM team_sets ORDER BY species_roster_id)
            GROUP BY tournament_team_id
         )
         SELECT species_set, COUNT(*) AS team_count
           FROM compositions
          WHERE species_set NOT NULL
          GROUP BY species_set
         HAVING team_count >= 3
          ORDER BY team_count DESC LIMIT 50`,
      )
      .all() as Array<{ species_set: string; team_count: number }>;
    for (const r of rows) {
      const cluster = r.species_set.split(",");
      const clusterNormalized = new Set(cluster.map(normalizeId));
      let shared = 0;
      for (const n of userNormalized) if (clusterNormalized.has(n)) shared++;
      if (shared >= 6) return { species: cluster, frequency: r.team_count };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Find top-frequency 6-species tournament team compositions, excluding
 * any composition that's substantively the same as the user's own team
 * (≥ 5 of 6 species shared — handles the mega-form mismatch where the
 * user's team stores the pre-mega base id while labmaus stores the
 * battle-form id, e.g. floette-eternal vs floettemega).
 *
 * @param db — Open DB.
 * @param userSpecies — User's team species ids (base or mega form).
 * @param limit — Max compositions to return.
 * @returns Array of `{ species: [a,b,c,d,e,f], frequency }` clusters.
 */
function topMetaTeams(
  db: Db,
  userSpecies: ReadonlyArray<string>,
  limit: number,
): Array<{ species: string[]; frequency: number }> {
  try {
    const rows = db.$client
      .prepare(
        `WITH compositions AS (
           SELECT tournament_team_id, GROUP_CONCAT(species_roster_id, ',') AS species_set
             FROM (SELECT tournament_team_id, species_roster_id FROM team_sets ORDER BY species_roster_id)
            GROUP BY tournament_team_id
         )
         SELECT species_set, COUNT(*) AS team_count
           FROM compositions
          WHERE species_set NOT NULL
          GROUP BY species_set
         HAVING team_count >= 5
          ORDER BY team_count DESC LIMIT ?`,
      )
      .all(limit * 4) as Array<{ species_set: string; team_count: number }>;
    // Normalize user species: strip Mega-form-base equivalences. Treat
    // floette-eternal ≡ floettemega ≡ floette for similarity purposes.
    const normalizeId = (id: string): string =>
      id
        .replace(/-(eternal|alola|galar|hisui|paldea(-\w+)?)$/, "")
        .replace(/(megax|megay|mega)$/, "");
    const userNormalized = new Set(userSpecies.map(normalizeId));
    const matches: Array<{ species: string[]; frequency: number }> = [];
    for (const r of rows) {
      const cluster = r.species_set.split(",");
      const clusterNormalized = new Set(cluster.map(normalizeId));
      // Compute intersection size on normalized ids.
      let shared = 0;
      for (const n of userNormalized) if (clusterNormalized.has(n)) shared++;
      // Skip clusters that are substantively the user's own team
      // (5+ of 6 species shared after mega-form normalization).
      if (shared >= 5) continue;
      matches.push({ species: cluster, frequency: r.team_count });
      if (matches.length >= limit) break;
    }
    return matches;
  } catch {
    return [];
  }
}

/** Top-N species ids from `pikalytics_snapshots` ordered by `usage_percent
 *  DESC`. When `usage_percent` is null (current 8-snapshot data state),
 *  falls back to the natural row order. Returns `[]` on DB failure. */
function pikalyticsTopUsage(db: Db, n: number): string[] {
  try {
    const rows = db.$client
      .prepare(
        `SELECT species_roster_id FROM pikalytics_snapshots
          ORDER BY usage_percent DESC NULLS LAST, species_roster_id ASC
          LIMIT ?`,
      )
      .all(n) as Array<{ species_roster_id: string }>;
    return rows.map((r) => r.species_roster_id);
  } catch {
    return [];
  }
}

/** One row from `pikalytics_snapshots` joined to `species_abilities` —
 *  used by `archetypeFromPikalytics` to find real-meta setters/abusers. */
interface PikaArchetypeRow {
  species_id: string;
  ability_name: string;
  teammates_json: string;
}

/**
 * Build an archetype `opposing_preview` from real pikalytics data —
 * returns `[setter, top_co-occurring_teammate]` when the format actually
 * has a setter for this archetype; `null` when no setter species exists
 * in `pikalytics_snapshots`. Fallback handling is the caller's job.
 *
 * For Rain/Sand/Snow/TR: in the current 8-snapshot Reg M-A meta there
 * are no setters → returns null, scenario should be skipped rather than
 * faked with non-meta species (Barraskewda / Porygon2 / etc).
 *
 * @param db — Open DB handle.
 * @param archetype — `"sun" | "rain" | "sand" | "snow" | "trick_room"`.
 * @returns A 2-element preview or `null`.
 * @throws Never — DB errors swallowed (caller treats as "no data").
 */
function archetypeFromPikalytics(
  db: Db,
  archetype: "sun" | "rain" | "sand" | "snow" | "trick_room",
): [string, string] | null {
  let abilities: ReadonlySet<string>;
  let beneficiaries: ReadonlySet<string>;
  if (archetype === "sun") { abilities = SUN_ABILITIES; beneficiaries = SUN_BENEFICIARIES; }
  else if (archetype === "rain") { abilities = RAIN_ABILITIES; beneficiaries = RAIN_BENEFICIARIES; }
  else if (archetype === "sand") { abilities = SAND_ABILITIES; beneficiaries = SAND_BENEFICIARIES; }
  else if (archetype === "snow") { abilities = SNOW_ABILITIES; beneficiaries = SNOW_BENEFICIARIES; }
  else { abilities = new Set(); beneficiaries = new Set(); }

  try {
    let setter: PikaArchetypeRow | null = null;
    if (archetype === "trick_room") {
      // TR setters carry the move "Trick Room" in their pikalytics moves_json.
      const rows = db.$client
        .prepare(
          `SELECT species_roster_id AS species_id, '' AS ability_name, teammates_json, moves_json
             FROM pikalytics_snapshots`,
        )
        .all() as Array<PikaArchetypeRow & { moves_json: string }>;
      for (const r of rows) {
        let moves: Array<{ name?: string; move_id?: string }> = [];
        try {
          moves = JSON.parse(r.moves_json) as Array<{ name?: string; move_id?: string }>;
        } catch {
          continue;
        }
        const has = moves.some((m) => {
          const id = (m.name ?? m.move_id ?? "").toLowerCase().replace(/[^a-z]/g, "");
          return id === "trickroom";
        });
        if (has) {
          setter = r;
          break;
        }
      }
    } else {
      const placeholders = [...abilities].map(() => "?").join(",") || "''";
      const rows = db.$client
        .prepare(
          `SELECT ps.species_roster_id AS species_id, sa.ability_name, ps.teammates_json
             FROM pikalytics_snapshots ps
             JOIN species_abilities sa ON sa.species_id = ps.species_roster_id
            WHERE sa.ability_name IN (${placeholders})
            LIMIT 1`,
        )
        .all(...abilities) as PikaArchetypeRow[];
      setter = rows[0] ?? null;
    }
    if (!setter) return null;

    // Pick the highest-co-occurrence teammate. Optionally bias toward an
    // abuser (matching beneficiaries) but accept whoever's most-used since
    // the meta-relationship matters more than archetype theory.
    let teammates: Array<{ roster_id: string; percent: number }> = [];
    try {
      teammates = JSON.parse(setter.teammates_json) as Array<{ roster_id: string; percent: number }>;
    } catch {
      return null;
    }
    if (teammates.length === 0) return [setter.species_id, setter.species_id];
    // Pick the highest-co-occurrence teammate — that's the realistic
    // partner the setter is actually paired with in tournament play, not
    // a theoretical archetype-fitting abuser. (Earlier version filtered
    // by beneficiary ability; in practice that picked low-usage edge
    // cases over the meta truth.)
    const sorted = [...teammates].sort((a, b) => b.percent - a.percent);
    const top = sorted[0];
    if (!top) return [setter.species_id, setter.species_id];
    void beneficiaries; // intentional: not used for ranking, kept in scope so the ability table stays the source of truth for setter detection
    return [setter.species_id, top.roster_id];
  } catch {
    return null;
  }
}

/**
 * Fallback archetype lookup against labmaus tournament data when pikalytics
 * is sparse. Reads `team_sets` for the setter ability (or Trick Room move),
 * picks the most-common species, then finds its top teammate by counting
 * `tournament_team_id` co-occurrence across the entire tournament corpus.
 *
 * Returns `[setter, top_teammate]` when the labmaus corpus has data for
 * the archetype; `null` otherwise.
 *
 * Memory `regulation_m_a_roster.md`: every species id surfaced here comes
 * from real `team_sets` rows that are themselves Reg-M-A tournament data,
 * so legality is upheld transitively.
 */
function archetypeFromLabmaus(
  db: Db,
  archetype: "sun" | "rain" | "sand" | "snow" | "trick_room",
): [string, string] | null {
  let setter: string | null = null;
  try {
    if (archetype === "trick_room") {
      const rows = db.$client
        .prepare(
          `SELECT species_roster_id, COUNT(*) AS n
             FROM team_sets
            WHERE moves_json LIKE '%Trick Room%' OR moves_json LIKE '%trickroom%'
            GROUP BY species_roster_id
            ORDER BY n DESC
            LIMIT 1`,
        )
        .all() as Array<{ species_roster_id: string; n: number }>;
      setter = rows[0]?.species_roster_id ?? null;
    } else {
      let abilities: ReadonlySet<string>;
      if (archetype === "sun") abilities = SUN_ABILITIES;
      else if (archetype === "rain") abilities = RAIN_ABILITIES;
      else if (archetype === "sand") abilities = SAND_ABILITIES;
      else abilities = SNOW_ABILITIES;
      const ph = [...abilities].map(() => "?").join(",");
      const rows = db.$client
        .prepare(
          `SELECT species_roster_id, COUNT(*) AS n
             FROM team_sets
            WHERE ability IN (${ph})
            GROUP BY species_roster_id
            ORDER BY n DESC
            LIMIT 1`,
        )
        .all(...abilities) as Array<{ species_roster_id: string; n: number }>;
      setter = rows[0]?.species_roster_id ?? null;
    }
    if (!setter) return null;

    // Top teammate by tournament co-occurrence: count distinct team ids
    // where the setter and another species both appear.
    const teammateRows = db.$client
      .prepare(
        `SELECT t.species_roster_id AS teammate, COUNT(DISTINCT t.tournament_team_id) AS shared
           FROM team_sets t
           JOIN team_sets s ON s.tournament_team_id = t.tournament_team_id
          WHERE s.species_roster_id = ?
            AND t.species_roster_id != ?
          GROUP BY t.species_roster_id
          ORDER BY shared DESC
          LIMIT 1`,
      )
      .all(setter, setter) as Array<{ teammate: string; shared: number }>;
    const teammate = teammateRows[0]?.teammate;
    if (!teammate) return [setter, setter];
    return [setter, teammate];
  } catch {
    return null;
  }
}

/**
 * Produce 5–7 scenario skeletons.
 *
 * @param deps - DB handle, threat panel, team, calc cache + weakness tunable.
 * @returns Array of {@link ScenarioOverview} skeletons (length 5–7).
 * @throws TacticalScenarioError when fewer than 3 scenarios producible.
 */
export function generateScenarios(deps: ScenarioGenDeps): ScenarioOverview[] {
  // Archetype previews — REAL META sourced from pikalytics_snapshots
  // (setter ability + top co-occurring teammate). When the current meta
  // has no setter for an archetype (e.g. Rain in current Reg M-A), the
  // archetype scenario is DROPPED rather than faked with a hardcoded
  // species not in the meta. This is the honest signal — the user
  // shouldn't see "Rain" with Barraskewda when no one runs Barraskewda
  // in tournament play.
  //
  // Fallback for the 4 weather archetypes: when pikalytics returns null,
  // try the panel's archetype filter (in case the panel has data even if
  // pikalytics doesn't). If the panel also yields nothing, drop.
  // Source order per archetype: pikalytics_snapshots (has co-occurrence
  // baked in) → labmaus team_sets (8.7K tournament rows, ground truth
  // when pikalytics is sparse) → panel filter (synthetic fallback) → null.
  const archetypePreview = (
    archetype: "sun" | "rain" | "sand" | "snow" | "trick_room",
    panelAccept: (e: PanelEntryLike) => boolean,
  ): [string, string] | null => {
    const fromPika = archetypeFromPikalytics(deps.db, archetype);
    if (fromPika) return fromPika;
    const fromLabmaus = archetypeFromLabmaus(deps.db, archetype);
    if (fromLabmaus) return fromLabmaus;
    const p = previewFromPanel(deps.panel, 2, [], panelAccept);
    return p.length === 2 ? ([p[0], p[1]] as [string, string]) : null;
  };
  const sunPreview = archetypePreview("sun", (e) =>
    fitsArchetype(e, SUN_ABILITIES, SUN_BENEFICIARIES),
  );
  const rainPreview = archetypePreview("rain", (e) =>
    fitsArchetype(e, RAIN_ABILITIES, RAIN_BENEFICIARIES),
  );
  const sandPreview = archetypePreview("sand", (e) =>
    fitsArchetype(e, SAND_ABILITIES, SAND_BENEFICIARIES),
  );
  const snowPreview = archetypePreview("snow", (e) =>
    fitsArchetype(e, SNOW_ABILITIES, SNOW_BENEFICIARIES),
  );
  const trPreview = archetypePreview("trick_room", fitsTrickRoom);
  const archetypes: ScenarioOverview[] = [];
  if (sunPreview) {
    archetypes.push({
      name: "Sun",
      type: "archetype",
      field: FIELD_SUN,
      opposing_preview: [...sunPreview],
      description: describeScenario("Sun", "archetype", FIELD_SUN, [...sunPreview]),
      ...PLACEHOLDER,
    });
  }
  if (rainPreview) {
    archetypes.push({
      name: "Rain",
      type: "archetype",
      field: FIELD_RAIN,
      opposing_preview: [...rainPreview],
      description: describeScenario("Rain", "archetype", FIELD_RAIN, [...rainPreview]),
      ...PLACEHOLDER,
    });
  }
  if (sandPreview) {
    archetypes.push({
      name: "Sand",
      type: "archetype",
      field: FIELD_SAND,
      opposing_preview: [...sandPreview],
      description: describeScenario("Sand", "archetype", FIELD_SAND, [...sandPreview]),
      ...PLACEHOLDER,
    });
  }
  if (snowPreview) {
    archetypes.push({
      name: "Snow",
      type: "archetype",
      field: FIELD_SNOW,
      opposing_preview: [...snowPreview],
      description: describeScenario("Snow", "archetype", FIELD_SNOW, [...snowPreview]),
      ...PLACEHOLDER,
    });
  }
  if (trPreview) {
    archetypes.push({
      name: "Trick Room",
      type: "archetype",
      field: FIELD_TR,
      opposing_preview: [...trPreview],
      description: describeScenario("Trick Room", "archetype", FIELD_TR, [...trPreview]),
      ...PLACEHOLDER,
    });
  }
  // Perish Trap (Mega Gengar Shadow Tag + Perish Song teammate). Only
  // emits when labmaus has both a Shadow Tag user AND a Perish Song
  // teammate in the same tournament team.
  const perishPreview = perishTrapFromLabmaus(deps.db);
  if (perishPreview) {
    archetypes.push({
      name: "Perish Trap",
      type: "archetype",
      field: FIELD_NEUTRAL,
      opposing_preview: [...perishPreview],
      description: describeScenario("Perish Trap", "archetype", FIELD_NEUTRAL, [...perishPreview]),
      ...PLACEHOLDER,
    });
  }

  // Individual scenarios — backfill to compensate when archetypes are
  // sparse (e.g. current Reg M-A meta has only Sun via Charizard-Mega-Y;
  // no Drizzle / Sand / Snow / TR setters in the snapshotted species).
  // Target: 2 individuals when 3+ archetypes present, up to 5 when 0-1.
  const individualTarget = Math.max(2, 5 - archetypes.length);
  // Reg-M-A-legal fallback shortlist (used only when both pikalytics + panel
  // are empty — tests and fresh DBs). Memory `regulation_m_a_roster.md`:
  // every name here must exist in the Reg M-A roster.
  const FALLBACK_INDIV_SEED = [
    "incineroar", "amoonguss", "rillaboom", "garchomp", "pelipper",
  ];
  // Order: real meta from pikalytics first, then panel (which may include
  // synthetic-but-not-meta entries), then hardcoded fallback. Pikalytics-
  // first ensures Tyranitar/Whimsicott don't surface as "individual top
  // threats" when current Reg M-A doesn't have them snapshotted.
  const pikaTop = pikalyticsTopUsage(deps.db, individualTarget);
  const seenIndiv = new Set<string>(pikaTop);
  const panelFill = previewFromPanel(
    deps.panel,
    individualTarget,
    FALLBACK_INDIV_SEED,
  ).filter((s) => !seenIndiv.has(s));
  const individualSeeds = [
    ...pikaTop,
    ...panelFill,
  ].slice(0, individualTarget);
  const individuals: ScenarioOverview[] = individualSeeds
    .slice(0, individualTarget)
    .map((sp) => ({
      name: `vs ${sp}`,
      type: "individual" as const,
      field: FIELD_NEUTRAL,
      opposing_preview: [sp],
      description: describeScenario(`vs ${sp}`, "individual", FIELD_NEUTRAL, [sp]),
      ...PLACEHOLDER,
    }));

  const counters = detectWeaknessCounters(deps.team, deps.panel, deps.calcCache, {
    db: deps.db,
    scoring_team: deps.scoring_team,
    weakness_ohko_ratio: deps.weakness_ohko_ratio,
  });
  const counterScenarios: ScenarioOverview[] = counters.slice(0, 2).map((c) => ({
    name: `vs ${c.species_id} (counter)`,
    type: "weakness_counter" as const,
    field: FIELD_NEUTRAL,
    opposing_preview: [c.species_id],
    description: describeScenario(
      `vs ${c.species_id} (counter)`,
      "weakness_counter",
      FIELD_NEUTRAL,
      [c.species_id],
    ),
    ...PLACEHOLDER,
  }));

  // Tournament-meta team scenarios — top-frequency 6-species compositions
  // from labmaus tournament_teams. Exclude the user's own composition so
  // they don't see "vs your team." When the slice runs short on archetypes
  // (≤ 2), surface up to 2 meta-team scenarios so the user gets exposure
  // to the actual tournament archetypes they'll face.
  const userSpecies = deps.scoring_team
    ? deps.scoring_team.sets.map((s) => s.species_roster_id)
    : [];
  // Mirror match — detect whether user's composition matches a high-
  // frequency tournament cluster (≥ 3 teams running the same 6 species
  // after mega-form normalization). If so, emit before meta_team so the
  // user sees "you're on a meta team, expect mirrors" up front.
  const mirrorCluster = findMirrorCluster(deps.db, userSpecies);
  const mirrorScenarios: ScenarioOverview[] = [];
  if (mirrorCluster) {
    const preview: [string, string] = [
      mirrorCluster.species[0] ?? "incineroar",
      mirrorCluster.species[1] ?? "garchomp",
    ];
    const name = `Mirror match (${mirrorCluster.frequency}× tournament-meta team)`;
    mirrorScenarios.push({
      name,
      type: "mirror_match" as const,
      field: FIELD_NEUTRAL,
      opposing_preview: mirrorCluster.species.slice(0, 6),
      description: describeScenario(name, "mirror_match", FIELD_NEUTRAL, mirrorCluster.species),
      ...PLACEHOLDER,
      // Use a slightly different placeholder preview hint by overriding
      // recommended_leads via PLACEHOLDER spread (recommendLeads will
      // overwrite at orchestration time).
      recommended_leads: [preview[0], preview[1]] as [string, string],
    });
  }
  const metaTeamLimit = archetypes.length <= 2 ? 3 : 2;
  const metaTeams = topMetaTeams(deps.db, userSpecies, metaTeamLimit);
  const metaTeamScenarios: ScenarioOverview[] = metaTeams.map((cluster) => {
    // Top 2 species by labmaus tournament-frequency become the visible
    // opposing leads. (For now: arbitrary top-2 from the sorted set; a
    // future pass could rank by intra-cluster usage.)
    const preview: [string, string] = [
      cluster.species[0] ?? "incineroar",
      cluster.species[1] ?? "garchomp",
    ];
    // Name the scenario after the two visible leads + the team-frequency
    // count, e.g. "vs Pelipper+Sinistcha core (24×)".
    const name = `vs ${preview[0]} + ${preview[1]} core (${cluster.frequency}×)`;
    return {
      name,
      type: "meta_team" as const,
      field: FIELD_NEUTRAL,
      opposing_preview: cluster.species.slice(0, 6),
      description: describeScenario(name, "meta_team", FIELD_NEUTRAL, cluster.species),
      ...PLACEHOLDER,
    };
  });

  const all = [
    ...archetypes,
    ...mirrorScenarios,
    ...metaTeamScenarios,
    ...individuals,
    ...counterScenarios,
  ];
  // Trim to max 10 (was 7 before adding Perish Trap + meta_team scenarios).
  const trimmed = all.slice(0, 10);
  if (trimmed.length < 3) {
    throw new TacticalScenarioError("Insufficient data to generate ≥ 3 scenarios");
  }
  return trimmed;
}
