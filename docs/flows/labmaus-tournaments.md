# Flow — Labmaus Tournament Ingest

**Slug:** `labmaus-tournaments`
**Stage:** Stage 2 approved (2026-05-04). Tech plan (Stage 3) pending.
**Approved-by:** Rodrigo Caballero (2026-05-04)
**Author:** Claude (main agent)
**Date:** 2026-05-04

Labmaus.net aggregates competitive Pokemon tournament results, including unofficial Champions Reg M-A events sourced from Limitless and other organizers. We need labmaus as **one of several** ingestion sources for the `TournamentResult` entity (Victory Road is the other planned source); together they feed the meta-intelligence layer that the team builder, lead planner, and weakness-audit features consume.

> **Critical Reg M-A hygiene:** the labmaus tournament payload includes a `tera_types` aggregate (e.g. `[{name:"Bug", percentage:97.62}, …]`) regardless of format — almost certainly a default emitted by the upstream pipeline. Per memory `regulation_m_a_no_tera.md` and CLAUDE.md §1, **we drop this field unconditionally for Reg M-A** and a contract test asserts it never propagates downstream.

> **Scope boundary:** this flow ingests labmaus only — **tournament metadata + per-placement species composition + per-tournament aggregates we recompute from raw teams**. Full set details (item, ability, nature, SPS, moves, EVs) are NOT in the labmaus payload; each team carries a `team_url` pointing to **pokepast.es**, which is a separate ingestion source covered by its own flow doc (`pokepaste-sets`, not yet authored). This flow stops at the `team_url` boundary; it stores the URL but does not fetch it.

> **Reuse note:** the per-tournament `pokemon` / `items` / `moves` / `compositions` aggregates that labmaus pre-computes overlap with Pikalytics / Munchstats. To avoid double-counting when the same tournament appears across sources, this flow **stores raw team rows as the source of truth and recomputes aggregates downstream from raw**, treating labmaus's aggregates as a contract-validation cross-check (we assert ours match theirs ± rounding).

---

## 1. User flow

The labmaus ingest is **agent- and tool-facing**. End users experience it through three product surfaces.

### 1.1 Surface A — Meta intelligence in the team builder (primary)
1. Player opens the Team Lab and asks "what's hot in Reg M-A right now?"
2. The agent calls `tournaments.usage(format="RegM-A", lookback_days=30)` → returns top species, items, moves, and 2/3/4-mon cores ranked by tournament-weighted appearances.
3. Each row is cited: "Kingambit appeared on 22 of 42 teams (52.4%) across 1 Masters event in the last 30 days; placed 1st" — with click-throughs to the source tournament + the player teams.
4. Without this data, the agent's meta claims are ungrounded; player loses trust.

### 1.2 Surface B — Lead planner evidence (`LeadPlan.citations`)
1. When the lead planner builds a `LeadPlan` (CLAUDE.md §6), it must cite supporting evidence.
2. It queries `tournaments.teams_with(species=["Sneasler","Kingambit"], format="RegM-A")` → returns recent placing teams that share that core, with their full 6-species composition.
3. The planner uses these as analogous lines: "Of 18 Sneasler+Kingambit teams in the last 30 days, 11 backed with Floette/Basculegion-M; primary lead in 4 of 4 top-cut runs was Aerodactyl + Sneasler."
4. Without this data, lead recommendations have no tournament grounding — they're speculation.

### 1.3 Surface C — Insight extraction inputs (downstream)
1. Each `Team` row produced here is later joined to its pokepaste set (separate flow), then fed to the YouTube/article Insight extractor as factual context: "this build placed top 4 in <event> on <date>."
2. This grounds free-text insights in tournament reality — extracted claims about a set get an automatic `TournamentResult` cross-reference.

### Acceptance (user-perceived)
- Meta queries return the same top-N species ordering as labmaus's own per-tournament leaderboard (validated weekly via contract test).
- Every team shown carries `tournament_name`, `placement`, `record`, `country`, and a clickable `team_url` (pokepaste).
- Tera-related fields never appear in any Reg M-A response (validated by contract test).
- Cold-start ingest (full Reg M-A backfill from format launch through today) finishes in under 10 minutes on a laptop; weekly incremental refresh in under 60 seconds.

