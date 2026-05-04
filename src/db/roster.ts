import { and, asc, eq, placeholder, sql } from "drizzle-orm";
import type { Db } from "./open";
import { rosterMembership, sampleSets, species, speciesAbilities, speciesStats } from "./drizzle-schema";
import type { Pokemon, RosterEntry, SearchHit } from "../schemas/pokemon";
import { PokemonSchema } from "../schemas/pokemon";
import type { SampleSet } from "../schemas/sampleSet";
import { SampleSetSchema } from "../schemas/sampleSet";
import { RosterDataError, RosterDbError } from "../schemas/errors";
import { toCanonicalId } from "./simple-repo";

// ---- prepared-statement cache (per-Db) ------------------------------------
// Drizzle compiles SQL once but `prepare()` returns a reusable statement that
// avoids re-walking the AST per call. We cache one bundle per Db handle in a
// WeakMap so closing the handle drops the cache automatically.

interface Prepared {
  speciesById: ReturnType<typeof buildSpeciesById>;
  speciesByDisplayName: ReturnType<typeof buildSpeciesByDisplayName>;
  speciesByAlias: ReturnType<typeof buildSpeciesByAlias>;
  statsById: ReturnType<typeof buildStatsById>;
  abilitiesById: ReturnType<typeof buildAbilitiesById>;
  setsById: ReturnType<typeof buildSetsById>;
  rosterList: ReturnType<typeof buildRosterList>;
  searchCandidates: ReturnType<typeof buildSearchCandidates>;
}

const PREPARED_CACHE = new WeakMap<Db, Prepared>();

function bundle(db: Db): Prepared {
  let p = PREPARED_CACHE.get(db);
  if (!p) {
    p = {
      speciesById: buildSpeciesById(db),
      speciesByDisplayName: buildSpeciesByDisplayName(db),
      speciesByAlias: buildSpeciesByAlias(db),
      statsById: buildStatsById(db),
      abilitiesById: buildAbilitiesById(db),
      setsById: buildSetsById(db),
      rosterList: buildRosterList(db),
      searchCandidates: buildSearchCandidates(db),
    };
    PREPARED_CACHE.set(db, p);
  }
  return p;
}

const SPECIES_COLUMNS = {
  id: species.id,
  display_name: species.displayName,
  form_id: species.formId,
  is_mega: species.isMega,
  types_json: species.types,
  weight_kg: species.weightKg,
  aliases_json: species.aliases,
  movepool_json: species.movepool,
  source_json: species.sourceJson,
} as const;

function buildSpeciesById(db: Db) {
  return db
    .select(SPECIES_COLUMNS)
    .from(species)
    .innerJoin(rosterMembership, eq(species.id, rosterMembership.speciesId))
    .where(
      and(
        eq(species.id, placeholder("id")),
        eq(rosterMembership.format, placeholder("format")),
        eq(rosterMembership.isLegal, 1),
      ),
    )
    .prepare();
}

function buildSpeciesByDisplayName(db: Db) {
  return db
    .select(SPECIES_COLUMNS)
    .from(species)
    .innerJoin(rosterMembership, eq(species.id, rosterMembership.speciesId))
    .where(
      and(
        sql`${species.displayName} = ${placeholder("name")} COLLATE NOCASE`,
        eq(rosterMembership.format, placeholder("format")),
        eq(rosterMembership.isLegal, 1),
      ),
    )
    .prepare();
}

function buildSpeciesByAlias(db: Db) {
  return db
    .select(SPECIES_COLUMNS)
    .from(species)
    .innerJoin(rosterMembership, eq(species.id, rosterMembership.speciesId))
    .where(
      and(
        sql`EXISTS (SELECT 1 FROM json_each(${species.aliases}) WHERE LOWER(value) = LOWER(${placeholder("name")}))`,
        eq(rosterMembership.format, placeholder("format")),
        eq(rosterMembership.isLegal, 1),
      ),
    )
    .prepare();
}

