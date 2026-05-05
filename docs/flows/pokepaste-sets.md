# Flow — Pokepaste Set Ingest

**Slug:** `pokepaste-sets`
**Stage:** Stage 2 approved (2026-05-04). Tech plan (Stage 3) pending.
**Approved-by:** Rodrigo Caballero (2026-05-04)
**Author:** Claude (main agent)
**Date:** 2026-05-04
**Sibling slice:** `labmaus-tournaments` (`docs/flows/labmaus-tournaments.md`). Labmaus persists each team's `team_url` (a `pokepast.es/<hash>` link); this slice fetches and parses those URLs into structured per-Pokemon set rows.

Labmaus team rows are species-only. To answer questions like "what item is the top-finishing Sneasler running?" or "what are the standard moves on the placing Garchomp?" we need the full Showdown export behind each `team_url`. Pokepast.es exposes a clean `/raw` endpoint per paste; we fetch + parse with the official `@pkmn/sets` library, normalize to our domain shape, and persist alongside the labmaus rows.

> **Critical Reg M-A hygiene:** pokepaste plaintext exports include a `Tera Type:` line for every Pokemon, often `Tera Type: None`. Per memory `regulation_m_a_no_tera.md` and CLAUDE.md §1 we strip this field unconditionally at the parser boundary. A contract test asserts no persisted set carries any `tera_*` field.

> **Realistic data baseline — almost no SPS.** Pokepaste sets uploaded by tournament players for labmaus typically **omit EV/IV/Nature lines entirely** (real sample: `Charizard @ Charizardite Y` → item, ability, level, tera type, 4 moves, nothing else). We treat *missing SPS as the norm, not the exception.* The schema makes `sps`, `ivs`, `nature` nullable; the lead planner does not assume their presence. A `completeness` tag (`"minimal" | "partial" | "full"`) lets downstream rank by data quality.

> **Scope:** ingest is **eager during the labmaus pipeline** — every labmaus team triggers a pokepaste fetch on the same run. Content-addressed URLs cache forever, so the worst case is a one-shot fetch per `(team_url)` for the lifetime of the project.

---

## 1. User flow

End users experience this slice through three product surfaces, all downstream of the labmaus meta layer.

### 1.1 Surface A — Item / move usage in the team builder (primary)
1. Player asks "what's Sneasler running in the meta right now?"
2. The agent calls `tournaments.usage(format="RegM-A", lookback_days=30)` with item/move dimensions enabled (impossible without this slice).
3. Result: "Sneasler (18 placements): 88% Focus Sash, 11% Black Glasses; moves: Dire Claw 100%, Close Combat 95%, Sucker Punch 78%, Protect 72%."
4. Each row cites the contributing teams and tournaments via the joined `tournament_teams` rows.

### 1.2 Surface B — Lead planner evidence completeness
1. The lead planner builds a `LeadPlan` and cites supporting placing teams.
2. It now sees `set` data per slot — item, ability, moves, and (when present) SPS/nature.
3. Citations are richer: "Of 4 top-cut Sneasler+Kingambit teams, 4/4 ran Focus Sash Sneasler with Dire Claw + Close Combat + Sucker Punch + Protect."
4. When SPS data is missing (usually), the planner falls back to its own EV recommendations — but the cited *moveset and item* still come from real placing teams.

### 1.3 Surface C — Insight extraction grounding
1. YouTube/article Insights about a set get an automatic cross-reference: "this build placed top 4 in <event>, here's the actual export."
2. Without this slice, Insights about specific builds have no canonical paste to point at.

### Acceptance (user-perceived)
- For every team row in `tournament_teams`, `team_sets[]` contains 6 entries (one per slot) — even if a row is `{species, item, ability, moves}` with `sps: null`.
- "What item is the top X running?" returns a ranked list cited by tournament + paste URL.
- No set ever carries a `tera_*` field (validated by contract test).
- Re-ingesting the same paste hash produces zero row deltas.
- Cold-start: parsing all teams from the labmaus backfill (~hundreds of pastes) finishes in under 5 minutes on a laptop.

---

## 2. Tech flow

### 2.1 Module surface (final shape lands in tech plan)

```ts
// Tool layer — agent-callable per CLAUDE.md §8
pokepaste.fetchPaste(args: {
  paste_id: string,             // the hash from the URL, e.g. "7205bf28f85d1e79"
}): Promise<PasteFetchResult>   // raw text + parsed sets + completeness tag

// Repository layer — over our SQLite store
sets.list(filter: { tournament_id?, team_id?, species?: string }): TeamSet[]
sets.get(team_id: TournamentTeamId, slot: 0..5): TeamSet | null
sets.usage(args: {
  species: string,
  format: "RegM-A",
  lookback_days: number,
  dimension: "item" | "ability" | "move" | "nature",
}): UsageRow[]
```