---

## 2. Tech flow

### 2.1 Module surface (final shape lands in tech plan)

```ts
// Tool layer — agent-callable, cited, throttled, fixture-tested per CLAUDE.md §8
labmaus.listTournaments(args: {
  regulation: "RegM-A",
  date_range: { from: ISODate, to: ISODate },
  status?: "official" | "unofficial",
  division?: "Masters" | "Seniors" | "Juniors",
}): Promise<TournamentSummary[]>

labmaus.getTournament(args: {
  id: number,
}): Promise<TournamentDetail>     // includes overview + teams[] + raw aggregates

// Repository layer — over our SQLite store, populated by the ingest worker
tournaments.list(filter: TournamentFilter): TournamentResult[]
tournaments.get(id: TournamentId): TournamentResult | null
tournaments.teams_with(args: {
  species: string[],         // canonical roster ids (intersection match)
  format: "RegM-A",
  lookback_days?: number,
  min_placement?: number,
}): TournamentTeam[]
tournaments.usage(args: {
  format: "RegM-A",
  lookback_days: number,
  weight_by?: "appearances" | "wins" | "tournament_weight",  // default appearances
}): UsageRow[]                  // per-species + per-item + per-move + per-core
```

The tool layer is a thin wrapper around the labmaus HTTP API. The repository layer reads our local SQLite mirror, populated by a scheduled ingest worker.

### 2.2 Discovered API surface

Two endpoints, both unauthenticated, no rate-limit headers observed:

```
GET https://labmaus.net/api/completed_tournaments
    ?regulation=Regulation+Set+M-A
    &date_range=YYYY-MM-DD+to+YYYY-MM-DD

GET https://labmaus.net/api/tournament
    ?tournament=<id>
    &language=en
```

`completed_tournaments` returns a flat array of `TournamentSummary`:
```jsonc
{
  "id": 56757,
  "date": "2026-05-04",
  "name": "Sketch Academy Champions Regulation M-A Tournament",
  "regulation": "Regulation Set M-A",
  "division": "Masters",
  "num_players": 42,
  "status": "unofficial"          // also seen: presumed "official"
}
```

`tournament` returns `{ overview, teams[], pokemon[], items[], moves[], compositions[], tera_types[] }`. The fields we keep:
- **`overview`** — tournament metadata (id, date, name, organizer, source, regulation, division, num_players, status, tournament_code).
- **`teams`** — one row per registered player. Carries `player`, `placement` (nullable for swiss-out), `record` (e.g. `"5-3-0"`), `country` (ISO-3166-α2, nullable), `team` (6 dex-id strings like `"038-a"`), `team_names` (parallel display names), `team_url` (pokepaste).

The fields we **drop or recompute**:
- **`pokemon`, `items`, `moves`, `compositions`** — kept only for contract-validation; never queried by downstream code. Aggregates are recomputed from `teams` so multi-source merges are clean.
- **`tera_types`** — dropped unconditionally for Reg M-A (see header note).

### 2.3 The `TournamentResult` and `TournamentTeam` records (sketch — final lands in tech plan)

```jsonc
// TournamentResult
{
  "schema_version": 1,
  "id": "labmaus:56757",                  // namespaced — Victory Road will use "vr:..."
  "external_id": 56757,
  "tournament_code": "69eef9409d90c111990b8fa0",  // for cross-source dedup
  "name": "Sketch Academy Champions Regulation M-A Tournament",
  "organizer": "Sketch Academy",
  "format": "RegM-A",
  "division": "Masters",
  "status": "unofficial",
  "date": "2026-05-04",                   // YYYY-MM-DD
  "num_players": 42,
  "num_phase_2": null,
  "source": {
    "site": "labmaus",
    "site_source": "limitless",           // labmaus aggregates from Limitless et al.
    "source_url": "https://labmaus.net/tournaments/56757",
    "fetched_at": "2026-05-04T19:32:11Z"
  }
}

// TournamentTeam — one row per (tournament, player)
{
  "schema_version": 1,
  "id": "labmaus:56757:244471",
  "tournament_id": "labmaus:56757",
  "external_team_id": 244471,
  "player": "MothervieveRobbedonS50",
  "country": "CZ",                        // nullable
  "placement": 1,                         // nullable for swiss drops
  "record": "8-1-0",
  "team_url": "https://pokepast.es/7205bf28f85d1e79",
  "species": [                            // 6 entries, in labmaus order
    { "labmaus_id": "006",   "roster_id": "charizard"  },
    { "labmaus_id": "036",   "roster_id": "clefable"   },
    { "labmaus_id": "142",   "roster_id": "aerodactyl" },
    { "labmaus_id": "445",   "roster_id": "garchomp"   },
    { "labmaus_id": "903",   "roster_id": "sneasler"   },
    { "labmaus_id": "983",   "roster_id": "kingambit"  }
  ],
  "fetched_at": "2026-05-04T19:32:11Z"
}
```

