import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { insightsSearchTool } from "../agents/insights-tools";

// Anthropic SDK tool definitions for the roster / items / abilities / moves repos.
// Generated from small zod input schemas via `zod-to-json-schema` so the agent's
// tool catalog and the runtime validators never drift.
//
// Design notes:
// - One Tool per repo function. Disambiguating descriptions ("exact" vs "fuzzy",
//   "single record" vs "list") help the model pick the right tool.
// - All inputs include `format: "RegM-A"` as a required literal — the parameter is
//   a forward-compat seam (future Reg M-B etc.) and forces the model to commit to
//   the format rather than implicitly assuming.
// - `additionalProperties: false` (via zod `.strict()`) so the model can't slip
//   extra params through.

const RegMAFormat = z.literal("RegM-A");

const ListInput = z
  .object({
    format: RegMAFormat,
  })
  .strict();

const NameInput = z
  .object({
    format: RegMAFormat,
    name: z.string().min(1).describe("Showdown id (e.g. 'garchomp') or display name (e.g. 'Garchomp'). Case-insensitive."),
  })
  .strict();

const QueryInput = z
  .object({
    format: RegMAFormat,
    query: z.string().min(1).describe("Partial id, display name, or alias to fuzzy-match against."),
  })
  .strict();

function tool(name: string, description: string, schema: z.ZodTypeAny): Tool {
  // openApi3 mode produces the safest JSON Schema subset Anthropic accepts; we
  // strip `$schema`/refs to keep the output compact and pure JSON.
  const jsonSchema = zodToJsonSchema(schema, {
    name: undefined,
    $refStrategy: "none",
    target: "openApi3",
  }) as Tool["input_schema"];
  return { name, description, input_schema: jsonSchema };
}

// ---- roster (species) ----

/**
 * `roster_list` — return every Reg M-A species. Ordered by canonical id.
 */
export const rosterListTool = tool(
  "roster_list",
  "List every Pokemon legal in Reg M-A, ordered by canonical Showdown id. Returns a lightweight RosterEntry per species (id, display_name, is_mega). Use this to enumerate the full roster or compute coverage; for a single species use roster_get.",
  ListInput,
);

/**
 * `roster_get` — exact lookup of a single Pokemon record.
 */
export const rosterGetTool = tool(
  "roster_get",
  "Look up exactly one Reg M-A Pokemon by canonical Showdown id, display name, or registered alias. Case-insensitive. Returns the full Pokemon record (types, base stats, abilities, movepool, weight, source provenance) or null if no match. For typo-tolerant fuzzy search use roster_search; for boolean legality checks use roster_has.",
  NameInput,
);

/**
 * `roster_search` — fuzzy ranked search.
 */
export const rosterSearchTool = tool(
  "roster_search",
  "Fuzzy-search the Reg M-A roster by partial id, display name, or alias. Returns up to 10 ranked SearchHits (descending score, 0-1 scale; empty if no candidate scores ≥ 0.3). Use this for typo-tolerant 'did-you-mean' suggestions. For exact lookups use roster_get; for legality checks use roster_has.",
  QueryInput,
);

/**
 * `roster_has` — boolean legality check.
 */
export const rosterHasTool = tool(
  "roster_has",
  "Boolean check: is this Pokemon legal in Reg M-A? Same lookup rules as roster_get (id, display name, alias; case-insensitive) but returns just true/false. Cheaper than roster_get when you only need legality.",
  NameInput,
);

/**
 * `roster_sets` — Smogon-curated sample sets for a species.
 */
export const rosterSetsTool = tool(
  "roster_sets",
  "Return Smogon-curated sample sets (build templates) for a Reg M-A species. Each set has ability, item, nature, 4 moves, and SPS spread. Returns an empty array if the species exists but has no curated sets; throws if the species is unknown (call roster_has first if uncertain).",
  NameInput,
);

// ---- items (Champions reference table) ----

/**
 * `items_list` — list every Champions item.
 */
export const itemsListTool = tool(
  "items_list",
  "List every item available in Reg M-A (Champions item set, including Mega Stones). Ordered by canonical id. For a single item use items_get; for legality checks use items_has.",
  ListInput,
);

/**
 * `items_get` — exact item lookup.
 */
export const itemsGetTool = tool(
  "items_get",
  "Look up exactly one Reg M-A item by Showdown id (e.g. 'choicescarf') or display name (e.g. 'Choice Scarf'). Case-insensitive. Returns the Item record (display_name, category, source) or null. Note: Choice Band, Choice Specs, Life Orb are NOT in Champions — only Choice Scarf among Choice items.",
  NameInput,
);

/**
 * `items_has` — boolean item existence check.
 */