The pokepaste tool is thin: fetch `/raw`, hand to `@pkmn/sets`, transform to our domain shape, return. Persistence happens inside the labmaus ingest script, which calls the tool per team.

### 2.2 Discovered access surface

```
GET https://pokepast.es/<paste-id>/raw
  → 200 text/plain, Showdown export format, CORS open (`*`), no auth, no rate limit
  → 404 if the paste id is unknown
```

Headers worth noting:
- `Access-Control-Allow-Origin: *` — browser-safe.
- `Strict-Transport-Security: max-age=31536000` — HTTPS-only.
- No `Cache-Control` or `Last-Modified` — but URLs are content-hash addressable, so we cache indefinitely on our side.
- No rate-limit headers; courteous default applies (1 req/s, exp backoff).

### 2.3 Realistic Showdown-export sample (verbatim from a 1st-place Reg M-A team)

```
Charizard @ Charizardite Y
Ability: Blaze
Level: 50
Tera Type: None
- Heat Wave
- Weather Ball
- Solar Beam
- Protect

Clefable @ Sitrus Berry
Ability: Unaware
Level: 50
Tera Type: None
- Moonblast
- Icy Wind
- Follow Me
- Protect
```

What's *missing* and why it matters:
- **No `EVs:` line** → `sps: null` in our domain. This is the common case for labmaus pastes.
- **No `IVs:` line** → `ivs: null`. Per Reg M-A rules and `regulation_m_a_stat_rules.md`, the calc layer fills 31s anyway.
- **No `<Nature> Nature` line** → `nature: null`.
- **`Tera Type: None` is present** → stripped at parse boundary, never persisted.

### 2.4 Domain shapes (sketch — final lands in tech plan)

```jsonc
// TeamSet — one row per (TournamentTeam, slot)
{
  "schema_version": 1,
  "id": "labmaus:56757:244471:0",      // tournament_team_id + slot
  "tournament_team_id": "labmaus:56757:244471",
  "slot": 0,                           // 0..5, matches labmaus species order
  "species_roster_id": "charizard",    // FK to species table
  "item": "Charizardite Y",            // nullable; opaque string validated against items ref table
  "ability": "Blaze",                  // nullable; opaque string validated against abilities ref table
  "level": 50,                         // defaults to 50 in Reg M-A; nullable to preserve absence
  "moves": ["Heat Wave", "Weather Ball", "Solar Beam", "Protect"],  // 0..4, validated against moves ref table
  "sps":    null,                      // { hp, atk, def, spa, spd, spe } or null
  "ivs":    null,                      // { hp, atk, def, spa, spd, spe } or null (calc fills 31s)
  "nature": null,                      // string or null
  "completeness": "minimal",           // "minimal" | "partial" | "full" (see §2.5)
  "source": {
    "site": "pokepaste",
    "paste_id": "7205bf28f85d1e79",
    "source_url": "https://pokepast.es/7205bf28f85d1e79",
    "fetched_at": "2026-05-04T19:32:11Z"
  }
}

// PasteFetchResult — what the tool returns
{
  "paste_id": "7205bf28f85d1e79",
  "raw_text": "Charizard @ Charizardite Y\n...",
  "sets": [TeamSet, TeamSet, ...],     // 1..6 entries
  "warnings": ["slot 3: unknown move 'Foo'"],
  "fetched_at": "2026-05-04T19:32:11Z"
}
```

`schema_version`, `source`, `fetched_at` per CLAUDE.md §5. The `source.paste_id` enables joins back to `tournament_teams.team_url`.

### 2.5 Completeness tag

A coarse signal for downstream ranking. Computed at parse time:

| Tag         | Required fields present                            |
|-------------|----------------------------------------------------|
| `minimal`   | species + item + ability + moves                   |
| `partial`   | minimal + (sps OR nature)                          |
| `full`      | minimal + sps + nature                             |

Anything below `minimal` (e.g. species-only) is rejected — the paste is malformed.

The lead planner sorts citations by `completeness DESC, placement ASC` so full sets win when available; minimal sets still cite when full ones are absent.

### 2.6 Parsing strategy

