# Tech Plan — Team Tactical Overview

**Slug:** `team-tactical-overview`
**Branch:** `feat/team-tactical-overview`
**Stage:** Stage 3 — Tech plan (pending approval)
**Date:** 2026-05-08
**Author:** Tech Lead subagent
**Implements flow doc:** `docs/flows/team-tactical-overview.md` (Stage 2 approved 2026-05-08 by Rodrigo Caballero)

**Memory citations:**
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/regulation_m_a_no_tera.md`
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/regulation_m_a_stat_rules.md`
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/data_layer_two_tier_db.md`
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/db_orm_drizzle.md`
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/single_db_non_destructive_build.md`
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/test_fixtures_no_invariant_blobs.md`
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/labmaus_pokepaste_deferred_todos.md`

**Sibling plans:**
- `docs/plans/user-teams.md` — owns `user_teams` / `user_team_sets`; this slice is **read-only** over them.
- `docs/plans/damage-calc-tool.md` — owns `damage_calc`; reused as-is, never reimplemented.
- `docs/plans/labmaus-tournaments.md` — owns `tournament_teams` + `team_sets`; read for archetype clustering and labmaus-consensus fallback in the threat panel.
- `docs/plans/pikalytics.md` — owns `pikalytics_snapshots`; read for usage weights, canonical sets, teammates.
- `docs/plans/metavgc-guides.md` / knowledge slice — owns `knowledge_chunks` + `species_id` link table; read for citations.
- `docs/plans/pokemon-roster-db.md` — owns ref tables.

---

## 1. Goal recap

Ship the **headless** layer that converts a saved `UserTeam` into a `TeamTacticalOverview`: four pillar scores (offense / defense / speed / synergy, each 0–100 + tier), a curated 15-entry threat panel, 5–7 generated scenarios (3 archetype + 2–4 individual, **including auto-generated weakness-counter scenarios when our team has a clear hole**), per-scenario lead recommendations (recommended / backline / rejected) backed by real `@smogon/calc` rolls and `knowledge_chunks` citations, and **two** Anthropic agent tools (`score_pillars` + `recommend_leads`) so the agent can compose its own narrative. No persistence v1 — compute on demand, in-memory calc cache scoped to the call. Done means: scoring MarvVGC's tournament-winning team end-to-end in < 20s; all four pillars produce 0–100 with at least one piece of evidence per pillar; ≥ 5 scenarios each with primary lead + back + rejected; ≥ 3 scenarios surface ≥ 1 knowledge_chunk citation; re-scoring the same `(team, threat-panel-as-of)` pair is bit-exact deterministic; every existing user-teams / metavgc / labmaus / pikalytics / damage-calc test stays green.

## 2. Module boundaries

All paths absolute under `/Users/rodrigo/src/pokemon-ai-trainer/`. Existing files marked *(extend)* receive additive edits only.

### Schemas (`src/schemas/`)

#### `src/schemas/tactical.ts` (new)
- **Single responsibility:** zod schemas + inferred types for the tactical-overview domain — `ThreatEntry`, `ThreatPanel`, `ThreatHit`, `PillarScore`, `PillarBundle`, `ScenarioOverview`, `ScenarioField`, `LeadOption`, `ScenarioType`, `TacticalCitation`, `CalcResultRef`, `TeamTacticalOverview`, plus tool I/O shapes (`ScorePillarsInput`, `ScorePillarsOutput`, `RecommendLeadsInput`, `RecommendLeadsOutput`).
- **Tera defense-in-depth:** every object is `.strict()`; no `tera_*` field anywhere; ScenarioField enumerates only Reg M-A field state (weather, terrain, screens, tailwind, trick_room, gravity).
- **Decision (LeadPlan parallel, not extension):** CLAUDE.md §7 `LeadPlan` is one-shot per (our_team, opponent_preview). `ScenarioOverview` is multi-scenario (one per archetype/individual threat) with a different evidence shape (`pair_score` ranking + `key_calcs` list) and a different lifecycle (computed in bulk inside an overview, not standalone). Forcing one schema would dilute both. We ship `ScenarioOverview` as a sibling and document the relationship in TSDoc; if a future slice needs the canonical `LeadPlan` for a single team-vs-opponent preview, we adapt one `ScenarioOverview` into a `LeadPlan` at the boundary.

### Data layer (`src/data/tactical/`)

| File | Responsibility |
|---|---|
| `threat-panel.ts` | Curate 15 `ThreatEntry`s: pikalytics-first, labmaus-consensus fallback. Memoized by latest pikalytics `as_of`. |
| `scenarios.ts` | Generate 5–7 `ScenarioOverview` skeletons: 3 archetype clusters (Sun / Rain / TR / Tailwind HO / Snow), 2–4 individual top-usage threats, **plus auto-generated weakness-counter scenarios** when triggered (see §5.4). Each scenario carries its `field` + `opposing_team`. |
| `score-offense.ts` | `scoreOffense(team, panel, calcCache) → PillarScore`. Best-move max-damage outcome per (our_set, threat_set) × weight. |
| `score-defense.ts` | `scoreDefense(team, panel, calcCache) → PillarScore`. Inverse: incoming damage → survival outcome. |
| `score-speed.ts` | `scoreSpeed(team, panel, scenarios) → PillarScore`. Speed-tier matrix, TR-aware inversion. |
| `score-synergy.ts` | `scoreSynergy(team, db) → PillarScore`. 60% teammate co-occurrence + 40% archetype detection. |
| `score-pair.ts` | `scorePair(team, leads, back, scenario, calcCache) → number`. The `α·offense + β·speed − γ·defense_loss` formula used by the recommend loop. |
| `recommend-leads.ts` | Exhaustive C(6,2)=15 lead-pair search per scenario; picks top + backline + rejected. |
| `cite.ts` | Pull 1–3 `knowledge_chunks` per scenario via `knowledge.search` with `species_id_filter = leads ∪ opposing_leads`. |
| `calc-cache.ts` | The in-memory `(our_set, panel_set, field) → CalcResult` cache (per-call scope; shared across pillar + recommend passes). Per Q5 binding. |
| `speed-table.ts` | Read accessor over `fixtures/speed/top50.json` (committed; weekly regen). Used by `score-speed.ts` and the speed-tier evidence formatting. |
| `weakness-detect.ts` | Pure helpers detecting "clear weakness" triggers per Q2: defense pillar shows ≥50% OHKO chance across our 6 slots vs a single threat, OR a niche species nullifies our offense plan. Returns the species_ids that should become weakness-counter scenarios. |
| `pillars.ts` | Orchestrator that runs all four scoring functions and returns the `PillarBundle`. Used by `score_pillars` agent tool. |
| `overview.ts` | Top-level orchestrator: build threat panel → build scenarios → score pillars → run recommend loop per scenario → attach citations → assemble `TeamTacticalOverview`. Used by CLI. |

### Agents (`src/agents/`)

#### `src/agents/tactical-tools.ts` (new)
- Defines two Anthropic tools (`score_pillars`, `recommend_leads`) per Q8 binding. JSON-schema definitions registered in `src/db/tool-definitions.ts` (extend) and a dispatcher that routes `tool_use` blocks to the data-layer functions.

### Scripts (`scripts/data/`)

| File | Responsibility |
|---|---|
| `tactical.ts` (new) | CLI: `pnpm data:tactical overview <team-id>` (full overview), `score-pillars <team-id>`, `recommend-leads <team-id> --scenario <name>`, `threat-panel` (preview the curated panel). |
| `build-speed-table.ts` (new) | Regenerates `fixtures/speed/top50.json` from `pikalytics_snapshots` × `species_stats`. Run weekly per CLAUDE.md §4. Idempotent; deterministic ordering by usage_percent DESC then species_id ASC. |

### Fixtures

| Path | Purpose |
|---|---|
| `fixtures/speed/top50.json` (new — committed) | Top-50 species by usage with their canonical Modest/Adamant/Timid spreads + final speed at L50. Generated by `build-speed-table.ts`. **Per memory `test_fixtures_no_invariant_blobs.md`: the generator script is also committed and tested; the fixture is regenerable.** |
| `fixtures/tactical/2026-05-08__threat_panel.json` (new) | Captured threat-panel snapshot for deterministic tests. |
| `fixtures/tactical/2026-05-08__overview_marvvgc.json` (new) | End-to-end `TeamTacticalOverview` golden for the success-criteria team. |
| `fixtures/calcs/tactical/*.json` (new — small set) | 5–10 golden calc results that the cache must reproduce; cross-checked against the public Showdown calculator UI per CLAUDE.md §4. |

### Tests

```
tests/schemas/tactical.test.ts
tests/data/tactical/threat-panel.test.ts
tests/data/tactical/scenarios.test.ts
tests/data/tactical/weakness-detect.test.ts
tests/data/tactical/score-offense.test.ts
tests/data/tactical/score-defense.test.ts
tests/data/tactical/score-speed.test.ts
tests/data/tactical/score-synergy.test.ts
tests/data/tactical/score-pair.test.ts
tests/data/tactical/recommend-leads.test.ts
tests/data/tactical/cite.test.ts
tests/data/tactical/calc-cache.test.ts
tests/data/tactical/speed-table.test.ts
tests/data/tactical/overview.test.ts
tests/agents/tactical-tools.test.ts
tests/scripts/tactical.test.ts
tests/scripts/build-speed-table.test.ts
```

### Package scripts (`package.json` extend)
- `"data:tactical": "tsx scripts/data/tactical.ts"`
- `"data:speed-table": "tsx scripts/data/build-speed-table.ts"`

## 3. Schemas (zod)

Per CLAUDE.md §3 pure-data exemption, `src/schemas/tactical.ts` is eligible for batch landing; the implementor must disclose the batched scaffold in the Stage 4 commit message.

```ts
// src/schemas/tactical.ts
import { z } from "zod";
import { CalcResultSchema } from "./calc";
import { TeamSetSchema } from "./team-set";
import { UserTeamSchema } from "./user-team";

const RosterId    = z.string().regex(/^[a-z0-9-]+$/);
const ISODate     = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ISODateTime = z.string().datetime({ offset: false });

export const TierLabelSchema = z.enum(["Weak", "OK", "Good", "Strong"]);

export const ScenarioFieldSchema = z.object({
  weather:    z.enum(["none","sun","rain","sand","snow"]).default("none"),
  terrain:    z.enum(["none","electric","grassy","misty","psychic"]).default("none"),
  trick_room: z.boolean().default(false),
  tailwind_ours:    z.boolean().default(false),
  tailwind_theirs:  z.boolean().default(false),
  light_screen:     z.boolean().default(false),
  reflect:          z.boolean().default(false),
  gravity:          z.boolean().default(false),
}).strict();

export const ThreatEntrySchema = z.object({
  species_id: RosterId,
  weight:     z.number().min(0).max(1),    // normalized: panel sums to ~1.0
  set:        TeamSetSchema,                // canonical set (item, ability, nature, SPS, moves)
  source:     z.object({
    type:  z.enum(["pikalytics","labmaus_consensus"]),
    as_of: ISODate,
  }).strict(),
}).strict();

export const ThreatPanelSchema = z.object({
  schema_version: z.literal(1),
  as_of:          ISODate,
  generated_at:   ISODateTime,
  entries:        z.array(ThreatEntrySchema).min(1).max(25),    // target 15
}).strict();

export const ThreatHitSchema = z.object({
  threat_species_id: RosterId,
  our_slot:          z.number().int().min(0).max(5),
  our_species_id:    RosterId,
  best_move_id:      z.string(),
  ko_chance_pct:     z.number().min(0).max(100),
  max_roll_pct:      z.number().min(0).max(100),
  weight:            z.number().min(0).max(1),
}).strict();

export const PillarScoreSchema = z.object({
  pillar:   z.enum(["offense","defense","speed","synergy"]),
  score:    z.number().int().min(0).max(100),
  tier:     TierLabelSchema,
  evidence: z.record(z.unknown()),    // shape varies per pillar; see §5
}).strict();

export const PillarBundleSchema = z.object({
  offense: PillarScoreSchema,
  defense: PillarScoreSchema,
  speed:   PillarScoreSchema,
  synergy: PillarScoreSchema,
}).strict();

export const ScenarioTypeSchema = z.enum([
  "archetype",         // weather/TR/etc. cluster
  "individual",        // top-usage species
  "weakness_counter",  // auto-generated per Q2 binding
]);

export const TacticalCitationSchema = z.object({
  knowledge_chunk_id: z.string(),
  excerpt:            z.string().max(500),
  source_url:         z.string().url(),
  species_ids:        z.array(RosterId),
}).strict();

export const CalcResultRefSchema = z.object({
  attacker_species_id: RosterId,
  defender_species_id: RosterId,
  move_id:             z.string(),
  max_roll_pct:        z.number(),
  ko_chance_desc:      z.string(),
  field_summary:       z.string(),     // human-readable echo of ScenarioField
}).strict();

export const ScenarioOverviewSchema = z.object({
  name:                  z.string().min(1),
  type:                  ScenarioTypeSchema,
  field:                 ScenarioFieldSchema,
  opposing_preview:      z.array(RosterId).min(1).max(6),
  recommended_leads:     z.tuple([RosterId, RosterId]),
  recommended_backline:  z.tuple([RosterId, RosterId]),
  rejected_bench:        z.tuple([RosterId, RosterId]),
  reasoning:             z.string().max(400),
  key_calcs:             z.array(CalcResultRefSchema).min(0).max(3),
  citations:             z.array(TacticalCitationSchema).min(0).max(3),
  pair_score:            z.number(),
}).strict();

export const TeamTacticalOverviewSchema = z.object({
  schema_version:       z.literal(1),
  team_id:              z.string(),
  generated_at:         ISODateTime,
  threat_panel_as_of:   ISODate,
  pillars:              PillarBundleSchema,
  scenarios:            z.array(ScenarioOverviewSchema).min(5).max(8),
}).strict();

// Agent-tool I/O
export const ScorePillarsInputSchema = z.object({
  team_id: z.string(),
}).strict();
export const ScorePillarsOutputSchema = z.object({
  team_id:  z.string(),
  pillars:  PillarBundleSchema,
  threat_panel_as_of: ISODate,
}).strict();
export const RecommendLeadsInputSchema = z.object({
  team_id:        z.string(),
  scenario_name:  z.string().optional(),    // omit → return all
}).strict();
export const RecommendLeadsOutputSchema = z.object({
  team_id:    z.string(),
  scenarios:  z.array(ScenarioOverviewSchema).min(1),
}).strict();

export type ThreatEntry        = z.infer<typeof ThreatEntrySchema>;
export type ThreatPanel        = z.infer<typeof ThreatPanelSchema>;
export type PillarScore        = z.infer<typeof PillarScoreSchema>;
export type PillarBundle       = z.infer<typeof PillarBundleSchema>;
export type ScenarioOverview   = z.infer<typeof ScenarioOverviewSchema>;
export type ScenarioField      = z.infer<typeof ScenarioFieldSchema>;
export type TeamTacticalOverview = z.infer<typeof TeamTacticalOverviewSchema>;
export type TacticalCitation   = z.infer<typeof TacticalCitationSchema>;
export type CalcResultRef      = z.infer<typeof CalcResultRefSchema>;
```

**LeadPlan reconciliation.** The CLAUDE.md §7 `LeadPlan` shape is single-preview with `key_timing` / `abandon_if` narrative fields. `ScenarioOverview` is its sibling, scoped to a generated meta scenario with a deterministic `pair_score` and `key_calcs` list. They share `recommended_leads` / `backline` / `rejected_bench` / `reasoning` / `citations`. We keep them parallel for v1; a future slice may expose a `scenarioToLeadPlan(s, opponent_preview)` adapter at the boundary.

## 4. Persistence decision (no migration)

**No `drizzle-schema.ts` change. No new migration.** Flow §8 binds v1 to compute-on-demand. The `TeamTacticalOverview` is regenerated every CLI/agent call, and the only meaningful cache is the threat-panel curation result, which is held in **process memory** keyed by the latest pikalytics `as_of` date.

### Why no migration

1. **Reg M-A is fast-moving.** Persisted overviews would go stale the moment a new pikalytics snapshot lands. Per Q7 binding, we silently regenerate on new snapshots. Persistence would require an invalidation column + a refresh job; both are pre-mature complexity.
2. **Compute is tractable.** Worst case: 6 our × 15 panel × 2 directions × ~6 scenarios = ~1080 `damage_calc` calls per overview. With the in-memory `(our_set, panel_set, field)` cache (Q5), the recommend pass reuses ~85% of pillar-pass calcs. Empirically, ~10s for a fresh overview on the success-criteria team.
3. **Single-user assumption.** No concurrent overview requests; the cache lifecycle is the call lifecycle.
4. **Per memory `single_db_non_destructive_build.md`:** the build pipeline regenerates category-A reference data on every run. Adding a `team_tactical_overviews` table would create a fourth lifecycle (transient compute vs. captured prod state vs. category-A regen vs. snapshot-cached) — too many for a v1.

### What's deferred to a follow-up slice (`team-tactical-overview-cache`)

If the user calls overviews so often that the 5–15s recompute hurts, a follow-up slice persists `team_tactical_overviews` keyed on `(team_id, threat_panel_as_of, team_revision_number)` with on-update invalidation hooks from `pikalytics.upsertSnapshot` and `userTeams.update`. Out of scope today; flagged in §12.

### What IS in process state

- `ThreatPanel` per `(latest pikalytics as_of)` — `WeakMap<Db, { as_of, panel }>`. Stale entry replaced atomically when a newer snapshot is observed.
- `(our_set, panel_set, field) → CalcResult` cache — per-call `Map`, garbage-collected when the call completes.
- Speed table — read once from `fixtures/speed/top50.json` per call, cached on the module if profiling justifies it later.

## 5. Tool contracts

Every export carries a six-element TSDoc block per CLAUDE.md §10. Signatures only; bodies in Stage 5.

### 5.1 `src/data/tactical/threat-panel.ts`

```ts
export interface ThreatPanelDeps {
  db: Db;
  pikalytics:    typeof import("../../db/pikalytics");
  tournaments:   typeof import("../../db/tournaments");
  sets:          typeof import("../../db/sets");
  roster:        typeof import("../../db/roster");
  speciesStats:  typeof import("../../db/species-stats");
  /** Override panel size for tests. Production: 15 per Q1. */
  size?: number;
}
/** Curate a usage-weighted ThreatPanel of size N (default 15). Pikalytics-first; labmaus-consensus fallback. Memoized per latest pikalytics.as_of. */
export function buildThreatPanel(deps: ThreatPanelDeps): ThreatPanel;
/** Force-clear the in-process panel cache. For tests + the silent regen path. */
export function invalidateThreatPanel(db: Db): void;
```

**Pikalytics path.** Read latest `pikalytics_snapshots.as_of`; pick top-N species by `usage_percent` filtered to `roster_membership.is_legal=1`. For each: derive the highest-frequency `(item, ability, nature, sps_spread, moves)` from the snapshot's `*_json` columns; assemble a `TeamSet`. Normalize weights to sum to 1.0.

**Labmaus fallback.** When pikalytics has < N entries, top up with the most-common `(item, ability, nature, sps, moves)` from `team_sets` for the species over the last N=50 events. Source flagged `labmaus_consensus`.

**Refusal.** Both sources empty → `TacticalThreatPanelError` (§8).

### 5.2 `src/data/tactical/scenarios.ts`

```ts
/** Produce 5–7 ScenarioOverview SKELETONS — leads/back/rejected/citations are filled by recommendLeads. */
export function generateScenarios(deps: ScenarioGenDeps): ScenarioOverview[];
```

**Composition.** 3 archetype clusters + 2–4 individual top-usage threats + 0–2 weakness-counter scenarios (Q2). Total bounded `[5, 7]`. Weakness-counters bump out the lowest-pair-score individual scenario when at 7.

**Archetype clusters.** Cluster `tournament_teams` from the last 50 events by Jaccard on `(species + key_item + ability)`. Top 3 cluster centers → scenarios. `field` derived from cluster signal: Pelipper → rain; Torkoal → sun; Indeedee/Farigiraf → trick_room; Whimsicott → tailwind_theirs; Snow ability → snow.

**Individual threats.** Top-K species by `pikalytics.usage_percent` not in any archetype cluster; `opposing_team` = canonical set + 5 most-common teammates from `pikalytics.teammates`. Neutral field.

**Weakness-counter scenarios (Q2 binding).** Triggers:
- A: defense pillar shows ≥ 50% OHKO chance across our 6 slots vs that single threat (i.e. the threat OHKOs ≥ 3 of our 6 slots).
- B: a niche species nullifies our offense plan (no offensive set on our team has ≥ 30% max-roll on this species).

Each detected species → `type: "weakness_counter"` scenario, name like `"vs Mega Glimmora (counter)"`. Ranked defense_pillar > offense_nullified, then by panel weight.

### 5.3 `src/data/tactical/weakness-detect.ts`

```ts
export interface WeaknessTriggerResult {
  species_id:     string;
  trigger:        "defense_pillar" | "offense_nullified";
  ohko_count?:    number;
  best_max_roll?: number;
}
/** Pure helpers identifying species in the panel that constitute a "clear weakness" per Q2. Returns ≤ 2 entries. */
export function detectWeaknessCounters(
  team: UserTeam, panel: ThreatPanel, calcCache: CalcCache, deps: CalcDeps,
): WeaknessTriggerResult[];
```

### 5.4 Pillar functions

```ts
// score-offense.ts
export function scoreOffense(team: UserTeam, panel: ThreatPanel, calcCache: CalcCache, deps: CalcDeps): PillarScore;
// score-defense.ts
export function scoreDefense(team: UserTeam, panel: ThreatPanel, calcCache: CalcCache, deps: CalcDeps): PillarScore;
// score-speed.ts
export function scoreSpeed(team: UserTeam, panel: ThreatPanel, scenarios: ScenarioOverview[], speedTable: SpeedTable, deps: SpeedDeps): PillarScore;
// score-synergy.ts
export function scoreSynergy(team: UserTeam, deps: SynergyDeps): PillarScore;
```

**Offense (flow §5.1).** For each (our 6 sets × 15 panel): pick best move; `damage_calc(our_set, panel_set, panel.field)`; outcome = `min(1.0, max_roll_pct/100) × weight`. Aggregate weighted mean × 100. Tier: 0–40 Weak / 41–60 OK / 61–80 Good / 81–100 Strong. Evidence: `top: ThreatHit[3]`, `worst: ThreatHit[2]`.

**Defense (flow §5.2).** Inverse: each panel entry's best move vs each of our slots; outcome = 1.0 if survive 2 hits, 0 if OHKO'd, linear interp. Evidence: which slots are OHKO'd by which threats; weakest slot id.

**Speed (flow §5.3 + Q3).** Apply scenario `field` modifiers (Choice Scarf x1.5, Tailwind x2, TR inverts comparison). 1.0 outspeed, 0.5 tie, 0 outsped; weighted mean × 100. **TR inversion (Q3 binding):** triggered iff team has a TR setter ability AND ≥ 2 attackers with base spe < 60 (parametrized so we can dial to 1 attacker later). When triggered, scenarios with `field.trick_room=true` flip the comparison. Evidence: fastest unmodified speed; % panel outsped naked vs in tailwind.

**Synergy (flow §5.4 + Q4).** Two summed components:
- **Teammate co-occurrence (60 pts max):** for each of C(6,2)=15 pairs on our team, look up `pikalytics.teammates(species_a, species_b).percent`. Sum normalized to 60.
- **Archetype detection (40 pts max):** hard-coded checks — Weather (Pelipper/Torkoal/Hippowdon/Abomasnow + ability match), Redirection (Follow Me / Rage Powder), Fake Out core, Trick Room core, Good Stuff balance. Each detected archetype contributes 10–20 pts.

Tunable from KB data later (Q4); v1 hard-coded.

### 5.5 `src/data/tactical/score-pair.ts`

```ts
export const ALPHA = 1.0;   // offense weight (Q6 binding)
export const BETA  = 0.5;   // speed weight
export const GAMMA = 0.7;   // defense_loss weight