export const itemsHasTool = tool(
  "items_has",
  "Boolean check: does this item exist in Reg M-A? Same lookup rules as items_get. Cheaper when only existence matters.",
  NameInput,
);

// ---- abilities (Champions reference table) ----

/**
 * `abilities_list` — list every Champions ability.
 */
export const abilitiesListTool = tool(
  "abilities_list",
  "List every ability available in Reg M-A. Ordered by canonical id. For a single ability use abilities_get.",
  ListInput,
);

/**
 * `abilities_get` — exact ability lookup.
 */
export const abilitiesGetTool = tool(
  "abilities_get",
  "Look up exactly one Reg M-A ability by Showdown id (e.g. 'roughskin') or display name (e.g. 'Rough Skin'). Case-insensitive. Returns the Ability record or null.",
  NameInput,
);

/**
 * `abilities_has` — boolean ability existence check.
 */
export const abilitiesHasTool = tool(
  "abilities_has",
  "Boolean check: does this ability exist in Reg M-A? Same lookup rules as abilities_get. Cheaper when only existence matters.",
  NameInput,
);

// ---- moves (Champions reference table) ----

/**
 * `moves_list` — list every Champions move.
 */
export const movesListTool = tool(
  "moves_list",
  "List every move available in Reg M-A (Champions move set; SV-only moves are NOT included). Ordered by canonical id. For a single move use moves_get.",
  ListInput,
);

/**
 * `moves_get` — exact move lookup.
 */
export const movesGetTool = tool(
  "moves_get",
  "Look up exactly one Reg M-A move by Showdown id (e.g. 'earthquake') or display name (e.g. 'Earthquake', 'Will-O-Wisp'). Case-insensitive. Returns the Move record (type, category, base_power, accuracy) or null.",
  NameInput,
);

/**
 * `moves_has` — boolean move existence check.
 */
export const movesHasTool = tool(
  "moves_has",
  "Boolean check: does this move exist in Reg M-A? Same lookup rules as moves_get. Use this to filter out SV-only moves before they reach the calc tool.",
  NameInput,
);

// ---- tournaments (labmaus-backed) ----

const TournamentFilterInput = z
  .object({
    format: RegMAFormat,
    date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    division: z.enum(["Masters", "Seniors", "Juniors"]).optional(),
    status: z.enum(["official", "unofficial"]).optional(),
  })
  .strict();

const TournamentGetInput = z
  .object({
    format: RegMAFormat,
    id: z
      .string()
      .regex(/^labmaus:\d+$/)
      .describe("Namespaced tournament id, e.g. 'labmaus:56757'."),
  })
  .strict();

const TeamsWithInput = z
  .object({
    format: RegMAFormat,
    species: z.array(z.string().min(1)).min(1).max(6),
    lookback_days: z.number().int().positive().optional(),
    min_placement: z.number().int().positive().optional(),
  })
  .strict();

const UsageInput = z
  .object({
    format: RegMAFormat,
    lookback_days: z.number().int().positive(),
    weight_by: z.enum(["appearances", "wins", "tournament_weight"]).optional(),
    kind: z.enum(["species", "item", "move", "core"]).optional(),
  })
  .strict();

/** `tournaments_list` — recent tournaments matching a filter. */
export const tournamentsListTool = tool(
  "tournaments_list",
  "List Reg M-A tournaments matching format + optional date window + division + status, ordered by date DESC. Use to enumerate the recent meta. For a single tournament use tournaments_get; for teams containing specific species use tournaments_teams_with.",
  TournamentFilterInput,
);

/** `tournaments_get` — exact tournament lookup by namespaced id. */
export const tournamentsGetTool = tool(
  "tournaments_get",
  "Look up one Reg M-A tournament by namespaced id (e.g. 'labmaus:56757'). Returns the TournamentResult metadata or null. For the joined teams + species view use the tournaments.detail repo function; for usage aggregates use tournaments_usage.",
  TournamentGetInput,
);

/** `tournaments_teams_with` — set-intersection of teams containing all listed species. */
export const tournamentsTeamsWithTool = tool(
  "tournaments_teams_with",
  "Return tournament teams whose 6-species roster contains ALL of the listed canonical roster ids. Use to find recent placing teams that share a core (lead-planner evidence). Filter by lookback_days and min_placement.",
  TeamsWithInput,
);

/** `tournaments_usage` — aggregate usage rows. */
export const tournamentsUsageTool = tool(
  "tournaments_usage",
  "Aggregate Reg M-A usage rows over a date window: per-species, per-item, per-move, or per-core (kind='core' returns 2-mon co-occurrences). Returns rows sorted by usage_percent DESC. Item/move kinds require the pokepaste-sets slice's team_sets table.",
  UsageInput,
);

// ---- pokepaste (HTTP tool) + sets (team_sets repo) ----

