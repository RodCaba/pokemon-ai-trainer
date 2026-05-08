# Flow: team-tactical-overview

**Slug:** `team-tactical-overview`
**Status:** Stage 1 — flow draft
**Author:** Claude (Opus 4.7)
**Date:** 2026-05-08

## 1. Why this slice

The `user-teams` slice persists teams; this slice **scores them**. A
saved team without diagnostic feedback is just a roster. The user
needs:

- A read on the team's offensive/defensive/speed/synergy posture vs
  the actual Reg M-A meta — not vs hand-curated rules of thumb.
- Per-scenario lead recommendations (what 2 to bring against Sun, vs
  Mega Charizard, etc.) backed by **real damage rolls and citations**.
- A repeatable, explainable signal so the user can iterate.

This is the metavgc tactical-overview feature, **rebuilt on our infra
to exceed the bar**:

| | metavgc | This slice |
|---|---|---|
| Damage scoring | base-stat × multiplier proxy | actual `@smogon/calc` 16-roll arrays + KO chances |
| Speed scoring | "Perfect / OK" labels | usage-weighted speed-tier matrix vs top-N labmaus species |
| Defense scoring | bulk-stat sum heuristic | incoming damage from threat panel against each of our slots |
| Synergy scoring | rule-based archetype tags | data-driven: pikalytics teammate co-occurrence + archetype detection |
| Scenarios | 7 hand-curated | 5–7 generated from labmaus archetype clustering + top usage |
| Lead recommendation | exhaustive 15-pair search, single score | exhaustive 15-pair search, scored against scenario-specific calc/speed |
| Citations | none | every recommendation surfaces 1–3 supporting `knowledge_chunks` (filterable by `species_id`) and/or `tournament_results` |

## 2. User flow

The user starts with a **saved** `user_team` (status='saved'; this slice
is read-only over user-teams).

1. User asks (CLI in v1, UI in a future slice; agent surface always):
   *"Score my team and tell me how to play it."* They reference a team
   by id or name.
2. System computes pillar scores + scenarios (a single end-to-end pass,
   ~5–15 seconds depending on threat panel size).
