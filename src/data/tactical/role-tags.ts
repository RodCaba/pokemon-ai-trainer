/**
 * Deterministic role classifier per plan §3.1 (Stage A of `team-support-pillar`).
 *
 * One pure function per set: `(item, ability, moves, base_stats) → RoleTagAssignment`.
 * No DB lookups, no Anthropic calls, no `damage_calc`. The full rule table
 * + priority order is documented inline so the file is self-contained for
 * code review.
 *
 * Reg-M-A note (memory `regulation_m_a_no_tera.md`): no rule mentions Tera.
 */

import type { RoleTag, RoleTagAssignment, WeatherKind } from "../../schemas/tactical";

/** Per-set inputs for {@link deriveRoleTags}. */
export interface RoleTagInput {
  species_id: string;
  item: string | null;
  ability: string | null;
  moves: readonly string[];
  base_stats: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
}

/** Injection slots — currently just a logger for the data-error path. */
export interface DeriveRoleTagsDeps {
  logWarn: (message: string) => void;
}

// ----- Rule tables (display-name forms, lowercased + space/hyphen-normalized) -----

const SCREEN_MOVES = ["reflect", "light screen", "aurora veil"];
const SPEED_CONTROL_MOVES = ["trick room", "tailwind"];
const WEATHER_MOVES = ["rain dance", "sunny day", "sandstorm", "snowscape"];
const WEATHER_ABILITIES = ["drizzle", "drought", "sand stream", "snow warning"];
const REDIRECT_MOVES = ["rage powder", "follow me"];
const CLERIC_MOVES = ["life dew", "pollen puff", "wish", "heal pulse", "floral healing"];
const CLERIC_ABILITIES = ["hospitality"];
// Q1 binding: Wide Guard / Quick Guard fold under disruptor.
const DISRUPTOR_MOVES = [
  "encore", "quash", "taunt", "disable", "yawn", "spore",
  "sleep powder", "stun spore", "will-o-wisp",
  "icy wind", "electroweb", "bulldoze",
  "wide guard", "quick guard",
];
const PIVOT_MOVES = [
  "u-turn", "volt switch", "flip turn", "parting shot", "teleport", "baton pass",
];
// Q2 binding: Scale Shot, Meteor Beam are setup_sweeper triggers.
const SETUP_MOVES = [
  "dragon dance", "swords dance", "nasty plot", "calm mind", "bulk up",
  "iron defense", "coil", "quiver dance", "shell smash", "curse",
  "cosmic power", "belly drum",
  "scale shot", "meteor beam",
];
const SETUP_ABILITIES = ["stamina", "defiant", "justified", "beast boost"];
const ANTI_PRIORITY_ABILITIES = ["armor tail", "dazzling", "queenly majesty"];

// Weather sub-classification (Q12(c) plan-deferred → shipped here):
// which weather a `weather_setter` brings, and which weather a charging
// move's charge-skip condition requires.
const WEATHER_MOVE_TO_KIND: Record<string, WeatherKind> = {
  "rain dance": "rain",
  "sunny day": "sun",
  "sandstorm": "sand",
  "snowscape": "snow",
};
const WEATHER_ABILITY_TO_KIND: Record<string, WeatherKind> = {
  "drizzle": "rain",
  "drought": "sun",
  "sand stream": "sand",
  "snow warning": "snow",
};
/** Charging moves whose 2-turn cost is bypassed under the named weather.
 *  Conservative list — "incidentally rain-buffed" moves like Hurricane and
 *  Thunder are excluded because they're useful outside rain too. The bar
 *  is: would the user FEEL the move was wasted when paired with the
 *  wrong weather (or no weather)? Electro Shot, Solar Beam, Solar Blade
 *  meet that bar; Hurricane / Thunder don't. */
const CHARGING_MOVE_TO_WEATHER: Record<string, WeatherKind> = {
  "electro shot": "rain",
  "solar beam": "sun",
  "solar blade": "sun",
};