/** Score one (our leads, our back, scenario) candidate. = α·offense(leads → opp_leads) + β·speed(leads vs opp_leads) − γ·defense_loss(opp_leads → leads). */
export function scorePair(
  team: UserTeam, leads: [number, number], back: [number, number],
  scenario: ScenarioOverview, calcCache: CalcCache, deps: CalcDeps,
): number;
```

### 5.6 `src/data/tactical/recommend-leads.ts`

```ts
/** Exhaustive C(6,2)=15-pair search per scenario. Picks top-scoring leads, then greedy-best back from remaining 4. Rejected = leftover 2. Mutates the scenario in-place with leads / back / rejected / reasoning / key_calcs / citations / pair_score. */
export function recommendLeads(
  team: UserTeam, scenario: ScenarioOverview,
  calcCache: CalcCache, deps: RecommendDeps,
): ScenarioOverview;
```

`reasoning` is templated, ≤ 400 chars, citing `key_calcs[0]` (highest expected damage) and the leading citation. `key_calcs` carries up to 3 `CalcResultRef`s — the highest-impact OHKO/2HKO from offense + the worst-incoming-roll from defense + a speed comparison.

### 5.7 `src/data/tactical/cite.ts`

```ts
/** Pulls 1–3 KnowledgeChunks via knowledge.search with species_id_filter = leads ∪ opposing_leads. Empty allowed (flow §9). */
export function findCitations(
  scenario: ScenarioOverview, leads: [string, string],
  knowledge: typeof import("../../db/knowledge"), db: Db,
): TacticalCitation[];
```

### 5.8 `src/data/tactical/calc-cache.ts`

```ts
export interface CalcCacheKey {
  attacker_set_hash: string;   // SHA-1 of canonical TeamSet JSON
  defender_set_hash: string;
  field_hash:        string;
  move_id:           string;
}
export interface CalcCache {
  get(key: CalcCacheKey): CalcResult | undefined;
  set(key: CalcCacheKey, result: CalcResult): void;
  size(): number;
  stats(): { hits: number; misses: number };
}
/** Fresh per-call cache. Discarded when the overview call returns. */
export function createCalcCache(): CalcCache;
/** Memoizing wrapper around `damage_calc`. On engine throw, returns `{ ok: false, error }` so the caller can skip the (our_set, threat_set) pair (flow §9). Errors are NOT cached. */
export function calcWithCache(
  cache: CalcCache, input: CalcInput,
): { ok: true; result: CalcResult } | { ok: false; error: CalcEngineError | CalcInputError };
```

### 5.9 `src/data/tactical/speed-table.ts`

```ts
export interface SpeedTableEntry {
  species_id:    string;
  base_speed:    number;
  spread_label:  string;   // e.g. "Timid 252+ Spe"
  final_speed:   number;   // computed at L50 with the spread
  usage_percent: number;
  as_of:         string;
}
export interface SpeedTable { entries: SpeedTableEntry[]; as_of: string; }
/** Reads + zod-validates fixtures/speed/top50.json. */
export function loadSpeedTable(): SpeedTable;
```

### 5.10 `src/data/tactical/pillars.ts`

```ts
/** Run all four pillar functions in sequence, sharing the calc cache across offense/defense. Returns the PillarBundle for `score_pillars`. */
export function scoreAllPillars(
  team: UserTeam, panel: ThreatPanel, scenarios: ScenarioOverview[],
  calcCache: CalcCache, deps: AllPillarDeps,
): PillarBundle;
```

### 5.11 `src/data/tactical/overview.ts`

```ts
/** Top-level orchestrator. Reads team via userTeams.get; refuses if status !== 'saved' or validation_errors.length > 0 (flow §9). Builds threat panel → scenarios → pillars → recommends leads per scenario → assembles TeamTacticalOverview. Single ~5–15s call. */
export function buildOverview(
  teamId: string, deps: OverviewDeps,
): TeamTacticalOverview;
```

## 6. Anthropic agent tools

Per Q8 binding: **two** read-only tools, not one. Both run end-to-end (each opens its own calc cache); neither persists. Cache hits across tools require persistence (deferred §12). Registered in `src/db/tool-definitions.ts`.

### 6.1 `score_pillars`

**Description (the agent reads this to pick):**
> Compute the four-pillar tactical assessment (Offense / Defense / Speed / Synergy, each 0–100) for a saved user team against the current Reg M-A meta. Returns scores + per-pillar evidence (top KO chances, weakest slot, fastest tier, detected archetypes). Use this BEFORE recommending leads — pillar scores tell you which scenarios are worth drilling into. Inexpensive (~5–8s); call once per user question about team strength. Do NOT use for matchup-specific lead picks (that's `recommend_leads`).

**JSON-schema input:**
```json
{ "type": "object",
  "properties": { "team_id": { "type": "string", "description": "Saved user_team id (ULID)." } },
  "required": ["team_id"],
  "additionalProperties": false }