function buildStatsById(db: Db) {
  return db
    .select()
    .from(speciesStats)
    .where(eq(speciesStats.speciesId, placeholder("id")))
    .prepare();
}

function buildAbilitiesById(db: Db) {
  return db
    .select()
    .from(speciesAbilities)
    .where(eq(speciesAbilities.speciesId, placeholder("id")))
    .prepare();
}

function buildSetsById(db: Db) {
  return db
    .select()
    .from(sampleSets)
    .where(eq(sampleSets.speciesId, placeholder("id")))
    .prepare();
}

function buildRosterList(db: Db) {
  return db
    .select({
      id: species.id,
      display_name: species.displayName,
      is_mega: rosterMembership.isMega,
    })
    .from(species)
    .innerJoin(rosterMembership, eq(species.id, rosterMembership.speciesId))
    .where(and(eq(rosterMembership.format, placeholder("format")), eq(rosterMembership.isLegal, 1)))
    .orderBy(asc(species.id))
    .prepare();
}

function buildSearchCandidates(db: Db) {
  return db
    .select({
      id: species.id,
      display_name: species.displayName,
      aliases_json: species.aliases,
    })
    .from(species)
    .innerJoin(rosterMembership, eq(species.id, rosterMembership.speciesId))
    .where(and(eq(rosterMembership.format, placeholder("format")), eq(rosterMembership.isLegal, 1)))
    .prepare();
}

/**
 * Lists every species legal in the given format, ordered by canonical id.
 *
 * **When to use it:** populating a roster picker, computing coverage stats,
 * iterating over the entire format for batch validation. For "is X legal?" use
 * `has()` (single-row indexed lookup) instead.
 *
 * @param db — Open Drizzle DB handle (readonly is fine).
 * @param format — Format literal — only `"RegM-A"` is supported in v1.
 * @returns Array of `RosterEntry`. Empty array if no rows match (never `null`).
 * @throws {RosterDbError} On any underlying SQLite I/O failure.
 *
 * @example
 *   const all = list(db, "RegM-A"); // RosterEntry[]
 *   console.log(`${all.length} legal species`);
 */
export function list(db: Db, format: "RegM-A"): RosterEntry[] {
  try {
    const rows = bundle(db).rosterList.all({ format });
    return rows.map((r) => ({
      id: r.id,
      display_name: r.display_name,
      is_mega: r.is_mega === 1,
      format,
    }));
  } catch (e) {
    throw new RosterDbError("roster.list failed", { cause: e, query: { format } });
  }
}

/**
 * Looks up a species by Showdown id, display name, or alias. Case-insensitive.
 *
 * **When to use it:** resolve user input (or any stored species reference) to a
 * canonical Pokemon record. For fuzzy / typo-tolerant matches use `search()`.
 * For a boolean-only check use `has()`.
 *
 * Lookup order:
 *   1. Exact match on `species.id` (after lowercasing + stripping spaces/hyphens).
 *   2. Case-insensitive match on `species.display_name`.
 *   3. JSON-array `aliases` membership (case-insensitive).
 *
 * If multiple forms match by display name (e.g. base "Slowbro" vs. "Slowbro-Galar"),
 * the row whose `form_id IS NULL` (base form) wins.
 *
 * @param db — Open Drizzle DB handle.
 * @param name — Any of: Showdown id ("garchomp"), display name ("Garchomp"), or
 *   a registered alias. Whitespace is trimmed; case is ignored.
 * @param format — `"RegM-A"`.
 * @returns The full `Pokemon` record (zod-validated), or `null` if no match.
 * @throws {RosterDbError} On SQLite I/O failure.
 * @throws {RosterDataError} If a stored row fails schema validation
 *   (indicates DB corruption, not caller error).
 *
 * @example
 *   const p = get(db, "Garchomp", "RegM-A");
 *   if (!p) throw new Error("not in Reg M-A");
 *   console.log(p.base_stats.spe); // 102
 */