const SUPPORT_MOVES_ALL = new Set<string>([
  ...SCREEN_MOVES, ...SPEED_CONTROL_MOVES, ...WEATHER_MOVES,
  ...REDIRECT_MOVES, ...CLERIC_MOVES, ...DISRUPTOR_MOVES, ...PIVOT_MOVES,
  ...SETUP_MOVES, "protect", "detect",
]);

/**
 * Priority for `primary` selection (plan §3.1, with speed_control_setter
 * promoted ABOVE screen_setter to match the Whimsicott golden — Tailwind
 * is the player-recognized primary for screens-plus-speed Prankster sets;
 * see plan §17 Q1 for the rationale). Lower index = higher priority.
 * `untagged` is the sentinel — never appears alongside a real tag.
 */
const TAG_PRIORITY: readonly RoleTag[] = [
  "weather_setter",
  "speed_control_setter",
  "screen_setter",
  "redirect",
  "cleric",
  "setup_sweeper",
  "cleaner",
  "wallbreaker",
  "pivot",
  "disruptor",
  "anti_priority",
];

function norm(s: string): string {
  return s.trim().toLowerCase();
}

const containsAny = (set: ReadonlySet<string>, list: readonly string[]): boolean =>
  list.some((needle) => set.has(needle));

/**
 * Classify one set into a {@link RoleTagAssignment}.
 *
 * **When to use it:** team-level role classification (Stage A pipeline)
 * calls this once per saved set; the support pillar + pair scorer +
 * synergy extension all read from the resulting map.
 *
 * @param input - Per-set features.
 * @param deps - Logger injection.
 * @returns Assignment with `primary` + `all` (sorted by priority).
 * @throws Never (data errors are logged + return `untagged`).
 */