```

**JSON-schema output:** `ScorePillarsOutputSchema` (§3).

**Handler (`src/agents/tactical-tools.ts`):**
```ts
export async function handleScorePillars(
  input: ScorePillarsInput, deps: TacticalToolDeps,
): Promise<ScorePillarsOutput>;
```

Throws `UserTeamNotFoundError` (re-exposed) on bad id; `TacticalOverviewError` on draft / unsaved team; `TacticalThreatPanelError` on empty data.

### 6.2 `recommend_leads`

**Description:**
> Generate scenario-specific lead recommendations for a saved user team. Returns the recommended lead pair, backline pair, rejected bench, ≤ 3 supporting damage calcs, and ≤ 3 knowledge_chunk citations per scenario. With `scenario_name` set, returns one scenario; without, returns all 5–7. Use AFTER `score_pillars` — this tool is more expensive (~10–15s for all scenarios) and the scores tell you which scenario the user's actual question maps to. Do NOT use to compare two teams (out of scope v1).

**JSON-schema input:**
```json
{ "type": "object",
  "properties": {
    "team_id":       { "type": "string", "description": "Saved user_team id (ULID)." },
    "scenario_name": { "type": "string", "description": "Optional. Exact scenario name from a previous score_pillars or overview call. Omit to return all scenarios." }
  },
  "required": ["team_id"],
  "additionalProperties": false }