3. System returns a `TeamTacticalOverview` containing:
   - Pillar scores (offense/defense/speed/synergy, each 0–100 + tier
     label).
   - Per-pillar evidence (e.g. "Offense 84/Good — top KO chances vs the
     threat panel: 78% on Incineroar, 62% on Mega Glimmora, …").
   - 5–7 scenario blocks, each with:
     - Recommended leads (2 species)
     - Backline (2 species)
     - Rejected bench (2 species)
     - Reasoning summary (3–4 sentences citing key calcs + 1–3
       knowledge_chunk citations)
4. User reads the overview. May iterate on the team via `user-teams`
   tools, then re-score.

The agent loop can also invoke this directly:
*"User says: I'm preparing for the Drywalls Series — how does my team
look?"* → agent calls `team_tactical_overview(team_id)` →
agent quotes pillar scores + scenario picks back to the user.

## 3. Tech flow

```
user_team_id ─► userTeams.get ─► UserTeam (validated, saved)
                                      │
                                      ▼
                          buildThreatPanel(db) ─────┐
                                      │              │
                          buildScenarios(db, team) ──┤
                                      │              │
                                      ▼              ▼
                          ┌───────────────────────────────────┐
                          │ scoreOffense(team, panel) ──► O   │
                          │ scoreDefense(team, panel) ──► D   │
                          │ scoreSpeed  (team, panel) ──► S   │
                          │ scoreSynergy(team, db)    ──► Y   │
                          └───────────────────────────────────┘
                                      │
                                      ▼
                          for each scenario:
                            for each (lead pair, back pair, bench pair):
                              scorePair(team, scenario)
                            pick best
                            attach citations from knowledge_chunks
                                      │
                                      ▼
                          TeamTacticalOverview { pillars, scenarios }
```

Reuse:

- `src/db/user-teams.ts` — `get(db, id)` (read the team)
- `src/db/tournaments.ts` — read tournament_teams + team_sets
  (threat panel + archetype clustering)
- `src/db/pikalytics.ts` — `get` / `usage` / `teammates` (synergy +
  threat usage weights)
- `src/db/knowledge.ts` — `search` (with `species_id_filter` via
  link table) for citations
- `src/db/roster.ts` / `src/db/species-stats` — base stats + abilities
- `src/tools/damage-calc/` — the calc engine (reuse, no new tool)
- `src/db/insights.ts` — Insights (read for citations; this slice
  doesn't extract)

New, slice-specific:

- `src/data/tactical/threat-panel.ts` — curate top-N species + canonical
  set per species from labmaus + pikalytics.
- `src/data/tactical/scenarios.ts` — generate 5–7 scenarios:
  archetype clusters (Sun / Rain / Trick Room / Tailwind HO / Snow) +
  top-3 individual threats by usage.
- `src/data/tactical/score-offense.ts` — for each (our set, threat set),
  call `damage_calc`, aggregate → offense score.
- `src/data/tactical/score-defense.ts` — inverse: incoming damage from
  threat panel against each of our slots.
- `src/data/tactical/score-speed.ts` — speed-tier matrix; TR-aware
  inversion when team has a TR setter + slow attackers.
- `src/data/tactical/score-synergy.ts` — pikalytics teammate
  co-occurrence sum + archetype match bonus.
- `src/data/tactical/score-pair.ts` — scenario-specific pair scoring
  (used inside the lead recommendation loop).
- `src/data/tactical/recommend-leads.ts` — exhaustive 15-pair search.
- `src/data/tactical/cite.ts` — pull 1–3 supporting `knowledge_chunks`
  per scenario via `search` with `species_id_filter`.
- `src/data/tactical/overview.ts` — top-level orchestrator.
- `src/agents/tactical-tools.ts` — Anthropic tool: `team_tactical_overview`.
- `scripts/data/tactical.ts` — CLI: `overview <team-id>`.

Cross-cutting:

- `fixtures/speed/top50.json` — currently absent (CLAUDE.md §4
  mentions it). Generated from labmaus + pikalytics usage-weighted; this
  slice produces the first version.
- New caching seam: threat-panel curation hits `damage_calc` ×
  `pikalytics.get` × `roster.get` heavily; cache the panel itself per
  `as_of` (the latest pikalytics snapshot date) to avoid recomputation
  across team-overview calls.

## 4. Threat panel (the load-bearing primitive)

Without a curated list of "what the meta looks like right now," none of
the four pillars are meaningful. The threat panel is a list of N (target
~15) species + their canonical set, weighted by usage.

Source priority:

1. **pikalytics_snapshots** — `as_of` = latest snapshot date.
   `usage_percent` is the per-species weight. Items / abilities / moves
   come from the snapshot's `*_json` columns.
2. **labmaus team_sets** — fallback for species that don't have a
   pikalytics snapshot yet (e.g. early-format coverage). Take the most-
   common SPS spread + moveset by frequency across `team_sets` for that
   species.

Shape:

```ts
ThreatPanel {
  as_of: ISO date,
  generated_at: ISO date,
  entries: ThreatEntry[],   // length ~15
}

ThreatEntry {
  species_id: string,
  weight: number,           // normalized usage % (sum to 1.0 across panel)
  set: TeamSet,             // canonical set (item, ability, nature, SPS, moves)
  source: { type: 'pikalytics' | 'labmaus_consensus', as_of: ISO },
}
```

Caching: keyed on the latest pikalytics `as_of`. When a new pikalytics
ingest lands, the next overview call regenerates the panel.

## 5. Pillar scoring

### 5.1 Offense (0–100)

For each of our 6 sets × each threat panel entry:

1. Run `damage_calc(our_set → threat_set, scenario_field)` for the **best
   move** in our moveset (max expected damage). Capture max-roll % and
   2HKO probability.
2. Per-threat outcome score: `min(1.0, max_roll_pct/100) × weight` —
   if we OHKO, score 1.0; if we 2HKO, ~0.6; etc.
3. Aggregate: weighted mean across the panel × 100 → pillar score.

Tier labels: 0–40 Weak / 41–60 OK / 61–80 Good / 81–100 Strong.

Evidence surfaced: top 3 KO chances + the worst 2 (panel members our
team can't break).

### 5.2 Defense (0–100)

Inverse: for each threat panel entry × our 6 sets:

1. `damage_calc(threat_set → our_set, scenario_field)` for the threat's
   **best move**.
2. Outcome: 1.0 if we survive 2 hits, 0 if we get OHKO'd. Linear
   interpolation in between.
3. Aggregate: weighted mean across panel × 100.

Evidence: which slots are OHKO'd by which threats; weakest slot.

### 5.3 Speed (0–100)

For each of our 6 sets × each threat entry:

1. Apply speed modifiers (Choice Scarf, +50% Tailwind, ½ Trick Room
   speed inversion) per the scenario's `field` if applicable.
2. Outcome: outspeeds=1.0, ties=0.5, outsped=0.
3. Weighted mean × 100.

TR inversion: if team has a TR setter (Indeedee/Farigiraf/etc.) +
≥ 2 slow attackers (base spe < 60), score the team's "slow side" instead
— scenarios with TR active flip the comparison.

Evidence: our fastest unmodified Pokémon's speed tier; what % of the
panel we outspeed naked vs in tailwind.

### 5.4 Synergy (0–100)

Two components, summed:

1. **Teammate co-occurrence** (60 pts max): for each of C(6,2)=15 pairs
   on our team, look up the pikalytics teammate % between them. Sum
   normalized.
2. **Archetype detection** (40 pts max): hard-coded checks for known
   patterns: Weather (Pelipper/Torkoal/Hippowdon/Abomasnow + ability
   match), Redirection (Follow Me / Rage Powder), Fake Out core,
   Trick Room core, "Good Stuff" balance (per metavgc's published
   heuristic). Each detected archetype contributes 10–20 pts.

Evidence: top teammate-co-occurrence pairs; detected archetype tags.

## 6. Scenarios

A scenario is `{ name, field, opposing_team }` plus a tag for
classification.

### 6.1 Generation

1. **Archetype clusters** (target 3): cluster `tournament_teams` from
   the most recent N events by member-set similarity (Jaccard on
   species + ability + key items). Top 3 archetype centers become
   scenarios. Each carries its own representative `opposing_team` (the
   most-frequent team within the cluster) + a `field` config (weather
   etc.).
2. **Individual threats** (target 2–4): top-K species by raw usage from
   pikalytics. Each becomes a scenario where the `opposing_team` is the
   species's canonical set + 5 most-common teammates from the
   pikalytics teammate JSON.

Total 5–7 scenarios.

### 6.2 Per-scenario lead recommendation

Identical algorithm to metavgc's:

1. Enumerate all C(6,2)=15 lead pairs from our team.
2. For each pair: score = `α·offense(pair → opp_leads) + β·speed(pair vs
   opp_leads) − γ·defense_loss(opp_leads → pair)`.
3. Pick top scoring pair as recommended leads.
4. Backline = the next best 2 from the remaining 4.
5. Rejected bench = the remaining 2.
6. Attach citations: 1–3 `knowledge_chunks` retrieved with
   `species_id_filter = leads ∪ opposing_leads`.

## 7. Output shape

`TeamTacticalOverview`:

```ts
{
  schema_version: 1,
  team_id: string,
  generated_at: ISODateTime,
  threat_panel_as_of: ISODate,
  pillars: {
    offense:  { score: 0..100, tier: "Weak" | "OK" | "Good" | "Strong",
                evidence: { top: ThreatHit[], worst: ThreatHit[] } },
    defense:  { /* same shape */ },
    speed:    { /* same shape */ },
    synergy:  { score, tier, evidence: { archetypes: string[],
                                          top_teammate_pairs: ... } },
  },
  scenarios: ScenarioOverview[],
}

ScenarioOverview {
  name: string,                          // "Sun" / "Trick Room" / "vs Mega Glimmora"
  type: "archetype" | "individual",
  opposing_preview: string[],            // 4–6 species
  recommended_leads: [string, string],
  recommended_backline: [string, string],
  rejected_bench: [string, string],
  reasoning: string,                     // ≤ 400 chars; cites calcs + chunks
  key_calcs: CalcResultRef[],            // 1–3
  citations: KnowledgeCitation[],        // 1–3
  pair_score: number,                    // raw score from §6.2 step 2
}
```

CLAUDE.md §7 specifies a `LeadPlan` shape; `ScenarioOverview` is its
sibling (multi-scenario instead of preview-specific). Tech plan
resolves whether to converge them.

## 8. Persistence

**Compute on demand for v1.** The threat panel is cached
(invalidated on new pikalytics snapshot); per-team overviews are
computed fresh every call (~5–15s).

Persistence as a follow-up slice (`team-tactical-overview-cache`)
if the user calls overviews frequently and wants instant reads. Out
of scope today.

## 9. Error / empty states

- **Team has unresolved validation errors** → refuse, return
  `{ ok: false, errors: [...] }`. The user should fix via the
  user-teams flow.
- **Team is `'draft'`** → refuse; only `'saved'` teams are scored. (The
  user's draft is presumed unstable.)
- **Threat panel is empty** (no pikalytics snapshots yet) →
  fall back to labmaus consensus only; if that's also empty, refuse
  with a clear error.
- **`damage_calc` fails for a specific (our_set, threat_set) pair** →
  log, skip that pair, continue. The pillar score is computed over the
  surviving pairs.
- **No knowledge_chunks match a scenario's species filter** → emit the
  scenario without citations; do not block.

## 10. Success criteria

- Score MarvVGC's tournament-winning team (`labmaus:56914:244865`,
  duplicated into a user_team) end-to-end in < 20 seconds.
- All four pillars produce 0–100 scores with at least one piece of
  evidence per pillar.
- ≥ 5 scenarios generated; each has a primary lead pair + back +
  rejected; ≥ 3 of them surface ≥ 1 knowledge_chunk citation.
- Re-scoring the same team twice produces identical pillar scores
  (deterministic given a fixed threat panel).
- Editing one set on the team and re-scoring shows score deltas in the
  expected direction (e.g. swapping a Choice Scarf onto our Garchomp
  raises the speed pillar).
- Every existing user-teams / metavgc / labmaus / pikalytics test stays
  green.

## 11. Out of scope (deferred)

- **Persistence / caching of overviews** — see §8.
- **Insight-driven reasoning** — this slice retrieves
  `knowledge_chunks` directly. The Insight pipeline (CLAUDE.md §6) is
  its own future slice.
- **Live web UI** — CLI + agent tool only.
- **Multi-team comparison** — score one team at a time; team-vs-team
  comparison is a follow-up.
- **Replay-grounded validation** — comparing our score predictions
  against actual Showdown replay outcomes is a research slice.
- **Threat-panel customization** — user can't override the panel in
  v1. They can edit pikalytics snapshots, which feeds in.

## 12. Open questions for Stage 2 review

1. **Threat panel size N.** Proposal: **15** species (covers the meaty
   middle of usage; 95% of opponent contact). Alternatives: 10
   (faster, less coverage) or 25 (slower, marginal coverage gain).
   Answer: Go with 15, test on the live demo and pivot if performance is an issue. Damage calc shouldn't be an issue since computations are fast.

2. **Scenario count.** Proposal: **5–7** (3 archetype + 2–4 individual).
   Alternatives: 3 (just archetypes, leaner) or 10+ (all individual
   threats, expensive).
   Answer: 5–7 seems like a sweet spot for v1; we want enough variety to be meaningful but not so many that it overwhelms the user or causes performance issues. We can always add more scenarios in future iterations if users want deeper analysis. Scenario should consider weaknesses of the team, so if there are clear weaknesses to specific threats, those should be included as scenarios even if they aren't in the top 15 overall.

3. **TR inversion threshold.** Proposal: TR-active scoring kicks in if
   team has a TR setter ability AND ≥ 2 attackers with base speed < 60.
   Confirm or adjust thresholds.
   Answer: This is a good starting point, but we should be open to adjusting the thresholds based on testing. The key is to capture the cases where TR fundamentally changes the speed dynamics of the team. We can analyze existing teams and see if this heuristic captures the intended cases or if we need to tweak it (e.g. maybe it's 1 slow attacker instead of 2, or maybe certain key Pokémon trigger it regardless of count).


4. **Synergy scoring split** (60/40 between teammate-cooccurrence and
   archetype detection) — feels arbitrary. Confirm or propose
   alternate weights.
   Answer: The 60/40 split is a starting point based on intuition about the relative importance of raw teammate synergy vs fitting into known archetypes. However, this is definitely something we should be open to adjusting based on the knowledge base date we gather (vector data)

5. **`damage_calc` budget.** Worst case: 6 our × 15 panel × 2 directions
   × ~6 scenarios = ~1080 calls per overview. At ~10ms each = 10s.
   Tolerable? Or do we cache per (our_set, panel_set, field) pair so
   re-scoring after one edit reuses ~85% of calls?
   Answer: 10s is on the higher end but still within a tolerable range for a deep analysis feature like this. Caching could definitely help with performance, especially for re-scoring after edits. We can implement a simple in-memory cache keyed by (our_set, panel_set, field) that stores the calc results during the overview generation. This way, if the user makes a small edit and re-scores, we can reuse most of the previous calculations and significantly reduce the time for subsequent runs.

6. **Lead recommendation cost coefficient (α/β/γ).** Proposal:
   `α=1.0, β=0.5, γ=0.7`. Hand-tuned starting point; tunable per
   user's preferred play style. v1 ships with hard-coded defaults.
   Answer: The proposed coefficients are a reasonable starting point, but we should be open to adjusting them based on user feedback and testing. The relative importance of offense, speed, and defense can vary greatly depending on the user's play style and the specific team composition. In future iterations, we could even consider allowing users to customize these coefficients to tailor the lead recommendations to their preferences.

7. **Stale overview detection.** If pikalytics snapshot updates between
   calls, do we transparently re-curate the panel and re-score, or
   surface a "your previous overview is now N hours stale" hint? v1
   regenerates silently. Confirm.
   Answer: For v1, silently regenerating the overview when a new pikalytics snapshot is detected is a good approach to ensure users always have the most up-to-date analysis without needing to manually refresh. However, we should consider adding a subtle indicator in the UI that shows when the overview was last generated and when the latest snapshot was ingested. This way, users are aware of the freshness of their analysis without it being intrusive.

8. **`team_tactical_overview` agent tool surface.** Proposal: a single
   tool with `format` + `team_id` inputs, returns the full
   `TeamTacticalOverview` JSON. Agent quotes pieces back to user.
   Alternative: separate `score_pillars` and `recommend_leads` tools so
   the agent can pick what to ask. v1 single-tool.
   Answer: I'll split the tool into two: `score_pillars(team_id)` that returns the pillar scores and evidence, and `recommend_leads(team_id, scenario_name)` that returns the lead recommendations and citations for a specific scenario. This way, the agent can first call `score_pillars` to get an overall sense of the team's strengths and weaknesses, and then call `recommend_leads` for specific scenarios that it identifies as relevant based on the pillar scores. This modular approach gives the agent more flexibility in how it uses the tactical overview data.

9. **Speed table seed.** The flow says we generate `fixtures/speed/top50.json`
   from labmaus + pikalytics. Tech plan: should this live as a
   committed fixture (regenerated weekly per CLAUDE.md §4) or be a
   live query against `pikalytics_snapshots` every call? v1 fixture;
   live-query as a future optimization.
   Answer: For v1, using a committed fixture that is regenerated on a regular cadence (e.g., weekly) is a good approach to ensure consistent performance while still keeping the data relatively fresh. 

10. **Scoring against Reg M-A only** — confirm. Champions adds species
    mid-format; the threat panel honors `roster_membership.is_legal=1`.
    Answer: Yes, we'll focus on Reg M-A legality for the threat panel and scoring. 

## 13. Reviewed-by

Reviewed-by: _Rodrigo Caballero_