const PokepasteFetchInput = z
  .object({
    format: RegMAFormat,
    paste_id: z
      .string()
      .regex(/^[a-f0-9]{12,32}$/)
      .describe("Hex paste id from a https://pokepast.es/<id> URL (12-32 hex chars)."),
  })
  .strict();

const SetsListInput = z
  .object({
    format: RegMAFormat,
    tournament_team_id: z
      .string()
      .regex(/^labmaus:\d+:\d+$/)
      .optional()
      .describe("Namespaced team id, e.g. 'labmaus:56757:1'."),
    species_roster_id: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .optional()
      .describe("Canonical Showdown roster id, e.g. 'flutter-mane'."),
    tournament_id: z
      .string()
      .regex(/^labmaus:\d+$/)
      .optional()
      .describe("Namespaced tournament id, e.g. 'labmaus:56757'."),
  })
  .strict();

const SetsGetInput = z
  .object({
    format: RegMAFormat,
    tournament_team_id: z.string().regex(/^labmaus:\d+:\d+$/),
    slot: z.number().int().min(0).max(5),
  })
  .strict();

const SetsUsageToolInput = z
  .object({
    format: RegMAFormat,
    species: z.string().regex(/^[a-z0-9-]+$/).describe("Canonical Showdown roster id."),
    lookback_days: z.number().int().positive(),
    dimension: z.enum(["item", "ability", "move", "nature"]),
  })
  .strict();

/**
 * `pokepaste_fetch_paste` — agent-callable single-paste fetch + parse.
 */
export const pokepasteFetchPasteTool = tool(
  "pokepaste_fetch_paste",
  "Fetch and parse a single pokepast.es Showdown export by paste id (hex hash from the URL). Returns up to six per-Pokemon sets normalized to our domain shape — species, item, ability, level, moves, optionally SPS/IVs/nature — plus a `completeness` tag (`minimal | partial | full`). Strips Tera unconditionally (Reg M-A has no Terastallization). Validates item/ability/move/species against the Champions ref tables; throws on unknown values. Use this for parse-without-persistence calls (e.g. 'explain this paste'); the labmaus ingest hook calls the same fetcher internally to populate team_sets.",
  PokepasteFetchInput,
);

/**
 * `sets_list` — list parsed sets matching a filter.
 */
export const setsListTool = tool(
  "sets_list",
  "List parsed pokepaste-derived sets from `team_sets` matching the filter. At least one of `tournament_team_id`, `species_roster_id`, or `tournament_id` must be provided. Returns full TeamSet records ordered by (tournament_team_id, slot). Use this to enumerate the actual builds behind a tournament's placing teams; for one set use sets_get; for ranking dimensions use sets_usage.",
  SetsListInput,
);

/**
 * `sets_get` — exact lookup of a single parsed set.
 */
export const setsGetTool = tool(
  "sets_get",
  "Look up exactly one parsed `team_sets` row by composite key (tournament_team_id, slot 0-5). Returns the TeamSet record (species, item, ability, moves, sps, ivs, nature, completeness, source) or null. Use this when the lead planner has already chosen a specific team and slot; for enumeration use sets_list.",
  SetsGetInput,
);

/**
 * `sets_usage` — rank items / abilities / moves / natures for a species.
 */
export const setsUsageTool = tool(
  "sets_usage",
  "Rank items / abilities / moves / natures for a Reg M-A species across a date window, computed from placing-team paste data (not Pikalytics). Returns rows sorted by usage_percent DESC with citations into tournament_team_ids. Use this for 'what is species X running on its placing teams?' grounded queries; for raw species/item/move usage at the team level use tournaments_usage.",
  SetsUsageToolInput,
);

// ---- pikalytics (HTTP tool + repo tools) ----

const PikalyticsFetchSpeciesInput = z
  .object({
    format: RegMAFormat,
    species_roster_id: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .describe("Canonical Showdown roster id, e.g. 'garchomp'."),
  })
  .strict();