export function get(db: Db, name: string, format: "RegM-A"): Pokemon | null {
  const trimmed = name.trim();
  if (trimmed === "") return null;

  let speciesRow: SpeciesRow | undefined;
  try {
    speciesRow = findSpeciesRow(db, trimmed, format);
  } catch (e) {
    throw new RosterDbError("roster.get failed", { cause: e, query: { name, format } });
  }

  if (!speciesRow) return null;
  try {
    return assemblePokemon(db, speciesRow);
  } catch (e) {
    if (e instanceof RosterDataError) throw e;
    throw new RosterDbError("roster.get assembly failed", { cause: e, query: { name, format } });
  }
}

/**
 * Boolean legality check.
 *
 * **When to use it:** quick "is this legal?" without paying the cost of fetching
 * the full Pokemon record. For the record itself use `get()`.
 *
 * @param db — Open Drizzle DB handle.
 * @param name — Same lookup rules as `get()` (canonical id, case-insensitive
 *   display name, or alias).
 * @param format — `"RegM-A"`.
 * @returns `true` iff the species exists in `roster_membership` with `is_legal = 1`.
 * @throws {RosterDbError} On SQLite I/O failure.
 *
 * @example
 *   has(db, "Garchomp", "RegM-A");  // true
 *   has(db, "Mewtwo",   "RegM-A");  // false
 *   has(db, "chomp",    "RegM-A");  // true (via alias)
 */
export function has(db: Db, name: string, format: "RegM-A"): boolean {
  const trimmed = name.trim();
  if (trimmed === "") return false;

  try {
    const p = bundle(db);
    if (p.speciesById.get({ id: toCanonicalId(trimmed), format })) return true;
    // .get() (not .all()) — for existence we don't need to materialize the array.
    if (p.speciesByDisplayName.get({ name: trimmed, format })) return true;
    if (p.speciesByAlias.get({ name: trimmed, format })) return true;
    return false;
  } catch (e) {
    throw new RosterDbError("roster.has failed", { cause: e, query: { name, format } });
  }
}

/**
 * Fuzzy search by partial id / display name / alias. Returns ranked hits.
 *
 * **When to use it:** the team-builder UI's "did you mean…?" suggestion when an
 * exact lookup misses. For exact lookups use `get()`.
 *
 * Scoring (0–1, higher is better):
 * - Exact match → 1.0
 * - Prefix match (candidate starts with query) → 0.7 + 0.3 × (queryLen / candLen)
 * - Substring match → 0.4 + 0.4 × (queryLen / candLen)
 * - Levenshtein fallback → 1 − distance / max(queryLen, candLen)
 *
 * For each species the score is computed against `id`, `display_name`, and every
 * `alias`; the highest-scoring source wins and is reported in `matched_on`.
 *
 * @param db — Open Drizzle DB handle.
 * @param query — Partial string; min length 1; whitespace trimmed.
 * @param format — `"RegM-A"`.
 * @returns Up to 10 `SearchHit`s sorted by descending score. Empty array if no
 *   candidate scores ≥ 0.3.
 * @throws {RosterDbError} On SQLite I/O failure.
 *
 * @example
 *   search(db, "garcha", "RegM-A");   // [{id:"garchomp", score:0.92, matched_on:"id"}, ...]
 *   search(db, "xyz123", "RegM-A");   // []  (no candidate ≥ 0.3)
 */
export function search(db: Db, query: string, format: "RegM-A"): SearchHit[] {
  const trimmed = query.trim();
  if (trimmed === "") return [];

  let candidates: Array<{ id: string; display_name: string; aliases_json: string }>;
  try {
    candidates = bundle(db).searchCandidates.all({ format }) as Array<{
      id: string;
      display_name: string;
      aliases_json: string;
    }>;
  } catch (e) {
    throw new RosterDbError("roster.search failed", { cause: e, query: { query, format } });
  }

  const hits: SearchHit[] = [];
  for (const c of candidates) {
    const aliases = JSON.parse(c.aliases_json) as string[];
    const scored = bestMatch(trimmed, c.id, c.display_name, aliases);
    if (scored && scored.score >= SEARCH_MIN_SCORE) {
      hits.push({
        id: c.id,
        display_name: c.display_name,
        score: scored.score,
        matched_on: scored.matched_on,
      });
    }
  }

  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, SEARCH_MAX_HITS);
}