We use **`@pkmn/sets`** (`npm install @pkmn/sets`) — the official Showdown set parser maintained by `kjscheibo`. Why:
- Battle-tested against the canonical Showdown export grammar.
- Handles partial sets gracefully (returns the fields it found).
- Returns Showdown-style species ids (`charizard`, `ninetales-alola`) that match our roster ids exactly.
- Trivially extracted to our shape — no regex maintenance.

The translation layer in `src/tools/pokepaste/transform.ts` is responsible for:
1. Calling `@pkmn/sets`'s `parseTeam(rawText)` (or the equivalent — confirmed in tech plan).
2. **Stripping `Tera Type` from each parsed set unconditionally.** Reg M-A enforcement.
3. **Renaming `evs → sps` per CLAUDE.md §10.** Domain uses `sps`; only the calc-engine boundary uses `evs`.
4. Validating `item`/`ability`/`moves` against the Champions ref tables (`items`, `abilities`, `moves`) from `pokemon-roster-db`. **Unknown values reject-and-fail** (per §6 Q4) — the transform throws, no `team_sets` rows for that team are written, the offending value is logged for the labmaus ingest run summary.
5. Mapping `species` to our roster id; unknown species fail loud (consistency with labmaus species-map policy).
6. Computing the `completeness` tag.

### 2.7 Storage — extends the existing SQLite (Drizzle) DB

Per memory `db_orm_drizzle.md`, one new table:

```
team_sets    (id PK,
              tournament_team_id FK → tournament_teams.id,
              slot INTEGER 0..5,
              species_roster_id FK → species.id,
              item TEXT NULL,
              ability TEXT NULL,
              level INTEGER NULL,
              moves TEXT NOT NULL,           -- JSON array
              sps TEXT NULL,                 -- JSON object {hp,atk,...}
              ivs TEXT NULL,                 -- JSON object
              nature TEXT NULL,
              completeness TEXT NOT NULL,    -- enum
              source_site TEXT NOT NULL,     -- always "pokepaste"
              source_paste_id TEXT NOT NULL,
              source_url TEXT NOT NULL,
              fetched_at TEXT NOT NULL,
              PRIMARY KEY (tournament_team_id, slot)   -- composite
             )
```

Indexes:
- `team_sets(species_roster_id)` — "what's Sneasler running?" queries.
- `team_sets(item)` — "who's running Focus Sash?" queries.
- Unique `(tournament_team_id, slot)` — idempotent upsert.

No new ref table is needed — `items`, `abilities`, `moves` already exist from `pokemon-roster-db`.

### 2.8 Ingest pipeline (extends labmaus's)

```
                  scripts/data/ingest-labmaus.ts
                              │
                              ▼
        for each NEW tournament_team row written:
          paste_id = extract from team_url
          if (team_sets has rows for tournament_team_id) → skip
          else:
            raw = pokepaste.fetchPaste(paste_id)        (throttled, disk-cached)
            sets = transform(raw)                       (Tera stripped, evs→sps,
                                                         ref-table validated)
            upsert team_sets rows (one per slot)
```

- **Same throttle as labmaus** — 1 req/s, exp backoff. Pokepaste isn't rate-limited but we're polite.
- **Same disk cache** — `data/cache/pokepaste/<paste-id>.txt`. Content-addressed → never expires; refresh requires manual cache delete.
- **Idempotency** — composite PK `(tournament_team_id, slot)` makes upsert trivial. Re-running the labmaus ingest produces zero diffs.
- **Failure handling** — a 404 on `/raw` (paste deleted, malformed URL) logs a warning and continues; the labmaus row stays, just without sets. A parse failure logs the offending paste_id and continues; never blocks the labmaus ingest.

### 2.9 Where it sits in the repo