const PikalyticsTeammatesInput = z
  .object({
    format: RegMAFormat,
    species: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .describe("Canonical roster id of the species to get teammates for."),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();

const PikalyticsUsageToolInput = z
  .object({
    format: RegMAFormat,
    dimension: z.enum(["species", "item", "ability", "move", "teammate"]),
    species: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .optional()
      .describe("Required when dimension is item|ability|move|teammate."),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();

/**
 * `pikalytics_fetch_species` — agent-callable single-species snapshot fetch.
 */
export const pikalyticsFetchSpeciesTool = tool(
  "pikalytics_fetch_species",
  "Fetch and parse the current Pikalytics aggregate-usage snapshot for one Reg M-A species. " +
    "Returns the species's overall usage % (nullable), top teammates with co-occurrence %, and " +
    "frequency breakdowns of items / abilities / moves, all keyed to Pikalytics's own `as_of` " +
    "publication date. Strips any Tera-shaped field unconditionally (Reg M-A has no Terastallization). " +
    "Use this when you need to see one species's current ladder behavior end-to-end. For ranked " +
    "subsets prefer pikalytics_teammates or pikalytics_usage.",
  PikalyticsFetchSpeciesInput,
);

/**
 * `pikalytics_teammates` — top-N most-common teammates for a species.
 */
export const pikalyticsTeammatesTool = tool(
  "pikalytics_teammates",
  "Return the top-N most-common teammates (by Showdown-ladder co-occurrence %) for a Reg M-A species, " +
    "ranked by `percent` descending, sourced from the persisted Pikalytics snapshot. Each entry carries " +
    "the teammate's roster id and the co-occurrence %. Use this to answer 'what pairs well with X?' or to " +
    "seed core-finding heuristics. For the full snapshot (incl. items/abilities/moves) use " +
    "pikalytics_fetch_species; for usage rankings on dimensions other than teammates use pikalytics_usage.",
  PikalyticsTeammatesInput,
);

/**
 * `pikalytics_usage` — multi-dimension usage rankings with citations.
 */
export const pikalyticsUsageTool = tool(
  "pikalytics_usage",
  "Rank items / abilities / moves / teammates / overall species by Pikalytics ladder usage %. The " +
    "`dimension` parameter selects the ranking axis. For dimension='species', returns top species across " +
    "the meta (no `species` arg required). For item|ability|move|teammate, returns the top-ranked entries " +
    "observed on a given species's snapshot — `species` is required. Strictly Pikalytics-sourced; " +
    "cross-source merging (with labmaus / pokepaste) lives in a future slice.",
  PikalyticsUsageToolInput,
);

// ---- knowledge (vgc-knowledge-base slice) ----

const KnowledgeSearchToolInput = z
  .object({
    query: z
      .string()
      .min(3)
      .max(500)
      .describe("Natural-language query (3-500 chars) to semantic-search the vgcguide tutorial corpus."),
    k: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe("Top-k results to return. Default 5."),
    exclude_subtypes: z
      .array(z.enum(["battle-replay"]))
      .optional()
      .describe(
        "Subtypes to exclude. Pass `[\"battle-replay\"]` for principle-focused queries — the 3 historical battle-replay articles dominate by narrative density on broad searches.",
      ),
    article_section_filter: z
      .array(z.enum(["intro", "teambuilding", "battling"]))
      .optional()
      .describe("Restrict results to specific article sections."),
  })
  .strict();

/**
 * `knowledge_search` — semantic search over the vgcguide tutorial corpus.
 */
export const knowledgeSearchTool = tool(
  "knowledge_search",
  "Semantic search over the curated VGC tutorial corpus from vgcguide.com. " +
    "Returns the top-k tutorial passages whose embeddings are most similar to your `query`, " +
    "with each hit carrying the source article's title, URL, and the parent section heading so " +
    "you can cite verbatim. Pass `exclude_subtypes: [\"battle-replay\"]` for principle-focused " +
    "queries (the 3 historical battle-replay articles dominate by narrative density on broad " +
    "searches). Pass `article_section_filter: [\"intro\"]` for new-player-onboarding queries. " +
    "The returned `chunk_text` is verbatim — quote it directly with the `article_url` cited. " +
    "Use this for conceptual VGC questions (speed control, switching, predictions, team preview, " +
    "item theory). For meta usage data prefer pikalytics_*, for tournament results prefer " +
    "labmaus_*, for set provenance prefer pokepaste_*.",
  KnowledgeSearchToolInput,
);

/**
 * The full catalog of repo tool definitions, ready to pass to the Anthropic SDK.
 *
 * **When to use it:** wire into the agent loop's `tools` array. Each tool's `name`
 * matches the convention `<repo>_<verb>` (e.g., `roster_get`, `items_list`).
 */
export const ROSTER_TOOL_DEFINITIONS: readonly Tool[] = [
  rosterListTool,
  rosterGetTool,
  rosterSearchTool,
  rosterHasTool,
  rosterSetsTool,
  itemsListTool,
  itemsGetTool,
  itemsHasTool,
  abilitiesListTool,
  abilitiesGetTool,
  abilitiesHasTool,
  movesListTool,
  movesGetTool,
  movesHasTool,
  tournamentsListTool,
  tournamentsGetTool,
  tournamentsTeamsWithTool,
  tournamentsUsageTool,
  pokepasteFetchPasteTool,
  setsListTool,
  setsGetTool,
  setsUsageTool,
  pikalyticsFetchSpeciesTool,
  pikalyticsTeammatesTool,
  pikalyticsUsageTool,
  knowledgeSearchTool,
  insightsSearchTool as unknown as Tool,
];