Provenance fields keep CLAUDE.md §5 satisfied. `tournament_code` enables dedup when the same event appears in both labmaus and Victory Road.

### 2.4 The id-mapping problem (load-bearing)

Labmaus identifies species by **national dex number with form suffix**:
- Plain: `"006"` → Charizard
- Regional form: `"038-a"` → Ninetales-Alola, `"571-h"` → Zoroark-Hisui, `"157-h"` → Typhlosion-Hisui
- Forme variant: `"479-w"` → Rotom-Wash, `"479-h"` → Rotom-Heat, `"479-f"` → Rotom-Frost
- Tauros breeds: `"128-a"` → Tauros-Paldea-Aqua, `"128-b"` → Tauros-Paldea-Blaze
- Female symbol literal: `"Basculegion ♂"` → roster id `basculegionm`

Our roster (per `pokemon-roster-db`) uses **Showdown-style canonical ids** (`ninetales-alola`, `rotom-wash`, etc.). The mapping layer lives in `src/tools/labmaus/species-map.ts` — a deterministic function `labmausIdToRosterId(labmausId, displayName) → rosterId | null`, with a committed lookup table built from the labmaus payload and cross-checked against `roster.list()`. **Build-time invariant: every labmaus id encountered in any committed fixture maps to a known roster id, or the build fails loudly.** This protects against silent meta drift when labmaus adds a form suffix we've never seen.

### 2.5 Storage — extends the existing SQLite (Drizzle) DB

Per memory `data_layer_two_tier_db.md` and `db_orm_drizzle.md`, we extend `src/db/drizzle-schema.ts` with new relational tables; no new DB file.

```
tournaments         (id, external_id, tournament_code, name, organizer, format,
                     division, status, date, num_players, num_phase_2,
                     source_site, source_site_source, source_url, fetched_at)
tournament_teams    (id, tournament_id FK, external_team_id, player, country,
                     placement, record, team_url, fetched_at)
tournament_team_species (team_id FK, slot 0..5, labmaus_id)
```

> **Note (post-§18.5 simplification, 2026-05-05):** `tournament_team_species`
> carries only labmaus dex ids per slot. Canonical roster attribution is
> owned by the parallel `pokepaste-sets` slice via
> `team_sets.species_roster_id` (see `docs/plans/pokepaste-sets.md`); the
> labmaus-side `species_alias_labmaus` ref table from the original plan was
> dropped because the pokepaste parser already produces canonical Showdown
> species names that match our roster ids directly. The labmaus dex id and
> the `team_names` CSV remain as a fallback for teams whose paste 404s.

Indexes:
- `tournaments(format, date)` — usage-window queries.
- `tournament_teams(tournament_id, placement)` — top-cut queries.
- "Who used Sneasler?" queries (`teams_with`) read from `team_sets.species_roster_id` (pokepaste-sets); see plan §6.1 for the indexes used there.
- Unique on `(tournaments.source_site, tournaments.external_id)` — idempotent upsert.

### 2.6 Ingest pipeline

```
                       ┌──────────────────────────────┐
                       │  scripts/data/ingest-labmaus │
                       │  (cron weekly, manual once)  │
                       └────────────┬─────────────────┘
                                    │
                ┌───────────────────┴──────────────────┐
                ▼                                      ▼
   labmaus.listTournaments(window)        per-id labmaus.getTournament
   throttled (1 req/s, 3 retries,         (parallel ≤ 4, same throttle)
   exp backoff, 24h disk cache)                        │
                ▼                                      ▼
         delta vs DB ────► upsert tournaments + teams + species rows
                                                       │
                                                       ▼
                                        recompute usage aggregates
                                        + cross-check vs labmaus's
                                        own pokemon[]/items[]/moves[]
                                        (assert match ± rounding)
```