```
src/
  schemas/
    team-set.ts                            (zod: TeamSet, PasteFetchResult, Sps, Ivs)
  tools/
    pokepaste/
      SPEC.md                              (per CLAUDE.md §8)
      client.ts                            (HTTP: throttled, cached, 404-tolerant)
      fetch-paste.ts                       (tool fn — public API)
      transform.ts                         (raw text → TeamSet[]; uses @pkmn/sets;
                                            strips Tera; evs→sps; ref-table validates)
  db/
    drizzle-schema.ts                      (extended with team_sets table)
    migrations/
      00XX_team_sets.sql                   (drizzle-kit generated)
    sets.ts                                (bespoke repo: list/get/usage)
fixtures/
  pokepaste/
    2026-05-04__7205bf28f85d1e79.txt      (1st place team — minimal completeness)
    2026-05-04__a5f32930d39e424e.txt      (2nd place — minimal)
    2026-05-04__synthetic-full-spread.txt (hand-crafted: full SPS+IVs+Nature
                                            for parse coverage)
    2026-05-04__synthetic-partial.txt     (hand-crafted: SPS only, no IVs/nature)
    2026-05-04__synthetic-edge-cases.txt  (Mega Stone, regional form, ♂/♀ symbol,
                                            empty moves, missing ability)
tests/
  tools/
    pokepaste/
      schema.test.ts                       (zod round-trip)
      transform.test.ts                    (Tera stripped; evs→sps; completeness
                                            tag correct; partial sets preserved;
                                            unknown move → warning, not error)
      client.test.ts                       (URL building, throttle, cache, 404)
  db/
    sets.test.ts                           (repo unit — in-memory sqlite;
                                            usage() per dimension)
  contract/
    pokepaste-live.test.ts                 (weekly: fetch a known stable paste id;
                                            assert /raw still returns the
                                            expected shape)
```

### 2.10 Test strategy (Stage 4 will write red first)

- **Schema:** zod round-trip on the 5 fixture pastes (variety: minimal, full, partial, edge cases).
- **Tera enforcement:** explicit test that `Tera Type: <anything>` is stripped from every parsed set; property test that no persisted row has any `tera_*` column.
- **`evs → sps` translation:** `@pkmn/sets` returns `evs`; our transform output has `sps`. Round-trip identity test.
- **Completeness tag:** `minimal | partial | full` computed correctly across the 5 fixtures.
- **Ref-table validation:** unknown item/ability/move logs a warning but doesn't fail; the row persists. Unknown species fails loud.
- **Repo queries:** `sets.usage(species="Sneasler", dimension="item")` returns the expected ranked list from a fixture-loaded DB.
- **Idempotent ingest:** running the labmaus pipeline twice produces zero `team_sets` deltas.
- **Contract test (weekly, gated):** fetch a known stable paste id; assert the response is non-empty plaintext that `@pkmn/sets` parses without throwing.

### 2.11 Out of scope for this slice

- **Authoring or editing pastes** — read-only ingest.
- **Set diffing across tournaments** ("how is Sneasler's spread evolving?") — interesting, but no UI consumer yet.
- **Player-attributed sets** ("show me all Wolfe Glick's Sneasler builds") — possible from this data shape, deferred.
- **Cross-source paste dedup** — same paste id from labmaus and Victory Road just ingests once (content-addressed). No fancy merge.
- **Image scraping** — pokepaste serves item/Pokemon images; we don't need them.

---

## 3. Data in / out

| Step | Input | Output |
|------|-------|--------|
| `pokepaste.fetchPaste({paste_id})` | hash from URL | `PasteFetchResult` (raw + sets + warnings) |
| labmaus ingest hook | new `tournament_teams` row | upserted `team_sets` rows (≤ 6) |
| `sets.list({tournament_id})` | tournament id | `TeamSet[]` for all teams in that tournament |
| `sets.get(team_id, slot)` | team id + slot 0..5 | `TeamSet \| null` |
| `sets.usage({species, dimension, lookback})` | species roster id + dimension + window | `UsageRow[]` ranked |

---

## 4. Error / empty states

- **404 on `/raw`** → warn, persist nothing for this team, labmaus row stays. Most likely cause: paste deleted by uploader.
- **Malformed export `@pkmn/sets` can't parse** → warn with `paste_id`, persist nothing for this team, do not block the labmaus ingest.
- **Unknown species** → fail loud with `paste_id` and offending species; consistent with labmaus species-map policy. Indicates a roster gap.
- **Unknown item / ability / move** → **reject-and-fail** (per §6 Q4). The transform throws; the team's `team_sets` rows are not written; the labmaus row stays. The labmaus ingest does not abort — it logs the offending paste/team/value in the run summary and continues. Resolution path: refresh the Champions ref tables (`pnpm data:build:reg-m-a`), then re-run the labmaus ingest (cache makes pokepaste re-fetches free; only the previously-rejected teams will be (re-)processed).
- **Tera field present in raw** → stripped silently; contract test asserts none survive.
- **Empty paste** (no sets) → warn, persist nothing.
- **Network error / timeout** → exp backoff, 3 retries, then surface; the labmaus ingest commits its progress and the next run re-fetches missing teams.

---

## 5. Success criteria (this slice)

