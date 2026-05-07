# Flow — Pikalytics Usage Stats

**Slug:** `pikalytics`
**Stage:** Stage 2 approved (2026-05-06). Tech plan (Stage 3) pending.
**Approved-by:** Rodrigo Caballero (2026-05-06)
**Author:** Claude (main agent)
**Date:** 2026-05-06

Pikalytics aggregates Showdown-ladder usage statistics per species per format. For Pokemon Champions Regulation M-A, the format slug is `gen9championsvgc2026regma`. The site exposes per-species pages with usage %, common items/abilities/moves/spreads, and — critically for this slice — **most-common-teammates** with co-occurrence percentages. The user's primary ask is teammate co-usage, so the agent can answer "what teams that play Garchomp also play Sneasler?" with a cited percentage.

This is **the third meta-intelligence source** alongside `labmaus-tournaments` (real-tournament-derived aggregates we recompute from raw teams) and `pokepaste-sets` (per-team set details). Each carries different signal: labmaus = real human tournament play, Pokepaste = how individual players actually built, Pikalytics = aggregate Showdown ladder behavior at scale. Recommendations cite all three so the agent can compare and explain divergence.

> **Critical access discovery:** Pikalytics ships an AI-optimized Markdown endpoint at `/ai/pokedex/<format>/<species>` that returns clean Markdown — no HTML scraping required. The site's `llms.txt` explicitly allows AI crawlers. We use this endpoint, not the human-facing HTML.

> **Critical Reg M-A hygiene:** Pikalytics's Champions pages must not surface Tera-related fields (Champions has no Tera). The transform asserts no `tera_*` field appears in any persisted record — same defensive policy as labmaus + pokepaste.

> **Scope boundary:** this slice ingests Pikalytics for **Reg M-A only**. The format slug is hard-coded; expanding to other regulations (Reg M-B etc.) is a follow-up. Munchstats (mentioned alongside Pikalytics in `CLAUDE.md` §1) gets its own flow doc when needed.

---

## 1. User flow

The Pikalytics ingest is **agent- and tool-facing**. End users experience it through three product surfaces.

### 1.1 Surface A — Teammate co-usage queries (primary)
1. Player asks the team builder "what pairs well with Sneasler?"
2. The agent calls `pikalytics.teammates(species="Sneasler")` → returns the top-N teammates ranked by co-occurrence %, each cited.
3. Result: "Sneasler's most common teammates on Showdown ladder: Kingambit (52.1%), Garchomp (46.8%), Basculegion (41.3%), Charizard-Mega-Y (33.5%) — pikalytics.com/pokedex/.../sneasler, as of 2026-05-07."
4. The agent compares against labmaus tournament data: "Of the 18 placing Sneasler+Kingambit teams in the last 30 days on labmaus, the pairing matches Pikalytics's #1 ladder co-usage." This cross-source confirmation is the primary intellectual lift the slice unlocks.

### 1.2 Surface B — Counter-meta planning
1. Player asks "what should I prepare for if I'm running team X?"
2. The agent looks up each species on team X via `pikalytics.get(species)` → builds a heat map of "what archetypes I'm likely to face based on what tends to be paired against my picks."
3. Without this slice, the agent's counter-meta intuition is ungrounded — it's reasoning from training data, not from current ladder behavior.

### 1.3 Surface C — Lead planner evidence completeness
1. The lead planner already cites real placing teams (labmaus + pokepaste); Pikalytics adds aggregate ladder evidence: "Pikalytics shows 87% of Sneasler players run Focus Sash; 12% Black Glasses. Real tournament samples (3) all ran Focus Sash. The ladder consensus matches."
2. When the two sources diverge, the agent surfaces the divergence to the user — that's a meta signal worth examining.