- **Window strategy.** Cold start: walk Reg M-A from format launch (estimated 2026-04-06) through today in 30-day chunks, oldest → newest. Weekly: refresh `[today − 14d, today]` — 14-day overlap absorbs late-finalized brackets.
- **Idempotency.** Every write is an upsert keyed on `(source_site, external_id)`. Re-running the ingest produces zero diffs.
- **Throttle.** 1 req/s baseline, exp-backoff to 60s on 429/5xx. Rationale: no published rate limit; courteous default.
- **Disk cache.** Raw responses cached under `data/cache/labmaus/<date>/<endpoint>-<args>.json`. Cache is read-through — re-ingests in dev hit disk, not the network.
- **Tera_types drop.** Enforced at the schema layer (zod `.transform` strips it); a unit test asserts no row in `tournaments` or `tournament_teams` carries a tera field.
- **Status filter.** v1 ingests *both* `official` and `unofficial`; downstream queries can filter via `weight_by`. Rationale: Champions is new and most events are still unofficial; excluding them drops nearly all data.

### 2.7 Where it sits in the repo

```
data/
  cache/
    labmaus/                                (raw response cache; gitignored)
src/
  schemas/
    tournament.ts                           (zod: TournamentSummary, TournamentDetail,
                                             TournamentResult, TournamentTeam)
  tools/
    labmaus/
      SPEC.md                               (per CLAUDE.md §8 — tool spec first)
      client.ts                             (HTTP client: throttled, cached, retried)
      list-tournaments.ts                   (tool fn — public API)
      get-tournament.ts                     (tool fn — public API)
      species-map.ts                        (labmaus dex-id → roster id)
      transform.ts                          (raw payload → TournamentResult/Team)
  db/
    drizzle-schema.ts                       (extended with new tables)
    migrations/                             (drizzle-kit generated)
    tournaments.ts                          (repo: list/get/teams_with/usage)
    species-alias-labmaus.ts                (createSimpleRepo)
scripts/
  data/
    ingest-labmaus.ts                       (cron entry point)
fixtures/
  labmaus/
    2026-05-04__completed_tournaments_regm-a_30d.json
    2026-05-04__tournament_56757.json
    2026-05-04__tournament_56756.json       (2-3 more for variety: large/small,
                                             with/without country, swiss-only, etc.)
tests/
  tools/
    labmaus/
      schema.test.ts                        (zod round-trip on fixtures)
      species-map.test.ts                   (every fixture id resolves)
      transform.test.ts                     (raw payload → domain happy path,
                                             tera_types stripped, nullable
                                             placement preserved)
      client.test.ts                        (URL building, throttle, cache, retry)
  db/
    tournaments.test.ts                     (repo unit — in-memory sqlite, fixture
                                             rows; teams_with intersection,
                                             usage aggregation)
    aggregate-cross-check.test.ts           (our recomputed pokemon/items/moves
                                             match labmaus's ± rounding)
  contract/
    labmaus-live.test.ts                    (weekly: fetch a known tournament id;
                                             assert the API still returns the
                                             expected schema; flag schema drift)
```

### 2.8 Test strategy (Stage 4 will write red first)

- **Schema:** zod round-trip on the four fixture tournament payloads (variety: large vs small, with/without `country`, with/without `placement`, with/without `num_phase_2`).
- **Tera enforcement:** explicit test that `tera_types` is removed by `transform`; a property test that no `TournamentResult` ever carries any field with `"tera"` in its name (case-insensitive).
- **Species mapping:** every labmaus id appearing in any committed fixture resolves to a non-null roster id; unknown ids throw with the offending id in the message.
- **Repo queries:** `teams_with(["Sneasler","Kingambit"], lookback_days=30)` returns all and only the teams that contain both; `usage` produces the top species in the same order as labmaus's `pokemon[]` field for the same tournament (single-source case — multi-source merge tested separately later).
- **Throttle / retry / cache:** mocked-fetch tests on the client.
- **Idempotent ingest:** running the ingest twice on the same window produces zero row deltas (database fixture comparison).
- **Contract test (weekly, skipped in CI by default):** hits a known stable tournament id; fails loudly if the response schema diverges from our zod shape.