```

**JSON-schema output:** `RecommendLeadsOutputSchema` (§3).

**Handler:**
```ts
export async function handleRecommendLeads(
  input: RecommendLeadsInput, deps: TacticalToolDeps,
): Promise<RecommendLeadsOutput>;
```

### 6.3 Prompt cache placement (CLAUDE.md §9)

- Tool definitions cached at the system block (already standard for the agent loop).
- Threat-panel JSON, when ≤ 25 entries, can be inlined in the system prompt's "meta snapshot" cache slot for the duration of one user turn — defer to the agent-loop slice. v1 of this slice does NOT extend the system prompt; the tools self-contain their reads.

## 7. Test strategy

TDD per CLAUDE.md §3. **Write order = numbered order below.** Per-test red-first cycle for non-pure modules; the §3 pure-data exemption applies to TAC-T1..T6 (zod round-trip on schemas) — they ship in one batched commit per memory `db_orm_drizzle.md` precedent.

Every pillar function gets ≥ 1 **golden fixture** per CLAUDE.md §4 — a curated calc input + the exact expected score (or score range to ±2). Goldens live under `fixtures/tactical/`.

| # | File | What it asserts | Fails because |
|---|---|---|---|
| TAC-T1 | `tests/schemas/tactical.test.ts` | `ThreatEntry`/`ThreatPanel`/`PillarScore`/`ScenarioOverview`/`TeamTacticalOverview` round-trip via zod | schemas missing |
| TAC-T2 | same | zod rejects negative weights, score > 100, empty scenario list | schemas don't enforce bounds |
| TAC-T3 | same | `ScenarioOverview` carries `kind: 'archetype' \| 'individual' \| 'weakness_counter'` discriminator (Q2 binding) | discriminator absent |
| TAC-T4 | same | `TeamTacticalOverview.threat_panel_as_of` is ISO date | wrong format |
| TAC-T5 | same | rejects Tera-* keys defensively (memory `regulation_m_a_no_tera`) | strip-key absent |
| TAC-T6 | same | `LeadPlan` ↔ `ScenarioOverview` shape divergence is intentional + documented (assert via type-only test) | naming collision |
| TAC-T7 | `tests/data/tactical/threat-panel.test.ts` | curates 15 entries from a fixture pikalytics snapshot; weights normalize to 1.0 ± 1e-9 | curation absent |
| TAC-T8 | same | labmaus consensus fallback fires when species lacks pikalytics row | fallback absent |
| TAC-T9 | same | deterministic given fixed snapshot (same input → same panel byte-equal after JSON.stringify) | non-deterministic ordering |
| TAC-T10 | same | refuses with `TacticalThreatPanelError` when both sources are empty | error class missing |
| TAC-T11 | `tests/data/tactical/score-offense.test.ts` | golden: known-team vs known-panel produces score within ±2 of golden value | scoring absent |
| TAC-T12 | same | KO-chance evidence list captures top-3 + worst-2 (5 entries) | evidence empty |
| TAC-T13 | same | calc-engine throw on a single (our_set, threat_set) pair → skip + continue, score unaffected | unhandled throw |
| TAC-T14 | `tests/data/tactical/score-defense.test.ts` | golden: incoming damage from panel vs known-team → score in range | scoring absent |
| TAC-T15 | same | weakest-slot evidence reports the slot with most OHKOs | wrong slot reported |
| TAC-T16 | `tests/data/tactical/score-speed.test.ts` | golden: known-team vs known-panel → speed score within ±2 | scoring absent |
| TAC-T17 | same | TR inversion fires for team with TR setter ability + ≥ 2 attackers w/ base spe < 60 (Q3 binding) | threshold logic missing |
| TAC-T18 | same | TR inversion does NOT fire when team has setter but only 1 slow attacker | threshold too loose |
| TAC-T19 | `tests/data/tactical/score-synergy.test.ts` | Pelipper Rain core hits weather archetype (≥ 10pt bonus) | archetype detector missing |
| TAC-T20 | same | Snow team (Abomasnow + Snow Cloak/Slush Rush partner) hits weather archetype | snow detection missing |
| TAC-T21 | same | Follow Me / Rage Powder team hits redirection archetype | redirection detection missing |
| TAC-T22 | same | Fake Out core (Incineroar + Sneasler) hits Fake Out archetype | detection missing |
| TAC-T23 | same | Good Stuff (no archetype, all stats > 70) hits Good Stuff bonus | detection missing |
| TAC-T24 | same | teammate-cooccurrence component is 60% weighted (Q4 binding); archetype is 40% | weight wrong |
| TAC-T25 | `tests/data/tactical/scenarios.test.ts` | generates 5–7 scenarios; ≥ 3 are archetype kind, 2–4 are individual | wrong counts |
| TAC-T26 | same | **weakness-counter scenario surfaces** when team has a structural weakness — niche species OHKOs ≥ 4/6 our slots → scenario emitted with `kind='weakness_counter'` (Q2 binding) | branch missing |
| TAC-T27 | same | weakness-detection threshold tunable via deps (`weakness_ohko_ratio` default 0.5) | hardcoded |
| TAC-T28 | `tests/data/tactical/recommend-leads.test.ts` | exhaustive 15-pair search picks the highest-scoring pair (deterministic) | search absent |
| TAC-T29 | same | back pair = next-best 2 from remaining 4; rejected = remaining 2 | wrong split |
| TAC-T30 | same | α/β/γ defaults `1.0 / 0.5 / 0.7` (Q6) compose into the score | coefficients off |
| TAC-T31 | `tests/data/tactical/cite.test.ts` | returns ≤ 3 chunks with `species_tags` overlapping the scenario species | cite absent |
| TAC-T32 | same | empty result when no chunk matches; does NOT throw | error path wrong |
| TAC-T33 | `tests/data/tactical/calc-cache.test.ts` | second call with same `(our_set, panel_set, field)` key hits cache (calc engine called once total) | cache miss |
| TAC-T34 | same | mutating one team set invalidates only the rows touching that set; ~85% of cache survives | over-invalidation |
| TAC-T35 | same | cache scope is per-call (different overview calls don't share) per Q5 | cross-call leak |
| TAC-T36 | `tests/data/tactical/overview.test.ts` | end-to-end on a labmaus tournament team duplicated into user_teams: pillars present, ≥ 5 scenarios, citations on ≥ 3 of them | orchestrator absent |
| TAC-T37 | same | refuses team with `status='draft'` → `TacticalOverviewError` | gate missing |
| TAC-T38 | same | refuses team with `validation_errors.length > 0` → `TacticalOverviewError` | gate missing |
| TAC-T39 | same | re-running same team twice produces identical pillar scores (determinism) | non-deterministic |
| TAC-T40 | same | swapping a Choice Scarf onto our fastest set raises the speed pillar (delta > 0) | logic regression |
| TAC-T41 | `tests/agents/tactical-tools.test.ts` | catalog contains `score_pillars` + `recommend_leads`; both have JSON-schema `input_schema` with `additionalProperties: false`; `team_id` required | catalog absent |
| TAC-T42 | same | `score_pillars` handler invokable end-to-end on a fixture-seeded DB; returns `PillarScore`-shaped output | handler stub |
| TAC-T43 | same | `recommend_leads` with `scenario_name` returns one scenario; without it returns all | dispatch missing |
| TAC-T44 | `tests/scripts/tactical-cli.test.ts` | `pnpm data:tactical overview <id>` prints valid JSON to stdout, exit 0 | CLI absent |
| TAC-T45 | same | `pnpm data:tactical pillars <id>` and `recommend <id> [name]` subcommands | dispatch missing |
| TAC-T46 | `tests/scripts/build-speed-table.test.ts` | generator script produces `top50.json` with 50 entries, sorted desc by usage-weighted speed; idempotent on re-run | generator absent |
| TAC-T47 | `tests/contract/tactical-live.test.ts` (gated by `TACTICAL_LIVE`) | end-to-end against prod DB on a real labmaus team | (no new code) |

**Golden fixtures** (`fixtures/tactical/`):

- `2026-05-08__threat_panel_synthetic.json` — 6-entry synthetic panel for fast pillar tests
- `2026-05-08__pillar_offense_golden.json` — known team + panel + expected offense score ± 2
- `2026-05-08__pillar_defense_golden.json` — same shape, defense
- `2026-05-08__pillar_speed_golden.json` — same, speed
- `2026-05-08__synergy_archetypes.json` — fixture teams for each detectable archetype with expected pillar contribution

Per memory `test_fixtures_no_invariant_blobs.md`: golden fixtures are JSON (diffable), generated by a checked-in script in `scripts/data/build-tactical-goldens.ts`. No binary blobs.

## 8. Error model

New classes in `src/schemas/errors.ts`:

| Class | Trigger | Recoverable? |
|---|---|---|
| `TacticalOverviewError` | team draft / has validation_errors / not found via `userTeams.get` | yes — caller fixes the team |
| `TacticalThreatPanelError` | both pikalytics_snapshots and team_sets are empty for the format | no — needs ingest |
| `TacticalScenarioError` | scenario generator can't produce ≥ 3 scenarios (insufficient data) | no — needs more labmaus data |
| `TacticalCalcEngineError` | systemic damage_calc failure (vs per-pair skip in TAC-T13) — > 50% of pairs throw | no — calc tool is broken |

Reuse from existing slices:

- `UserTeamNotFoundError` — re-exported from agent tools per the metavgc precedent
- `RosterDbError` / `RosterDataError` — DB layer
- `KnowledgeStorageError` — chunk reads in `cite.ts`

## 9. Rollout

No feature flag (additive read-only slice). Three new package.json scripts:

```json
"data:tactical":            "tsx scripts/data/tactical.ts",
"data:build-speed-table":   "tsx scripts/data/build-speed-table.ts",
"data:build-tactical-goldens": "tsx scripts/data/build-tactical-goldens.ts"
```

CLI subcommand surface:

```
pnpm data:tactical overview  <team-id>
pnpm data:tactical pillars   <team-id>
pnpm data:tactical recommend <team-id> [scenario-name]
```

Speed-table fixture is regenerated weekly (manually for v1; cron-style automation deferred to a future ops slice). The fixture file is committed; goldens are committed; scripts that produce them are also committed (per memory `test_fixtures_no_invariant_blobs.md` — generators, not opaque blobs).

## 10. Architecture patterns + WHY

### 10.1 No persistence in v1

Flow §8 binding. Compute-on-demand simplifies the surface — no migration, no cache invalidation logic across calls, no stale-row classification. Threat panel is cached **inside the `damage_calc` cache** for one call's lifetime; subsequent calls re-curate. Memory `single_db_non_destructive_build.md` lesson stays clean (no new mutable production state).

If/when the user calls overviews dozens of times per day, persistence becomes worth its weight. Until then, 5–15s per call is acceptable.

### 10.2 Two-tool agent split (Q8 binding)

`score_pillars` is the cheap, frequent surface — the agent calls it as a "tell me about the team" probe. `recommend_leads` is the targeted follow-up that drills into one scenario at a time. The agent loop can call `score_pillars` once and then choose which scenario to deepen — without burning compute on the 5–7 lead recommendations at the same time.

The composition pattern matches CLAUDE.md §9's prompt-caching rationale: cheap tools call often (cache-friendly); expensive tools call selectively. A single combined tool would force every "is my team good?" question to compute every scenario.

### 10.3 Per-call calc cache scope (Q5 binding)

The cache is per-`buildOverview` invocation. Reasons:

- Pillar scoring + per-scenario lead recommendation both call `damage_calc` for the same `(our_set, panel_set, field)` matrix (~85% overlap). Sharing within one call eliminates the duplication.
- Cross-call sharing requires invalidation logic (which scope of "team change" busts which subset of cache entries) — a real engineering surface that flow §8 said to defer.
- The cache lives on the heap; one overview's cache holds ≤ 1080 entries × ~200 bytes ≈ 200 KB. Bounded.

### 10.4 Calc determinism + golden fixtures (CLAUDE.md §4)

Pillar scores are derived from `damage_calc` results, which are deterministic given identical inputs. Golden fixtures pin the expected values for known-team-vs-known-panel inputs. **Any regression in `@smogon/calc`'s wrapped behavior surfaces as a TAC-T11 / T14 / T16 failure.** Per CLAUDE.md §4: if the calc disagrees with the public Showdown calculator, **we stop and investigate** — we do not adjust the golden.

Golden generation is reproducible: `scripts/data/build-tactical-goldens.ts` reads a known team + panel fixture, runs the engine, persists the JSON. Re-running on the same inputs must emit byte-identical output.

### 10.5 Speed-table fixture vs live query (Q9 binding)

`fixtures/speed/top50.json` is committed and refreshed weekly by `scripts/data/build-speed-table.ts`. v1 reads from the fixture for determinism + speed (no per-call DB query). Live-query is a future optimization.

The fixture format is JSON-Schema-validated at load time; corrupt fixture → fail loud at startup, never silently wrong.

### 10.6 Reg M-A pinning everywhere

Every threat-panel curation, scenario generation, pillar score, and citation pull filters by `roster_membership.is_legal=1` for `format='RegM-A'`. Memory `regulation_m_a_roster.md` is binding. Ditto Tera (memory `regulation_m_a_no_tera.md`): no input ever carries Tera; defense-in-depth Tera-key strip per TAC-T5.

## 11. Reuse audit

| Capability | Source | Disposition |
|---|---|---|
| Damage rolls | `src/tools/damage-calc/index.ts` | as-is |
| Speed comparison | `src/tools/damage-calc/mapping.ts` (helper for speed mod) | as-is |
| Team read | `src/db/user-teams.ts::get` | as-is |
| Tournament team / set reads | `src/db/tournaments.ts`, `src/db/sets.ts` | as-is |
| Pikalytics usage / teammates | `src/db/pikalytics.ts` | as-is |
| Knowledge chunk search | `src/db/knowledge.ts::search` (with `species_id_filter`) | as-is |
| Insights read | `src/db/insights.ts` | as-is (read-only — no insight extraction in this slice) |
| Roster lookup | `src/db/roster.ts` | as-is |
| Species stats | drizzle `speciesStats` | as-is |
| Anthropic tool registry | `src/db/tool-definitions.ts` | extend with 2 new tools |
| Validation gate (saved + 0 errors) | `src/db/user-teams.ts::get` returns the team; we check `status` + `validation_errors.length` ourselves | as-is |
| ULID minting | `src/db/ulid.ts` | as-is (only for golden-fixture ids) |
| Existing error classes | `src/schemas/errors.ts` | extend with 4 new |

**Net new modules:** all under `src/data/tactical/` + `src/agents/tactical-tools.ts` + `src/schemas/tactical.ts` + 2 scripts + fixtures. Nothing in `src/tools/` (we're not exposing a new MCP-shaped data source — we're orchestrating existing ones).

## 12. Stage-6 deferred TODOs

Each marked inline `// TODO(stage6-deferred): <slug>` per memory `labmaus_pokepaste_deferred_todos.md`.