const SEARCH_MIN_SCORE = 0.3;
const SEARCH_MAX_HITS = 10;

interface ScoredMatch {
  score: number;
  matched_on: SearchHit["matched_on"];
}

interface InternalScoredMatch extends ScoredMatch {
  verbatim: boolean;
}

function bestMatch(
  query: string,
  id: string,
  displayName: string,
  aliases: string[],
): ScoredMatch | null {
  // Tiebreak rule: when scores are equal, prefer the source whose RAW value
  // (case-sensitive, separators preserved) matches the query verbatim. That
  // captures user intent — "Garchomp" → display_name, "garchompmega" → id,
  // "chomp" → alias.
  const candidates: InternalScoredMatch[] = [];
  candidates.push({ score: scoreOne(query, id), matched_on: "id", verbatim: query === id });
  candidates.push({ score: scoreOne(query, displayName), matched_on: "display_name", verbatim: query === displayName });
  for (const alias of aliases) {
    candidates.push({ score: scoreOne(query, alias), matched_on: "alias", verbatim: query === alias });
  }
  let best: InternalScoredMatch | null = null;
  for (const c of candidates) {
    if (!best) { best = c; continue; }
    if (c.score > best.score) { best = c; continue; }
    if (c.score === best.score && c.verbatim && !best.verbatim) best = c;
  }
  if (!best) return null;
  return { score: best.score, matched_on: best.matched_on };
}

function scoreOne(query: string, candidate: string): number {
  const q = query.toLowerCase().replace(/[^a-z0-9]/g, "");
  const c = candidate.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (q === "" || c === "") return 0;
  if (q === c) return 1.0;
  if (c.startsWith(q)) return 0.7 + 0.3 * (q.length / c.length);
  if (c.includes(q)) return 0.4 + 0.4 * (q.length / c.length);
  const dist = levenshtein(q, c);
  const len = Math.max(q.length, c.length);
  return Math.max(0, 1 - dist / len);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  // Two-row dynamic programming.
  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        (curr[j - 1] ?? 0) + 1,
        (prev[j] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost,
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length] ?? 0;
}

/**
 * Returns Smogon-curated sample sets for a species (may be empty).
 *
 * **When to use it:** seed the team-builder with proven builds; provide reference
 * sets to the lead planner.
 *
 * @param db — Open Drizzle DB handle.
 * @param name — Same lookup rules as `get()`.
 * @param format — `"RegM-A"`.
 * @returns Array of `SampleSet` (zod-validated). Empty array if the species
 *   exists but has no sample sets in `SETDEX_CHAMPIONS`.
 * @throws {RosterDataError} If the species itself is unknown.
 * @throws {RosterDbError} On SQLite I/O failure.
 */
export function sets(db: Db, name: string, format: "RegM-A"): SampleSet[] {
  const trimmed = name.trim();
  if (trimmed === "") {
    throw new RosterDataError("empty species name", { query: { name, format } });
  }

  // Resolve the species id first — same lookup as get(). Throw if unknown
  // (per flow doc §3 / plan §7: caller likely meant has() first).
  let speciesRow: SpeciesRow | undefined;
  try {
    speciesRow = findSpeciesRow(db, trimmed, format);
  } catch (e) {
    throw new RosterDbError("roster.sets lookup failed", { cause: e, query: { name, format } });
  }
  if (!speciesRow) {
    throw new RosterDataError(`unknown species: ${name}`, { query: { name, format } });
  }

  let rows: Array<{
    setName: string;
    ability: string;
    item: string | null;
    nature: string;
    movesJson: string;
    spsJson: string;
    sourceJson: string;
  }>;
  try {
    rows = bundle(db).setsById.all({ id: speciesRow.id }) as typeof rows;
  } catch (e) {
    throw new RosterDbError("roster.sets read failed", { cause: e, query: { name, format } });
  }

  return rows.map((r) => {
    const candidate = {
      schema_version: 1 as const,
      set_name: r.setName,
      ability: r.ability,
      item: r.item,
      nature: r.nature,
      moves: JSON.parse(r.movesJson) as string[],
      sps: JSON.parse(r.spsJson) as Record<string, number>,
      source: JSON.parse(r.sourceJson) as { set_source: string; fetched_at: string },
    };
    const parsed = SampleSetSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new RosterDataError(`SampleSet for ${speciesRow.id} failed schema validation`, {
        cause: parsed.error,
        query: speciesRow.id,
      });
    }
    return parsed.data;
  });
}