export function deriveRoleTags(
  input: RoleTagInput,
  deps: DeriveRoleTagsDeps,
): RoleTagAssignment {
  // Defensive: drop nullish/empty move slots and warn — partial sets exist
  // for in-flight drafts but should never reach the classifier.
  const moveSet = new Set<string>();
  let sawInvalidMove = false;
  for (const m of input.moves) {
    if (m === null || m === undefined || typeof m !== "string" || m.length === 0) {
      sawInvalidMove = true;
      continue;
    }
    moveSet.add(norm(m));
  }
  if (sawInvalidMove) {
    deps.logWarn(
      `[role-classifier] invalid move ref on ${input.species_id} — falling back to untagged`,
    );
    return { primary: "untagged", all: ["untagged"] };
  }

  const ability = input.ability !== null ? norm(input.ability) : null;
  const item = input.item !== null ? input.item.trim() : null;

  const tags: RoleTag[] = [];

  // ----- Setter sub-tags (Q2: split into three) -----
  if (containsAny(moveSet, WEATHER_MOVES) ||
      (ability !== null && WEATHER_ABILITIES.includes(ability))) {
    tags.push("weather_setter");
  }
  if (containsAny(moveSet, SCREEN_MOVES)) tags.push("screen_setter");
  if (containsAny(moveSet, SPEED_CONTROL_MOVES)) tags.push("speed_control_setter");

  // ----- Other support roles -----
  if (containsAny(moveSet, REDIRECT_MOVES)) tags.push("redirect");
  if (containsAny(moveSet, CLERIC_MOVES) ||
      (ability !== null && CLERIC_ABILITIES.includes(ability))) {
    tags.push("cleric");
  }

  // ----- Setup sweeper (move OR ability) -----
  const hasSetupMove = containsAny(moveSet, SETUP_MOVES);
  if (hasSetupMove ||
      (ability !== null && SETUP_ABILITIES.includes(ability))) {
    tags.push("setup_sweeper");
  }

  // ----- Cleaner (Choice Scarf + spe ≥ 90) -----
  const isScarf = item !== null && item.toLowerCase() === "choice scarf";
  if (isScarf && input.base_stats.spe >= 90 && hasAnyDamagingMove(moveSet)) {
    tags.push("cleaner");
  }

  // ----- Wallbreaker -----
  // Only fires when NO setter / sweeper / cleric / redirect / cleaner /
  // anti_priority tag has matched — wallbreaker is the "pure attacker"
  // fallback, not a co-tag with setup_sweeper or any setter sub-tag.
  // Pivot + disruptor co-presence is allowed because both are utility
  // moves that don't substitute for the role.
  const hasOtherStructuralTag = tags.some((t) =>
    t === "weather_setter" || t === "speed_control_setter" || t === "screen_setter" ||
    t === "redirect" || t === "cleric" || t === "setup_sweeper" || t === "cleaner",
  );
  if (!isScarf && !hasSetupMove && !hasOtherStructuralTag &&
      damagingMoveCount(moveSet) >= 2 &&
      (input.base_stats.atk >= 110 || input.base_stats.spa >= 110)) {
    tags.push("wallbreaker");
  }

  // ----- Pivot -----
  if (containsAny(moveSet, PIVOT_MOVES)) tags.push("pivot");

  // ----- Disruptor -----
  if (containsAny(moveSet, DISRUPTOR_MOVES)) tags.push("disruptor");

  // ----- Anti-priority (ability) -----
  if (ability !== null && ANTI_PRIORITY_ABILITIES.includes(ability)) {
    tags.push("anti_priority");
  }

  // Detect weather pairing data (independent of role tag presence).
  let weather_provided: WeatherKind | undefined;
  for (const m of moveSet) {
    const k = WEATHER_MOVE_TO_KIND[m];
    if (k !== undefined) { weather_provided = k; break; }
  }
  if (weather_provided === undefined && ability !== null) {
    const k = WEATHER_ABILITY_TO_KIND[ability];
    if (k !== undefined) weather_provided = k;
  }
  let weather_dependency: WeatherKind | undefined;
  for (const m of moveSet) {
    const k = CHARGING_MOVE_TO_WEATHER[m];
    if (k !== undefined) { weather_dependency = k; break; }
  }

  if (tags.length === 0) {
    return {
      primary: "untagged",
      all: ["untagged"],
      ...(weather_provided !== undefined ? { weather_provided } : {}),
      ...(weather_dependency !== undefined ? { weather_dependency } : {}),
    };
  }

  const sorted = sortByPriority(tags);
  return {
    primary: sorted[0]!,
    all: sorted,
    ...(weather_provided !== undefined ? { weather_provided } : {}),
    ...(weather_dependency !== undefined ? { weather_dependency } : {}),
  };
}

function damagingMoveCount(moveSet: ReadonlySet<string>): number {
  let n = 0;
  for (const m of moveSet) if (!SUPPORT_MOVES_ALL.has(m)) n++;
  return n;
}

function hasAnyDamagingMove(moveSet: ReadonlySet<string>): boolean {
  for (const m of moveSet) if (!SUPPORT_MOVES_ALL.has(m)) return true;
  return false;
}

function sortByPriority(tags: readonly RoleTag[]): RoleTag[] {
  // Dedupe + sort by priority index. Stable: tags not in the priority list
  // (shouldn't happen, but defensive) go to the end.
  const seen = new Set<RoleTag>();
  const out: RoleTag[] = [];
  for (const p of TAG_PRIORITY) {
    if (tags.includes(p) && !seen.has(p)) {
      out.push(p);
      seen.add(p);
    }
  }
  return out;
}

/** Convenience: classify every set on a saved team and return the map. */
export function deriveTeamRoleTags(
  inputs: ReadonlyArray<RoleTagInput>,
  deps: DeriveRoleTagsDeps,
): Map<string, RoleTagAssignment> {
  const map = new Map<string, RoleTagAssignment>();
  for (const input of inputs) {
    map.set(input.species_id, deriveRoleTags(input, deps));
  }
  return map;
}