| # | Item | Annotation site (planned) | Trigger to revisit |
|---|---|---|---|
| 1 | Persistence — `tactical_overview_cache` table + invalidation | top of `src/data/tactical/overview.ts` | overview-call frequency > 5/day OR p95 latency complaint |
| 2 | User-tunable α/β/γ coefficients (Q6) | `src/data/tactical/recommend-leads.ts` | second user with different play style |
| 3 | Replay-grounded validation (compare predictions to actual replay outcomes) | new module — see future flow | after first month of usage |
| 4 | Multi-team comparison (`tactical compare A B`) | `scripts/data/tactical.ts` | team-iteration UX feedback |
| 5 | Live-query speed table (Q9 future optimization) | `src/data/tactical/speed-table.ts` | when fixture regen cadence proves too slow |
| 6 | Synergy weight tuning from KB data (Q4) | `src/data/tactical/score-synergy.ts` | once Insights pipeline exists with archetype-specific evidence |
| 7 | TR inversion threshold tuning (Q3) | `src/data/tactical/score-speed.ts` | first false-positive / false-negative report |
| 8 | Cross-call cache (memo'd by team_id + panel as_of) | `src/data/tactical/calc-cache.ts` | with persistence (#1) |
| 9 | Per-pillar TSDoc with worked examples | each `src/data/tactical/score-*.ts` | reviewer focus area |
| 10 | Customizable threat panel | `src/data/tactical/threat-panel.ts` | power-user feedback |

## 13. Definition of Done — CLAUDE.md §11 mapping

- [x] Flow doc exists and reviewed — `docs/flows/team-tactical-overview.md` (Stage 1–2 complete, Reviewed-by: Rodrigo Caballero).
- [ ] Tech plan exists and approved — **this file**, awaiting Stage 2 approval.
- [ ] Failing test was written first — Stage 4 will commit `test: red — team-tactical-overview` with TAC-T1..T47 failing for the right reason; per Q9 USR-T1..T6-style batch ok for TAC-T1..T6 (pure-data), strict per-test for everything else.
- [ ] All tests pass locally — Stage 5 gate.
- [ ] Types check — Stage 5 gate.
- [ ] Lint clean — Stage 5 gate (no `pnpm lint` script in this repo; typecheck stands in).
- [ ] New external data is schema-validated and fixture-backed — speed table + tactical goldens both schema-validated via zod; `fixtures/tactical/` checked in.
- [ ] User-facing claims cited — every `ScenarioOverview` carries `citations: KnowledgeCitation[]` with `source_url`; agent tool descriptions instruct quoting.
- [ ] Docs touched — this plan + flow + (Stage 5) `src/data/tactical/SPEC.md` per CLAUDE.md §8.
- [ ] Reviewer subagent ran — Stage 6 gate.

## 14. Risks + mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `damage_calc` cost balloons (~1080 calls × ~10ms = ~10s floor) | High | Medium | Per-call cache (Q5); golden-fixture pillar tests use small synthetic panel to keep test runtime cheap; persistence (deferred §12.1) the long-term answer |
| Threat panel staleness — pikalytics ingest lags meta shifts | Medium | Medium | Silent regen on new snapshot (Q7); admin script `pnpm data:ingest:pikalytics` documented in `tactical/SPEC.md` |
| Scenario weakness-detection false positives (Q2: niche species generates noise scenarios) | Medium | Low | `weakness_ohko_ratio` threshold tunable in deps (TAC-T27); v1 default 0.5 (≥ 4/6 OHKO); deferred tuning §12.7 |
| Synergy archetype detector drifts as meta evolves (rule-based; static) | High over months | Low | Marked Stage-6 deferred (§12.6) — once Insights pipeline lands, switch to data-driven detection |
| Speed-table fixture vs live data drift | Medium | Low | Weekly regen cadence; live-query as Stage-6 (§12.5); fixture schema-validated at load (fail loud) |
| Calc engine API change (`@smogon/calc` upgrade breaks our wrapper) | Low | High | Golden fixtures (TAC-T11 / T14 / T16) catch immediately; pin minor version in `package.json` |
| Lead-coefficient defaults (α/β/γ) don't match user's play style | Medium | Low | Stage-6 customization (§12.2); user can edit constants until then |
| Cache memory unbounded under pathological team mutations within one call | Low | Low | Cache keyed on `(our_set hash, panel_set hash, field hash)` — bounded by team size × panel size; ≤ 1080 entries; ~200 KB |
| Two-tool split confuses agent (calls `recommend_leads` without `score_pillars` first) | Medium | Low | Tool descriptions explicitly chain ("Use AFTER score_pillars"); agent prompt cache picks up the discipline |
| Citations pull stale chunks (ingested before a roster change) | Low | Low | `knowledge_chunks.fetched_at` carried through; v1 doesn't filter; deferred to Insight pipeline |

## 15. Open questions for plan review

1. **`ScenarioOverview` vs CLAUDE.md §7 `LeadPlan`.** §7 defines a single-scenario `LeadPlan` (one primary + 3–4 alternatives, all against ONE opponent preview). This slice's `ScenarioOverview` is multi-scenario (one entry per scenario, no internal "alternatives"). **Proposal: keep them parallel** — `ScenarioOverview` is per-scenario; `LeadPlan` is the agent-loop's single-game-prep output. A future slice composes them. Confirm or push back.
Answer: Yeah, let's keep them parallel for clarity. `ScenarioOverview` is the data shape for each scenario's analysis; `LeadPlan` is the agent's synthesized recommendation for a single scenario. We can compose them in a future slice when we build the agent's overall recommendation flow. This keeps the tactical slice focused on analysis and the agent slice focused on synthesis. Confirmed.

2. **Golden fixture generation cadence.** Goldens lock specific score values. When the calc engine is upgraded or our threat panel changes, goldens drift. **Proposal: regenerate goldens on every threat-panel change** (deterministic given inputs); commit the diff for review. Reviewer can spot suspicious shifts. Confirm.
Answer: Agreed.

3. **Cache scope on tool re-invocation.** If the agent calls `score_pillars` then `recommend_leads` for the same team, both build their own cache (per Q5 "per-call"). That's ~5–8s × 2 = 10–16s total vs. ~12s if shared. Cross-call cache adds invalidation complexity — defer (§12.8) or address now? **Proposal: defer.** Confirm.
Answer: Address now.

4. **Weakness-counter scenario naming.** Scenarios surface as strings like `"vs Mega Charizard Y"`. Weakness-counters could surface as `"weakness: Mega Glimmora"` or just `"vs Mega Glimmora"`. **Proposal: `"vs <species> (counter)"` for weakness-detected, plain `"vs <species>"` for top-usage individuals.** Stage 4 tests pin the convention. Confirm.
Answer: Yeah, let's go with `"vs <species> (counter)"` for weakness-detected scenarios. This makes it clear to the user that this scenario is highlighting a specific vulnerability in their team, rather than just a common opponent. The "(counter)" suffix signals that this is a scenario they should be particularly concerned about. Confirmed.

5. **Speed-table format.** `top50.json` could be flat array or keyed-by-species map. **Proposal: flat array sorted desc by `usage_weighted_speed = base_spe × usage_pct_normalized`.** Each entry: `{ species_id, base_spe, common_nature, usage_pct, weighted_speed }`. Confirm or propose alternate.
Answer: Flat array sorted by `usage_weighted_speed` makes sense for our use case, since we'll often want to quickly find the top N fastest species. It's important that we can consider an scenario were a species has a different natures to consider, for instance Garchomp with Jolly vs Adamant. We can include the `common_nature` field to help with that. Confirmed.

6. **Insights vs `knowledge_chunks` for citations.** The flow §3 says "knowledge_chunks for citations." CLAUDE.md §6 specifies `Insight` as the canonical citation primitive. **Proposal: cite `knowledge_chunks` directly in v1** since the Insight extraction pipeline doesn't exist yet (deferred to its own slice); migrate to `Insight` once it lands. The tool-output schema names the field `citations: KnowledgeCitation[]` so a future swap is non-breaking. Confirm.
Answer: Citing `knowledge_chunks` directly in v1 is a pragmatic choice given that the Insight extraction pipeline isn't ready yet. 

7. **TR inversion: which abilities count as "TR setter"?** Proposal: hardcoded list `{ Indeedee-* with Psychic Surge variants, Farigiraf with Armor Tail (per the metavgc article), any species with Trick Room in its movepool that the team actually slotted }`. The third clause is the safest signal; the first two are anti-redundancy bets. Confirm or specify a different rule.
Answer: The proposed rule seems reasonable. The presence of Trick Room in the movepool combined with actually slotting it is a strong signal that the team is designed to use Trick Room. 

---

**Reviewed-by:** _Rodrigo Caballero_


---

## 16. Stage-3 review answers — plan amendments (2026-05-08)

The §15 answers from Rodrigo bind the implementation. Two real overrides shift §10 + §5:

### 16.1 Q3 override — cross-call calc cache ships in v1

§10.3 said "per-call scope only." Q3 answer says **address now**. Updated design:

- `src/data/tactical/calc-cache.ts` exposes a **module-scoped** cache (process-lifetime, in-memory only — no SQLite persistence; that stays Stage-6 §12.1).
- Cache key: `${our_set_hash}:${panel_set_hash}:${field_hash}` (sha256 of canonical-JSON inputs).
- Invalidation: a `revalidate(deps)` helper called by both agent-tool handlers and the CLI orchestrator at the start of every overview/pillar/recommend call. It computes:
  - `current.team_updated_at = userTeams.get(team_id).updated_at`
  - `current.panel_as_of = threatPanel.as_of`
  - If different from the cache's `last_seen` for that team/panel, drop only the keys touching the changed inputs.
- Tests TAC-T33–T35 (cache hit / set mutation invalidates / scope) extend to cover **cross-call** behavior:
  - **TAC-T33 (revised):** two consecutive `score_pillars` calls for the same `(team, panel_as_of)` → second call hits cache, calc engine called only on the first.
  - **TAC-T34 (revised):** mutate one set on the team between calls → only the rows touching that set are recomputed; ~85% cache survival.
  - **New TAC-T35a:** advancing the threat panel `as_of` (new pikalytics snapshot) drops all panel-related entries for every team.
- Stage-6 §12.8 ("cross-call cache") is **removed** from the deferred list.

Cost: cache is a `Map` on the heap, bounded by `unique_teams × unique_panel_setups × ≤1080` ≈ a few MB at realistic scale. Stage-5 reviewer should check memory bounds + add an LRU eviction stub if `Map.size > 100_000`.

### 16.2 Q5 amendment — speed table supports nature variants

§5.9 + §10.5 said "flat array sorted desc by `usage_weighted_speed = base_spe × usage_pct_normalized`." Q5 answer says species like Garchomp split usage between Jolly and Adamant, and **both natures matter** at distinct speed tiers. Updated design:

- Each `top50.json` entry carries `nature_variants: Array<{nature, share, weighted_speed}>` instead of a single `common_nature`.
- The flat array sort key remains `usage_weighted_speed` of the **dominant** nature (entry's primary tier), but the speed-pillar scorer uses the variant distribution: the score weights "outspeed dominant Garchomp" by `share` and "outspeed alternate Garchomp" by `1 - share`.
- Entry shape (zod):
  ```ts
  { species_id: string,
    base_spe: number,
    usage_pct: number,                      // normalized ~0..1
    nature_variants: Array<{
      nature: string,                       // "Jolly" | "Adamant" | …
      share: number,                        // 0..1, sum to 1.0 across variants
      weighted_speed: number,               // base_spe × nature_modifier × share
    }>,
    primary_weighted_speed: number,         // sort key
  }
  ```
- TAC-T46 extends to assert that for at least one species (e.g. Garchomp) the entry carries ≥ 2 nature variants summing to share=1.0.
- The speed-table generator (`scripts/data/build-speed-table.ts`) reads pikalytics `*_json` columns to extract per-nature share when available; falls back to single-variant when only one nature appears in the snapshot.

### 16.3 Other answers (no override)

- Q1 (LeadPlan parallel) ✓ as in §3.
- Q2 (regen goldens on threat-panel change) ✓ — `scripts/data/build-tactical-goldens.ts` already designed for this.
- Q4 (weakness scenario naming `"vs <species> (counter)"`) ✓ — TAC-T26 will assert the suffix.
- Q6 (cite `knowledge_chunks` v1) ✓.
- Q7 (TR setter rule) ✓.

---

**Reviewed-by:** Rodrigo Caballero (2026-05-08, see §15 + §16)