- [ ] `TeamSet`, `PasteFetchResult`, `Sps`, `Ivs` zod schemas landed; round-trip tests pass on ≥5 fixture pastes.
- [ ] `pokepaste.fetchPaste` tool wired; cited, throttled, fixture-tested, JSON-Schema-described per CLAUDE.md §8.
- [ ] `team_sets` Drizzle table + migration applied; FK to `tournament_teams` and `species` enforced.
- [ ] `sets.{list,get,usage}` repo green; in-memory SQLite unit tests pass.
- [ ] No `tera_*` field appears in any persisted row (test enforces).
- [ ] `evs → sps` translation is identity (test enforces).
- [ ] Completeness tag correct across the 5 fixtures.
- [ ] Idempotent ingest: rerunning the labmaus pipeline produces zero `team_sets` deltas.
- [ ] Cold-start parsing of the full labmaus backfill completes in under 5 min on a laptop.
- [ ] Weekly contract test in place; schema-drift / pokepaste downtime routes to the user.

---

## 6. Open questions for Stage 2 review

1. **`@pkmn/sets` API confirmation.** The library is the right tool, but the exact entry point (`parseTeam` vs `Sets.unpack` vs `Teams.unpack`) needs verification against the current published version. **Action for tech-lead Stage 3:** verify and pin the exact import path.
Answer: Defer to Tech Lead stage 3.

2. **Warning routing.** Per-paste warnings (unknown move, unknown item) accumulate during a backfill. Should they: (a) log to stderr and disappear, (b) write to a table `ingest_warnings` for later review, (c) surface in the labmaus ingest's exit summary? **Proposal: (c) for now — print a per-run summary; promote to (b) if the count grows.**
Answer: (c) for now — print a per-run summary; promote to (b) if the count grows.

3. **Completeness thresholds.** Three tags (minimal/partial/full) — too coarse, too fine, just right? **Proposal: ship three; revisit if the lead planner wants finer ranking.**
Answer: ship three; revisit if the lead planner wants finer ranking.

4. **Item/move validation strictness.** Warn-and-persist is permissive; the alternative is reject-and-fail. **Proposal: warn for now (Champions meta patches can outpace our ref-table refresh); revisit if we see real pollution.**
Answer: Reject-and-fail, we want clean data in the use of our tools.

5. **`Level: 50` line.** Always 50 in Reg M-A; persist literally or drop and assume? **Proposal: persist; nullable; surfaces "this paste explicitly stated 50" vs "absent" without lying.**
Answer: Persist; nullable; surfaces "this paste explicitly stated 50" vs "absent" without lying.

6. **Pokepaste fetch parallelism.** Backfill of N teams = N pokepaste fetches. Same `1 req/s` throttle as labmaus, or higher (different host)? **Proposal: separate throttle bucket per host; 2 req/s for pokepaste (still polite, halves backfill time).**
Answer: Separate throttle bucket per host; 2 req/s for pokepaste (still polite, halves backfill time).

7. **`team_sets` row when paste fetch fails.** Two options: (a) write zero rows (current proposal — labmaus team has no sets), (b) write 6 placeholder rows with `species_roster_id` from labmaus and everything else null. **Proposal: (a) — placeholder rows would falsely satisfy "has sets" queries.** The composition is already on the labmaus row; not duplicated here.
Answer: (a) — placeholder rows would falsely satisfy "has sets" queries. The composition is already on the labmaus row; not duplicated here.

8. **Plan-doc revision to labmaus.** Adding pokepaste means the labmaus tech plan's `usage()` proposal (species + cores only) flips back to (species + items + moves + cores). The labmaus plan needs a small Stage 3 revision to reflect this — likely just edits to §6 (repo design) and §10 (test ordering). **Action: handle in tech-lead Stage 3 for *this* slice; flag the labmaus plan revision as a sibling deliverable.**
Answer: Handle in tech-lead Stage 3 for *this* slice; flag the labmaus plan revision as a sibling deliverable.

9. **Fixtures count.** Five proposed: 2 real + 3 synthetic. Enough to exercise parser edge cases? **Proposal: yes for v1; add more if a Stage-6 reviewer flags coverage gaps.**
Answer: Yes for v1; add more if a Stage-6 reviewer flags coverage gaps.

10. **Stage 4 test ordering.** Schema → transform (Tera strip + evs→sps + completeness + ref-table validation) → client (mocked HTTP, 404, throttle, cache) → repo (in-memory sqlite) → ingest hook (extends labmaus pipeline; idempotency) → contract (live, gated). OK?
Answer: Yes, that ordering makes sense.

---

## 7. Reviewed-by

_Rodrigo Caballero_