### 2.9 Out of scope for this slice

- **Pokepaste set ingestion** — separate flow (`pokepaste-sets`). This flow stores `team_url` and stops.
- **Victory Road ingest** — separate flow; the `source_site` namespacing in ids is in place to support it.
- **Cross-source dedup** — `tournament_code` is captured but the dedup pass lives in a later "meta merger" flow.
- **Live updates** — weekly cron is the contract; no webhook, no push.
- **Player-level history** (e.g. "all teams Wolfe Glick has played") — possible from this data shape, but no UI consumer yet.
- **Junior / Senior divisions** — schema supports them, but the v1 ingest filters to Masters only (matches user's competitive scope). Trivial to drop the filter when needed.

---

## 3. Data in / out

| Step | Input | Output |
|------|-------|--------|
| `labmaus.listTournaments(window)` | format + date range | `TournamentSummary[]` |
| `labmaus.getTournament(id)` | external id | `TournamentDetail` (raw) |
| ingest pipeline | window | upserted `tournaments`, `tournament_teams`, `tournament_team_species` rows |
| `tournaments.list(filter)` | format + window + division + status | `TournamentResult[]` |
| `tournaments.teams_with({species, lookback})` | canonical roster ids | `TournamentTeam[]` containing all listed species |
| `tournaments.usage({format, lookback, weight_by})` | window + weighting | `UsageRow[]` (per species/item/move/core) |

---

## 4. Error / empty states

- **Unknown labmaus species id** → ingest fails loud with the offending id; no partial team is written. (Protects against silent meta drift.)
- **Tournament with `placement: null` for all rows** → swiss-only event, persisted as-is; `min_placement` filters exclude it.
- **`num_phase_2: null`** → single-phase event; persisted as null, no inference.
- **labmaus 429 / 5xx** → exp backoff, 3 retries, then surface the error. Partial-window ingest is committed; the next run re-fetches missing ids.
- **Aggregate cross-check mismatch** → log a warning with the diff but do not fail the ingest (labmaus may round differently). A contract test asserts the diff is bounded.
- **Empty window** → no tournaments in range; ingest is a no-op, exit 0.
- **Tera-typed payload sneaks through** → schema-layer rejection; contract test catches it before merge.

---

## 5. Success criteria (this slice)

- [ ] `TournamentSummary`, `TournamentDetail`, `TournamentResult`, `TournamentTeam` zod schemas landed; round-trip tests pass on ≥4 captured fixtures.
- [ ] `labmaus.listTournaments` and `labmaus.getTournament` tools wired; cited, throttled, fixture-tested, JSON-Schema-described per CLAUDE.md §8.
- [ ] `species-map` covers every species id in committed fixtures; build fails on unknown ids.
- [ ] `tournaments` / `tournament_teams` / `tournament_team_species` / `species_alias_labmaus` Drizzle migrations applied.
- [ ] `tournaments.{list,get,teams_with,usage}` repo green; in-memory SQLite unit tests pass.
- [ ] `tera_types` never appears in any persisted row; explicit test enforces.
- [ ] Cold-start ingest of full Reg M-A history completes in under 10 min on a laptop; weekly refresh under 60 s.
- [ ] Idempotent ingest: two consecutive runs produce zero row deltas.
- [ ] Aggregate cross-check: our recomputed top-N species matches labmaus's `pokemon[]` ordering for ≥3 fixture tournaments.
- [ ] Weekly contract test in place; schema-drift failures route to the user.

---

## 6. Open questions for Stage 2 review

1. **Pokepaste split.** Should `pokepaste-sets` be authored as a sibling flow doc *now* (since labmaus team rows are useless without sets) or deferred until first set-consuming feature? **Proposal: defer; ship labmaus first, sets next, both before the lead planner needs them.** A team row with only `team_url` is still useful for the meta-intelligence surface.
Answer: Defer pokepaste-sets — ship labmaus first. For now persist `team_url` on each `TournamentTeam` row and stop there; pokepaste ingestion gets its own flow when a downstream feature actually needs set-level data.

2. **Status weighting.** v1 stores both `official` and `unofficial`; queries can filter. Should `usage()` weight unofficial events lower by default (e.g. 0.5×) to match competitive intuition, or treat them equally and let the agent reason about it? **Proposal: equal weight in v1; revisit if recommendations skew toward unofficial-only metas.**
Answer: Let's weight them equally for now. We can always adjust the weighting later if we find that unofficial events are skewing the meta in undesirable ways.

3. **Division scope.** v1 ingests Masters only. Worth ingesting Seniors/Juniors too as low-cost optionality, or wait for a use case? **Proposal: Masters-only filter at the ingest layer; trivially removable.**
Answer: Let's start with Masters-only to keep the scope focused. We can easily expand to include Seniors and Juniors later if there's demand for that data.

4. **Backfill start date.** Champions Reg M-A launched roughly 2026-04-06 per the user's example URL. Confirm exact format-launch date so the cold-start loop has a hard lower bound.
Answer: Champions launched on 2026-04-06, so we can use that as the start date for our backfill.

5. **`tournament_code` cross-source semantics.** Confirm Victory Road exposes a stable identifier we can map to labmaus's `tournament_code`. If not, dedup falls back to `(date, organizer, num_players)` fuzzy match. **Open until VR flow is authored.**
Answer: Doesn't seem that Victory Road exposes a stable identifier that maps to labmaus's `tournament_code`. We'll need to rely on a fuzzy match based on `(date, organizer, num_players)` for deduplication when we get to the Victory Road flow.

6. **Aggregate cross-check tolerance.** What's an acceptable rounding delta between our recomputed `usage_percent` and labmaus's? **Proposal: ±0.05 absolute or ±1% relative, whichever is looser.**
Answer: Let's go with ±0.05 absolute or ±1% relative, whichever is looser. This should account for minor rounding differences without flagging false positives.

7. **Ingest frequency vs cache TTL.** PRD §7 likely already pins per-source TTLs. Weekly cron + 24h disk cache means a manual re-run within the same week is essentially free. OK?
Answer: Yes, that sounds good. A weekly cron with a 24-hour disk cache should provide a good balance between freshness and efficiency, allowing for manual re-runs without hitting the network unnecessarily.

8. **Tera_types: drop or quarantine.** The field is meaningless for Reg M-A but might become meaningful if labmaus ever adds non-M-A formats. **Proposal: drop unconditionally for `regulation == "Regulation Set M-A"`; if we ever ingest non-M-A formats, lift the conditional.**
Answer: Let's drop the `tera_types` field unconditionally for Reg M-A. If we later decide to ingest non-M-A formats where this field is relevant, we can adjust our transformation logic to include it as needed.

9. **Ingest worker shape.** Plain TS script run by external cron (system / GitHub Actions / Vercel cron), or in-process scheduler? **Proposal: plain TS script + external cron; matches `pokemon-roster-db`'s `pnpm data:build:reg-m-a` pattern.**
Answer: Let's go with a plain TypeScript script that can be run by an external cron job. This approach is straightforward and aligns well with our existing patterns for data ingestion.

10. **Player name normalization.** Labmaus `player` is freeform (`"KST VGC "` has trailing space, `"21kieran"` lowercase). Trim + preserve case as-is, or canonicalize to lowercase for joins? **Proposal: store as-received plus a generated `player_key = trim(lower(player))` for joins; no cross-event identity inference (different events may use different handles for the same human).**
Answer: Let's store the player name as received and also generate a `player_key` that is a trimmed, lowercase version of the name for joining purposes. This way we preserve the original formatting while still allowing for consistent joins across records.

11. **Stage 4 test ordering.** Schema → species-map → transform → client (mocked HTTP) → repo (in-memory sqlite) → ingest end-to-end on fixtures → idempotency → aggregate cross-check → contract (live, gated). OK?
Answer: That test ordering looks solid. It starts with the most fundamental building blocks (schema, mapping) and progresses through the layers of logic, ending with the contract test that ensures our assumptions hold against the live API.

---

## 7. Reviewed-by

_Rodrigo Caballero_