### Acceptance (user-perceived)
- For any Reg-M-A-legal species the agent asks about, `pikalytics.teammates()` returns ranked teammates with %.
- Every result carries `source_url` + `fetched_at` + `as_of` (Pikalytics's own publication date).
- No Tera-shaped field appears in any persisted Pikalytics record.
- Cold-start ingest of all Reg-M-A-relevant species finishes in under 10 minutes; weekly refresh in under 60 seconds when nothing changed upstream.

---

## 2. Tech flow

### 2.1 Module surface (final shape lands in tech plan)

```ts
// Tool layer — agent-callable per CLAUDE.md §8
pikalytics.fetchSpecies(args: {
  species_roster_id: string,
  format?: "RegM-A",            // default RegM-A; expansion deferred
}): Promise<PikalyticsSnapshot>

// Repository layer — over our SQLite store
pikalytics.get(db, args: {
  species_roster_id: string,
}): PikalyticsSnapshot | null

pikalytics.teammates(db, args: {
  species_roster_id: string,
  limit?: number,               // default 10
}): Array<{ roster_id: string, percent: number }>

pikalytics.usage(db, args: {
  format: "RegM-A",
  dimension: "species" | "item" | "ability" | "move" | "teammate",
  species_roster_id?: string,   // required for "item"/"ability"/"move"/"teammate"
  limit?: number,
}): UsageRow[]
```

The tool layer is a thin wrapper around the AI Markdown endpoint. The repository reads our local SQLite mirror, populated by a scheduled ingest worker.

### 2.2 Discovered API surface

```
GET https://www.pikalytics.com/ai/pokedex/<format-slug>/<species-slug>
  → 200 text/markdown; charset=utf-8
  → 404 if species or format unknown
```

- **Format slug:** `gen9championsvgc2026regma`. Hard-coded for this slice.
- **Species slug:** Showdown-style hyphenated lowercase. Derived from the roster's `display_name` field via `slug = displayName.toLowerCase()`. Examples: `garchomp`, `ninetales-alola`, `charizard-mega-y`, `floette-mega`. Notable: Mega forms use the `-mega[-x|-y]` suffix the same way our roster does after `b9a8d98`'s `normalizeSpeciesName` work.
- **`as_of` date** is a top-of-page line (`> Data as of 2026-05-07` or similar). The transform parses this and stores it on every row. Refresh policy keys on it.
- **No JSON API.** `.json` / `/api/` 404. The Markdown endpoint is the contract.
- **No auth.** No Cloudflare blocks for normal User-Agents. No rate-limit headers observed.
- **`robots.txt` + `llms.txt`** explicitly permit AI crawlers.

### 2.3 Markdown sample (verbatim from a real Pikalytics page)

```markdown
# Garchomp — Champions Reg M-A
> Data as of 2026-05-07 (millions of ranked battles)

## Usage
40.13%

## Common Teammates
- **Sneasler**: 46.767%
- **Kingambit**: 45.485%
- **Basculegion**: 38.819%
- **Charizard-Mega-Y**: 33.450%
- ...

## Common Moves
- **Earthquake**: 92.4%
- **Stone Edge**: 67.8%
- ...

## Common Items
- **Choice Scarf**: 28.1%
- **Loaded Dice**: 22.7%
- ...

## Common Abilities
- **Rough Skin**: 88.4%
- **Sand Veil**: 11.6%
```

The transform parses the `as_of` line + each section's `- **<name>**: <pct>%` rows. Sections we care about: **Usage**, **Common Teammates**, **Common Items**, **Common Abilities**, **Common Moves**. Sections we ignore: spreads (the SPS values are useful but format varies; defer to a follow-up).

### 2.4 Domain shape (sketch — final lands in tech plan)

```jsonc
// PikalyticsSnapshot — one row per (species, as_of)
{
  "schema_version": 1,
  "id": "pikalytics:gen9championsvgc2026regma:garchomp:2026-05-07",
  "format": "RegM-A",
  "format_slug": "gen9championsvgc2026regma",
  "species_roster_id": "garchomp",
  "as_of": "2026-05-07",
  "usage_percent": 40.13,
  "teammates": [
    { "roster_id": "sneasler",         "percent": 46.767 },
    { "roster_id": "kingambit",        "percent": 45.485 },
    { "roster_id": "basculegion",      "percent": 38.819 },
    { "roster_id": "charizardmegay",   "percent": 33.450 }
  ],
  "items":     [{ "name": "Choice Scarf", "percent": 28.1 }, ...],
  "abilities": [{ "name": "Rough Skin",   "percent": 88.4 }, ...],
  "moves":     [{ "name": "Earthquake",   "percent": 92.4 }, ...],
  "sample_size": null,                  // pikalytics doesn't expose absolute counts
  "source": {
    "site": "pikalytics",
    "source_url": "https://www.pikalytics.com/pokedex/gen9championsvgc2026regma/garchomp",
    "ai_url":     "https://www.pikalytics.com/ai/pokedex/gen9championsvgc2026regma/garchomp",
    "fetched_at": "2026-05-06T19:32:11Z"
  }
}
```

Provenance per CLAUDE.md §5 (`schema_version`, `source`, `fetched_at`, plus `as_of` for upstream's own publication date). Lists are stored as JSON columns rather than separate tables — pikalytics queries are coarse-grained ("top teammates"), and `json_each` covers the few queries that filter by name.

### 2.5 Roster-id translation

Pikalytics uses Showdown-style hyphenated slugs (`ninetales-alola`, `charizard-mega-y`); our roster uses no-hyphen ids (`ninetalesalola`, `charizardmegay`). Both directions of the conversion are deterministic given the roster's `display_name`:

- **roster id → pikalytics slug** (for URL building): take `species.display_name` from the roster, lowercase, that's the slug. `Charizard-Mega-Y` → `charizard-mega-y`. Same `display_name` field that already exists.
- **pikalytics slug → roster id** (for teammate resolution): the displayed teammate name is e.g. `Charizard-Mega-Y` (already capitalized, hyphenated). Pass to `roster.get(name, "RegM-A")` — the existing roster lookup matches on display_name + alias + canonical id, case-insensitive. Returns the canonical roster id (`charizardmegay`).

The `b9a8d98` `normalizeSpeciesName` helper from the pokepaste slice is **not needed here** — Pikalytics already writes Mega forms in our roster's canonical convention (no `Mega <X>` prefix style). Same code path used by `pokepaste-sets` would just no-op on these inputs.

### 2.6 Storage — extends the existing SQLite (Drizzle) DB

Per memory `db_orm_drizzle.md` and `single_db_non_destructive_build.md`, we extend `src/db/drizzle-schema.ts` with one new table; no new DB file.

```
pikalytics_snapshots
  id                  TEXT PK            -- "pikalytics:<slug>:<species>:<as_of>"
  format              TEXT NOT NULL      -- "RegM-A"
  format_slug         TEXT NOT NULL      -- "gen9championsvgc2026regma"
  species_roster_id   TEXT NOT NULL      -- FK soft-link to species.id
  as_of               TEXT NOT NULL      -- ISO date
  usage_percent       REAL NOT NULL
  teammates_json      TEXT NOT NULL      -- JSON array of {roster_id, percent}
  items_json          TEXT NOT NULL      -- JSON array of {name, percent}
  abilities_json      TEXT NOT NULL
  moves_json          TEXT NOT NULL
  sample_size         INTEGER NULL       -- nullable (pikalytics doesn't expose)
  source_url          TEXT NOT NULL
  ai_url              TEXT NOT NULL
  fetched_at          TEXT NOT NULL

  UNIQUE (species_roster_id, as_of)      -- one row per species per upstream snapshot date
```

Indexes:
- `pikalytics_snapshots(species_roster_id, as_of DESC)` — "give me the latest snapshot for X."
- `pikalytics_snapshots(as_of)` — bulk freshness queries.

Following the labmaus precedent: this slice is **production state, not a build artifact**. The roster build never touches this table.

### 2.7 Ingest pipeline

```
                       scripts/data/ingest-pikalytics.ts
                       (cron weekly, manual once)
                                  │
                                  ▼
                roster.list({ format: "RegM-A" })   ← all 286 species
                                  │
                                  ▼
       for each species: derive slug from display_name
                                  ▼
      pikalytics.fetchSpecies({ species_roster_id })  (throttled, cached)
                                  │
            ┌─────────────────────┴─────────────────────┐
            ▼                                           ▼
  parse Markdown → snapshot                404 → log, skip species
            │
            ▼
   resolve teammate roster_ids via roster.get()  ← case-insensitive,
                                                   handles display-name lookup
            │
            ▼
   skip-existing on (species, as_of) → INSERT ... ON CONFLICT DO NOTHING
```

- **Skip-existing semantics** match the labmaus + pokepaste pattern (per `single_db_non_destructive_build.md` and labmaus plan §19.2). If `(species_roster_id, as_of)` already exists, no-op. Re-runs are free.
- **Cold start vs incremental:** cold = iterate all 286 roster species; incremental = same loop, but cache hits + skip-existing means existing snapshots no-op. The first run of a new week sees Pikalytics's `as_of` advance and ingests a fresh row per species.
- **Throttle.** 1 RPS via the shared `_shared/throttle.ts` (per-host bucket, same primitive labmaus + pokepaste use). Pikalytics has Cloudflare; politeness is the courteous default.
- **Cache.** Read-through disk cache via `_shared/file-cache.ts` keyed on `<species-slug>_<as_of>` (content-addressed-ish — same species + same publication date = same response). TTL = `Number.POSITIVE_INFINITY` since the body is stable per upstream snapshot.
- **Failure handling.**
  - 404 on the AI endpoint → species not in Pikalytics's coverage; log to run summary, continue. Likely a roster-only species with no ladder presence.
  - Markdown parse error → log + skip species. Run summary captures.
  - Teammate name doesn't resolve in roster → log to run summary's `unknown_species[]` (matches pokepaste's Option B). Recurring entries indicate a roster gap or a Pikalytics naming oddity.
  - Network 429/5xx → exp backoff, 3 retries, then log + skip.

### 2.8 Where it sits in the repo

```
src/
  schemas/
    pikalytics.ts                          (zod: PikalyticsSnapshot, TeammateEntry, FrequencyEntry)
  tools/
    pikalytics/
      SPEC.md                              (per CLAUDE.md §8)
      client.ts                            (HTTP: throttled, cached, 404-tolerant)
      fetch-species.ts                     (tool fn — public API)
      transform.ts                         (raw markdown → PikalyticsSnapshot;
                                            roster id resolution; tera-strip property test)
      parse-markdown.ts                    (small, well-tested markdown extractor)
  db/
    drizzle-schema.ts                      (extended with pikalytics_snapshots)
    migrations/
      00XX_pikalytics_snapshots.sql        (drizzle-kit generated)
    pikalytics.ts                          (bespoke repo: get, teammates, usage)
scripts/
  data/
    ingest-pikalytics.ts                   (cron entry point)
fixtures/
  pikalytics/
    2026-05-07__garchomp.md                (real, fetched live)
    2026-05-07__sneasler.md                (real)
    2026-05-07__kingambit.md               (real)
    2026-05-07__synthetic-empty-sections.md (one or two sections missing)
    2026-05-07__synthetic-tera-leak.md     (defensive — tera_* lines that must be stripped)
tests/
  schemas/
    pikalytics.test.ts                     (zod round-trip)
  tools/
    pikalytics/
      parse-markdown.test.ts               (the regex/parser)
      transform.test.ts                    (tera strip; teammate resolution; missing-section graceful)
      client.test.ts                       (URL building, throttle, cache, 404)
      fetch-species.test.ts                (tool fn integration)
      tool-definitions.test.ts             (snapshot — assert tools registered)
  db/
    pikalytics.test.ts                     (repo unit; teammates() ordering;
                                            usage(dimension="teammate") joins)
  scripts/
    ingest-pikalytics.test.ts              (cache-driven offline mode; idempotency)
  contract/
    pikalytics-live.test.ts                (weekly: hit a known stable species; assert
                                            the markdown contract holds; gated by env var)
```

### 2.9 Test strategy (Stage 4 will write red first)

- **Schema:** zod round-trip on the 3+ real fixtures + 2 synthetics.
- **Markdown parser:** isolated unit tests on the regex shapes (`- **<name>**: <pct>%`, the `as_of` line, section headers). Per CLAUDE.md §3 and the lessons of pokepaste's T17/T20 fixture-collision bugs, keep the parser pure-function and test it independently of the transform.
- **Tera enforcement:** explicit test that `transformPaste`-equivalent strips any tera-shaped lines AND a property test that no persisted row has any column or JSON key matching `/tera/i` (mirror the existing `tournaments-no-tera.test.ts` and `sets-no-tera.test.ts`).
- **Roster-id resolution:** every teammate name in committed fixtures resolves via `roster.get`. Add the `Charizard-Mega-Y` case explicitly.
- **Repo queries:** `teammates(species="garchomp", limit=4)` returns the four expected entries in descending percent order; `usage(dimension="teammate", species="sneasler")` joins through `json_each(teammates_json)` and ranks.
- **Skip-existing:** running the ingest twice on the same upstream `as_of` produces zero row deltas.
- **Contract test (weekly, gated by `RUN_CONTRACT_TESTS=1`):** hits a known stable species; asserts the markdown shape still has the expected sections; flags drift loudly.

### 2.10 Out of scope for this slice

- **Spreads parsing** (the EV/SPS distributions) — section format varies; deferred to a follow-up. Items/abilities/moves cover most analytic value.
- **Counters / "checks" section** if Pikalytics adds it — defer.
- **Other formats** (Reg M-B, future regulations, OU, etc.) — format slug is hard-coded for v1. Generalization is a follow-up flow doc.
- **Munchstats** — separate flow doc when needed.
- **Live UI** — agent-callable only in v1; no team-builder dropdown for "show me Pikalytics teammates."
- **Backfill of historical `as_of` dates** — Pikalytics only exposes the current snapshot; there's no `?as_of=2026-04-01` query parameter. We capture forward in time only.

---

## 3. Data in / out

| Step | Input | Output |
|------|-------|--------|
| `pikalytics.fetchSpecies({species_roster_id})` | roster id | `PikalyticsSnapshot` (validated) |
| ingest pipeline | format | upserted `pikalytics_snapshots` rows (one per species per `as_of`) |
| `pikalytics.get({species_roster_id})` | roster id | latest snapshot or `null` |
| `pikalytics.teammates({species_roster_id, limit})` | roster id + N | top-N teammates by % |
| `pikalytics.usage({dimension, species, limit})` | dimension + species | ranked rows with % |

---

## 4. Error / empty states

- **404 on AI endpoint** → species not covered on Pikalytics for this format; log to run summary, continue.
- **Markdown malformed (no `as_of` line, missing all sections)** → `PikalyticsParseError`; log to run summary, no row written.
- **Empty `Common Teammates` section** → snapshot still written with `teammates: []`; downstream queries return empty arrays.
- **Teammate name doesn't resolve in roster** → log entry per `unknown_species[]` in the run summary, mirroring pokepaste's Option B. Don't drop the snapshot — partial teammate resolution is acceptable; the unresolved entries are logged for operator review.
- **Tera-shaped line slips through** → schema-layer rejection; contract test catches it.
- **Network 429/5xx** → exp backoff, 3 retries, then log; species rolls forward to the next ingest run.
- **Pikalytics's `as_of` regresses (date moves backwards)** → log a warning; still ingest, but flag for operator review (likely an upstream republish; we don't want to silently hide it).

---

## 5. Success criteria (this slice)

- [ ] `PikalyticsSnapshot`, `TeammateEntry`, `FrequencyEntry` zod schemas; round-trip tests pass on ≥5 fixtures.
- [ ] `pikalytics.fetchSpecies` tool wired; cited, throttled, fixture-tested, JSON-Schema-described per CLAUDE.md §8.
- [ ] `pikalytics_snapshots` Drizzle migration applied; unique constraint on `(species, as_of)`.
- [ ] `pikalytics.{get, teammates, usage}` repo green; in-memory SQLite unit tests pass.
- [ ] **Tera property test** asserts no persisted record has any tera-shaped field.
- [ ] Skip-existing: rerunning the ingest produces zero `pikalytics_snapshots` deltas.
- [ ] Cold-start ingest of all 286 Reg-M-A species completes in under 10 min on a laptop; weekly refresh under 60 s when nothing changed.
- [ ] Agent tool definitions added to `ROSTER_TOOL_DEFINITIONS`. Suggested tools: `pikalyticsFetchSpeciesTool`, `pikalyticsTeammatesTool`, `pikalyticsUsageTool`. The blocker that bit pokepaste-sets at Stage 6 is preempted here.
- [ ] Live contract test in place; gated behind `RUN_CONTRACT_TESTS=1`.
- [ ] Demo: ad-hoc operator script (`scripts/pikalytics-demo.ts` or extension to `scripts/labmaus-latest.ts`) shows "Sneasler's top 5 teammates per Pikalytics + per labmaus tournament data" side-by-side.

---

## 6. Open questions for Stage 2 review

1. **Roster scope at ingest.** Cold start over all 286 Reg-M-A species takes ~5 min at 1 RPS. Pikalytics 404s a species below some usage threshold (likely <0.1% — never seen in ranked play). **Proposal:** iterate all 286, count 404s as "not in coverage," persist nothing for them. The run summary surfaces the 404 count so we know the meta's effective coverage. Reviewer confirms.
Answer: iterate all 286, count 404s as "not in coverage," persist nothing for them. The run summary surfaces the 404 count so we know the meta's effective coverage.

2. **`as_of` is upstream-controlled, but no explicit publication-cadence contract.** Pikalytics says "monthly or as new tournament data arrives" — could be a week between updates, could be six. **Proposal:** weekly cron is fine; skip-existing makes redundant runs free. If the upstream cadence turns out to be monthly, we just see no new rows for several weeks — not a bug. Reviewer confirms.
Answer: weekly cron is fine; skip-existing makes redundant runs free. If the upstream cadence turns out to be monthly, we just see no new rows for several weeks — not a bug.

3. **Tool surface granularity.** `pikalyticsTeammatesTool(species)` is the load-bearing one for the user's stated need. Should we also expose `pikalyticsItemsTool` / `pikalyticsAbilitiesTool` / `pikalyticsMovesTool` separately, or fold all under one `pikalyticsUsageTool(dimension)` like labmaus's `tournaments.usage` did? **Proposal:** one umbrella `pikalyticsUsageTool` with a `dimension` discriminator + a dedicated `pikalyticsTeammatesTool` (matches the user's primary use case as a first-class tool). Two tools total, mirroring labmaus's `tournaments.usage` + `tournaments.teams_with`.
Answer: one umbrella `pikalyticsUsageTool` with a `dimension` discriminator + a dedicated `pikalyticsTeammatesTool` (matches the user's primary use case as a first-class tool). Two tools total, mirroring labmaus's `tournaments.usage` + `tournaments.teams_with`.

4. **Cross-source merge in `usage()`.** We now have three usage sources: labmaus's recomputed-from-raw aggregates, pokepaste's per-team data, Pikalytics's ladder data. Should `pikalytics.usage()` merge with the others, or stay strictly Pikalytics? **Proposal:** stay strictly Pikalytics in this slice; cross-source merging belongs in a `meta-merger` slice that owns reconciliation policy (e.g., "Pikalytics weighted 0.6, labmaus weighted 0.4 because real tournaments are higher signal"). That's a real product decision and shouldn't be silently embedded in one source's repo.
Answer: stay strictly Pikalytics in this slice.

5. **Markdown parser robustness.** The recon showed clean Markdown today, but a single section-header rename upstream breaks parsing. **Proposal:** the parser is permissive (missing sections produce empty arrays, not errors) but strict on section presence — `as_of` and `usage_percent` are required; everything else is optional. Contract test surfaces drift.
Answer: the parser is permissive (missing sections produce empty arrays, not errors) but strict on section presence — `as_of` and `usage_percent` are required; everything else is optional. Contract test surfaces drift.

6. **`source_url` vs `ai_url`.** Pikalytics's HTML page is the canonical user-facing URL (`/pokedex/...`); the AI Markdown endpoint (`/ai/pokedex/...`) is what we fetch. The HTML URL is what citations should link to (humans visit it). **Proposal:** persist both; `source_url` (human) is the citation surface, `ai_url` (machine) is for refresh ergonomics. Reviewer confirms.
Answer: persist both; `source_url` (human) is the citation surface, `ai_url` (machine) is for refresh ergonomics.

7. **Teammate name → roster id resolution policy.** Pikalytics names are display-style (`Charizard-Mega-Y`). `roster.get(name, "RegM-A")` already handles case-insensitive display-name lookup. **Proposal:** rely on the existing roster lookup; no new alias mapping needed. If a teammate doesn't resolve, log to `unknown_species[]` (Option B style) and persist `teammates_json` excluding the unresolved entry.
Answer: rely on the existing roster lookup; no new alias mapping needed. If a teammate doesn't resolve, log to `unknown_species[]` (Option B style) and persist `teammates_json` excluding the unresolved entry.

8. **Failure-summary granularity.** Run summary fields parallel pokepaste's: `species_404s[]`, `parse_failures[]`, `unknown_teammate_names[]`, `network_failures[]`, `total_snapshots: N`, `skipped_existing: M`. Reviewer confirms or trims.
Answer: Run summary fields parallel pokepaste's: `species_404s[]`, `parse_failures[]`, `unknown_teammate_names[]`, `network_failures[]`, `total_snapshots: N`, `skipped_existing: M`.

9. **`scripts/pikalytics-demo.ts`** as a small operator script (mirroring `scripts/labmaus-latest.ts`) — useful as ongoing tool, or skip and let the agent tools demonstrate via the agent loop? **Proposal:** ship it. Operator-CLI scripts have proven valuable on labmaus; they accelerate sanity checks.
Answer: ship it. Operator-CLI scripts have proven valuable on labmaus; they accelerate sanity checks.

10. **Stage 4 test ordering.** Schema → markdown parser → transform (tera strip + roster resolution + completeness) → client (mocked HTTP, 404, throttle, cache) → fetch-species (tool integration) → repo (in-memory SQLite) → ingest end-to-end on fixtures → idempotency → contract (live, gated). Mirrors labmaus + pokepaste. OK?
Answer: yes, that ordering makes sense.

---

## 7. Reviewed-by

_Rodrigo Caballero_