// ---- internals ----

interface SpeciesRow {
  id: string;
  display_name: string;
  form_id: string | null;
  is_mega: number;
  types_json: string;
  weight_kg: number;
  aliases_json: string;
  movepool_json: string;
  source_json: string;
}


/**
 * Three-step species resolver shared by `get`, `has` (existence flavor), and `sets`.
 * Lookup order: canonical id → case-insensitive display name (preferring base form
 * when multiple match) → alias membership.
 *
 * Caller is responsible for catching SQLite errors and re-wrapping as RosterDbError
 * with their own context.
 */
function findSpeciesRow(db: Db, trimmedName: string, format: "RegM-A"): SpeciesRow | undefined {
  const p = bundle(db);
  let row = p.speciesById.get({ id: toCanonicalId(trimmedName), format }) as SpeciesRow | undefined;
  if (!row) {
    const candidates = p.speciesByDisplayName.all({ name: trimmedName, format }) as SpeciesRow[];
    row = candidates.find((c) => c.form_id === null) ?? candidates[0];
  }
  if (!row) {
    row = p.speciesByAlias.get({ name: trimmedName, format }) as SpeciesRow | undefined;
  }
  return row;
}

function assemblePokemon(db: Db, row: SpeciesRow): Pokemon {
  const p = bundle(db);
  const stats = p.statsById.get({ id: row.id }) as
    | { hp: number; atk: number; def: number; spa: number; spd: number; spe: number }
    | undefined;
  if (!stats) {
    throw new RosterDataError(`species_stats missing for ${row.id}`, { query: row.id });
  }
  const abilityRows = p.abilitiesById.all({ id: row.id }) as Array<{
    slot: string;
    abilityName: string;
  }>;
  const abilitiesObj: { "0": string; "1": string | null; h: string | null } = { "0": "", "1": null, h: null };
  for (const a of abilityRows) {
    if (a.slot === "0") abilitiesObj["0"] = a.abilityName;
    else if (a.slot === "1") abilitiesObj["1"] = a.abilityName;
    else if (a.slot === "h") abilitiesObj.h = a.abilityName;
  }
  if (abilitiesObj["0"] === "") {
    throw new RosterDataError(`species_abilities slot 0 missing for ${row.id}`, { query: row.id });
  }

  const candidate: Pokemon = {
    schema_version: 1,
    id: row.id,
    display_name: row.display_name,
    aliases: JSON.parse(row.aliases_json) as string[],
    form_id: row.form_id,
    is_mega: row.is_mega === 1,
    types: JSON.parse(row.types_json) as Pokemon["types"],
    base_stats: { hp: stats.hp, atk: stats.atk, def: stats.def, spa: stats.spa, spd: stats.spd, spe: stats.spe },
    abilities: abilitiesObj,
    movepool: JSON.parse(row.movepool_json) as string[],
    weight_kg: row.weight_kg,
    source: JSON.parse(row.source_json) as Pokemon["source"],
  };

  const parsed = PokemonSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new RosterDataError(`assembled Pokemon for ${row.id} failed schema validation`, {
      cause: parsed.error,
      query: row.id,
    });
  }
  return parsed.data;
}

