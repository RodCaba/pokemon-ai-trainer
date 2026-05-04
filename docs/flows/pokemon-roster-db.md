# Flow — Pokemon Roster DB (Reg M-A)

**Slug:** `pokemon-roster-db`
**Stage:** Shipped (2026-05-04). Flow approved Stage 2; tech plan + Stages 4–6 closed in `docs/plans/pokemon-roster-db.md` and `docs/reviews/pokemon-roster-db.md`.
**Approved-by:** Rodrigo Caballero (2026-05-04)
**Author:** Claude (main agent)
**Date:** 2026-04-29 (v1) → 2026-05-04 (v3 — Bulbapedia removed per Q6)
**Supersedes:** v1 (Bulbapedia-derived stats — wrong); v2 (Smogon-sourced + Bulbapedia roster cross-check). v3 drops Bulbapedia entirely: Smogon's `ChampionsLegal` species set IS the roster, full stop.

The system needs an authoritative Pokemon DB scoped to Reg M-A so every downstream tool (calc fixtures, team validator, lead planner, weakness audit, meta merger) can answer "is this species legal?" and "what are its base stats / types / abilities / movepool in Champions?" deterministically.

> **Reg M-A format rules already encoded elsewhere:** no Tera, no IVs (calc layer fills 31s), EV pool 66 total / 32 per stat / step 1.

> **Roster scope:** ~286 species/forms per `Generations.get(0).species` in `@smogon/calc` master (includes 60 Mega forms; Bulbapedia counted only the 226 base species). No restricted-Pokemon rule, no item bans, no move bans known.

> **🔑 Source of truth:** **`@smogon/calc` master branch** (Champions slices, keyed at `gen.num === 0`) — the **only** source. Bulbapedia is no longer in the pipeline (resolved Q6, 2026-05-04). The committed `data/reg-m-a/raw-roster.bulbapedia.json` from the original investigation is retained as a historical artifact only. See memory `smogon_calc_champions_source.md`. Champions support landed in master on 2026-04-16 and is **not yet in any published npm release** (latest npm tag `0.11.0` predates it). Pinned via the `RodCaba/damage-calc` fork — see §2.6.

---

## 1. User flow

The DB is **agent- and tool-facing**. End-users experience it indirectly through three product surfaces.

### 1.1 Surface A — Team builder legality (primary)
1. Player adds a Pokemon to a team in the Team Lab.
2. Team Lab calls `roster.get(speciesName, "RegM-A")` → returns the canonical `Pokemon` record or `null`.
3. If `null`, rejected with: *"`<name>` is not legal in Reg M-A. Did you mean `<closest>`?"*. Suggestions come from `roster.search(...)`.
4. If found, the editor pre-fills Champions base stats, types, available abilities, and the Champions movepool.

### 1.2 Surface B — Calc fixture authoring
1. Fixture-generation script can ask "give me all Reg M-A physical attackers with base Atk ≥ 100" or "give me Pokemon with Friend Guard in Champions" — the DB answers both.
2. Without this DB, fixtures get authored with SV-VGC names that aren't in Champions (this happened on 2026-04-29).

### 1.3 Surface C — Meta intelligence merge (future)
1. Pikalytics / Smogon usage data is keyed by Showdown species ids.
2. We project those into Reg M-A — anything outside the legal roster is dropped or tagged "out-of-format."

### Acceptance (user-perceived)
- Adding any Reg M-A legal species succeeds; non-legal is rejected with suggestions.
- Damage calcs that name a non-legal species fail at fixture-load (or, for live agent calls, at team-validate time).
- Stats and movepool shown in the UI **match Showdown's Champions calculator exactly**.

---

## 2. Tech flow

### 2.1 Module surface (final shape lands in tech plan)

```
roster.list(format: "RegM-A"): RosterEntry[]
roster.get(species: string, format: "RegM-A"): Pokemon | null
roster.search(query: string, format: "RegM-A"): SearchHit[]   // fuzzy
roster.has(species: string, format: "RegM-A"): boolean
roster.sets(species: string, format: "RegM-A"): SampleSet[]   // from SETDEX_CHAMPIONS

items.list(format: "RegM-A"): Item[]                          // ~117 in Champions
items.get(name: string, format: "RegM-A"): Item | null
items.has(name: string, format: "RegM-A"): boolean

abilities.list(format: "RegM-A"): Ability[]
abilities.get(name: string, format: "RegM-A"): Ability | null
abilities.has(name: string, format: "RegM-A"): boolean

moves.list(format: "RegM-A"): Move[]
moves.get(name: string, format: "RegM-A"): Move | null
moves.has(name: string, format: "RegM-A"): boolean
```

Backing store is SQLite (`better-sqlite3`); each function is a prepared statement.
Sub-millisecond read latency once the DB handle is open.

### 2.2 The `Pokemon` record (sketch — final lands in tech plan)

```jsonc
{
  "schema_version": 1,
  "id": "garchomp",                       // Showdown-style canonical id (lowercase, no spaces)
  "display_name": "Garchomp",
  "dex_no": 445,
  "form_id": null,                        // null for base, e.g. "alola"
  "types": ["Dragon", "Ground"],
  "base_stats": {                         // Champions stats, NOT SV (may differ via Champions_PATCH)
    "hp": 108, "atk": 130, "def": 95, "spa": 80, "spd": 85, "spe": 102
  },
  "abilities": {                          // Champions ability slots — may include Champions-only abilities (Mega, Piercing Drill, Dragonize, ...)
    "0": "Sand Veil",
    "1": null,
    "h": "Rough Skin"
  },
  "movepool": [                           // Champions movepool (SV ± Champions_PATCH)
    "Dragon Claw", "Earthquake", "Outrage", "Stone Edge", "Swords Dance"
  ],
  "weight_kg": 95.0,
  "height_m": 1.9,
  "source": {
    "stats_source": "@smogon/calc#<sha> Generations.get(0).species (Champions slice)",
    "movepool_source": "@smogon/calc#<sha> Generations.get(0).species.<id>.learnset",
    "abilities_source": "@smogon/calc#<sha> Generations.get(0).species.<id>.abilities",
    "fetched_at": "2026-05-04",
    "engine_sha": "c1f6bc0fa2e0ee068b9e3061fa68b7db307e6c55"
  }
}
```

Every field carries provenance. `engine_sha` lets us reason about which Champions data version produced this record.

### 2.3 `SampleSet` (from `SETDEX_CHAMPIONS`)

```jsonc
{
  "set_name": "Choice Scarf",
  "ability": "Rough Skin",
  "item": "Choice Scarf",
  "nature": "Jolly",
  "moves": ["Outrage", "Earthquake", "Stone Edge", "Iron Head"],
  "sps": { "hp": 0, "atk": 32, "def": 0, "spa": 0, "spd": 2, "spe": 32 },
  "source": {
    "set_source": "https://calc.pokemonshowdown.com/js/data/sets/champions.js",
    "fetched_at": "2026-04-29"
  }
}
```

Both Smogon and our domain use `sps` (Stat Points) — they match (Q3, 2026-05-04). The legacy `evs` field name is rejected at the schema layer with a Champions-specific error message. The `@smogon/calc` engine API still uses `evs` as its property name; the translation `sps → evs` happens only inside `src/tools/damage-calc/mapping.ts`.

### 2.4 Storage — two-tier DB

**Per CLAUDE.md §5 and explicit user direction (2026-05-04): no JSON files for the runtime DB.** Two backing stores, each with a clear ownership boundary.

#### Tier A — Structured / relational (SQLite via `better-sqlite3`)

For data with a fixed shape that is queried by exact match, range, or join:

- `species` — id, display_name, dex_no, form_id, types, weight, height, source provenance.
- `species_stats` — `species_id`, hp, atk, def, spa, spd, spe, bst (computed). One row per species (Champions stats from `Generations.get(0)`).
- `species_abilities` — `species_id`, slot (`"0" | "1" | "h"`), ability_name. Many rows per species.
- `species_movepool` — `species_id`, move_name. Many rows per species.
- `sample_sets` — `species_id`, set_name, ability, item, nature, moves (JSON column), sps (JSON column — Champions terminology, see CLAUDE.md §10), source.
- `roster_membership` — `species_id`, format ("RegM-A"), is_legal, is_mega, source notes.
- **`items`** — id, display_name, category, source. Read-only reference table; ~117 Champions items including Mega Stones (per Q12).
- **`abilities`** — id, display_name, source. Read-only reference table.
- **`moves`** — id, display_name, type, category (Physical/Special/Status), base_power, accuracy, source. Read-only reference table.
- `schema_migrations` — Knex/SQL-up migrations (immutable, hash-pinned).

Why SQLite:
- Single-file, zero-ops; ships in the repo or beside it.
- Sub-ms queries even for `roster.list()` and stat-range filters (e.g. "all attackers with base Atk ≥ 100").
- The agent can be given read-only SQL access via a tool; LLMs handle SQL well for narrow schemas.
- Every cell answers "is this species legal?" with a single indexed lookup.

#### Tier B — Vector store (TBD: Chroma, LanceDB, or sqlite-vec)

For data with **no fixed shape** that is queried by **semantic similarity**:

- **Pokemon strategy notes** — "Garchomp commonly leads with Earthquake to pressure Steel + Rock targets; pivots into Outrage when locked." Free-text, multiple per species, sourced from articles, replays, YouTube transcripts (later milestones).
- **Matchup write-ups** — "Tyranitar vs. Volcarona: Sand chip + Stone Edge means Volcarona must run a Rock-resist berry or stay behind a screen."
- **Tech notes** — "Rotom-Wash with Will-O-Wisp + Levitate is the standard Garchomp answer in Reg M-A."
- **Lead patterns** — narrative descriptions of opening sequences (consumed by the lead planner).

Each vector record carries: an `Insight` per CLAUDE.md §6 shape (atomic claim, subjects.pokemon, source URL + excerpt + author + published_at, confidence, stance, embedding ref). The vector store handles similarity search over the embedding; the relational tier holds the structured `subjects.pokemon` foreign key so we can intersect "all Insights about Garchomp" semantically with "all Insights from Smogon set notes" structurally.

#### Snapshots stay as JSON

The committed source snapshots are still flat files — they are *inputs* to the build, not the runtime DB:

- **`data/reg-m-a/raw-roster.bulbapedia.json`** — immutable Bulbapedia fetch (committed).
- **`data/reg-m-a/raw-sets.smogon.json`** — snapshot of `SETDEX_CHAMPIONS` (committed).

These are read by the build pipeline, projected into SQLite + vector store. They never leave the build step.

#### Files

- `data/reg-m-a/db.sqlite` — runtime SQLite DB (committed; treat as a build artifact regenerated by `pnpm data:build:reg-m-a`; deterministic byte-identical output enables PR diffs).
- `data/reg-m-a/vectors/` — vector store files (format depends on choice; e.g., LanceDB Parquet shards or Chroma SQLite).
- `data/reg-m-a/cross-check.md` — human-readable reconciliation log (still a markdown file — it's documentation, not query data).
- `src/db/schema.sql` — canonical SQL schema for the relational tier.
- `src/db/migrations/` — versioned migration files.
- `src/db/roster.ts` — repository module. Opens the SQLite DB once, exposes `list/get/search/has/sets` over prepared statements.
- `src/db/insights.ts` — repository module for the vector store. Exposes `search(query, filter)`, `add(insight)`.

#### Vector store choice (deferred until first use)

The vector store choice can be deferred until the first feature actually consumes it (lead planner or YouTube ingest, both later milestones). For this slice we land **only the relational tier**; the vector tier is scaffolded with a stub interface so the agent shape is correct, but no real embeddings are written. Per `CLAUDE.md` §5 the candidates are Chroma, LanceDB, or `sqlite-vss`/`sqlite-vec`. Decision criteria captured in §6 Q11 below.

### 2.5 Build pipeline

```
@smogon/calc master Champions slices  ─┐
(species, moves, abilities, items)    ─┤
                                       ├─►  scripts/data/build-reg-m-a.ts
SETDEX_CHAMPIONS (champions.js fetch) ─┘            │
                                                    ▼
                              ┌─────────────────────┴─────────────────────┐
                              ▼                                           ▼
                     data/reg-m-a/db.sqlite                       data/reg-m-a/vectors/
                     (relational tier — full)                     (vector tier — stubbed in v1)
```

- Run via `pnpm data:build:reg-m-a`.
- **Idempotent.** Same inputs → byte-identical SQLite output. The build uses fixed insertion order, deterministic SQL, and `PRAGMA journal_mode=DELETE; VACUUM;` at the end to ensure stable file bytes — diffs in PRs are meaningful.
- **No live network calls at build time** — Smogon Champions data is read from the pinned `@smogon/calc` package; `SETDEX_CHAMPIONS` is read from a committed snapshot (`raw-sets.smogon.json`). Refreshing the snapshot is its own command (`pnpm data:refresh:reg-m-a`) and produces a separate PR.
- **Schema migrations** run before insertion. New columns or tables go through `src/db/migrations/`, never via ad-hoc ALTER in the build script.
- **Roster source: Smogon only.** Bulbapedia was removed from the pipeline 2026-05-04 (Q6). Smogon's `Generations.get(0).species` enumeration IS the legality list — no reconciliation step needed.

### 2.6 Dependency strategy (the load-bearing decision) — **resolved by spike**

```jsonc
// package.json (current, as of 2026-05-04)
"dependencies": {
  "@smogon/calc": "git+https://github.com/RodCaba/damage-calc.git#c1f6bc0fa2e0ee068b9e3061fa68b7db307e6c55&path:/calc"
}
```

- **Fork:** `RodCaba/damage-calc`, branch `champions-pinned-build`. Tracks upstream `smogon/damage-calc` master at SHA `37b0afaadca7a2c4476cabe27ed44d2e744e3c87` (2026-04-27 — first SHA containing Champions support).
- **One-line patch on the fork:** `calc/package.json` `prepare` script changed from `npm run build` to `npm run compile`. Why: upstream's `bundle` step requires `@babel/core`, which lives only in the workspace root and is absent from the `calc/` tarball pnpm fetches → bundle fails → install fails. We don't need the bundle output (it's the minified `production.min.js` for the web UI), only `compile`'s `dist/`.
- **Pin an exact commit SHA, not the branch ref.** Branches move; a SHA is reproducible. Current pin: `c1f6bc0fa2e0ee068b9e3061fa68b7db307e6c55` (the patched commit).
- **Required at consumer (this repo):** `pnpm-workspace.yaml` allowlist —
  ```yaml
  onlyBuiltDependencies:
    - "@smogon/calc"
  ```
  pnpm 10 blocks build scripts on git-hosted deps by default; the allowlist opts in.
- **Refresh workflow:** when upstream master moves and we want the new Champions data, on the fork: `git fetch upstream && git rebase upstream/master`, force-push the patch branch, take the new SHA, bump the pin in `package.json`. ~2 min per refresh.
- **Weekly contract test** (`tests/contract/upstream-calc.test.ts`) hits the npm registry for `@smogon/calc` releases; if a published version > our pin's date contains `dist/mechanics/champions.js`, the test fails with "switch from GitHub pin to npm release `<X.Y.Z>`." See memory `smogon_calc_champions_source.md`.
- **Spike evidence:** `docs/spikes/smogon-calc-champions-install.md` documents the original spike + the spike-2 addendum that validated this exact install path against the real fork.

### 2.7 Roster source — Smogon only (no reconciliation)

**Resolved 2026-05-04 (Q6):** Bulbapedia is no longer part of the pipeline. The roster is exactly what `Generations.get(0).species` in `@smogon/calc` master enumerates — currently 286 entries (226 base species + 60 Mega forms). The build:

1. Iterates `Generations.get(0).species`.
2. For each entry, projects into the `species` table plus `species_stats`, `species_abilities`, `species_movepool` (and the `roster_membership` row marking it as legal in Reg M-A, with `is_mega` flag derived from the name suffix).
3. Stops. There is no Bulbapedia-vs-Smogon comparison, no `cross_check_log` table, no `cross-check.md` file.

The historical `data/reg-m-a/raw-roster.bulbapedia.json` snapshot is retained as a committed artifact for traceability of how the project arrived at this decision, but **the build pipeline does not read it**. It can be deleted in a future cleanup if no one references it.

If Bulbapedia ever needs to come back (e.g., to validate Smogon's roster against an independent source), it can be reintroduced as a non-blocking *audit* step in CI, not a build dependency.

### 2.8 Where it sits in the repo

```
data/
  reg-m-a/
    raw-roster.bulbapedia.json     (historical artifact — NOT read by the build; retained for traceability)
    raw-sets.smogon.json           (committed snapshot — input to build)
    db.sqlite                      (build artifact — relational tier)
    vectors/                       (build artifact — vector tier; stubbed in v1)
src/
  schemas/
    pokemon.ts                     (zod: Pokemon, RosterEntry, SampleSet, Insight, SearchHit)
  db/
    schema.sql                     (canonical relational schema)
    migrations/
      0001_initial.sql
      ...
    open.ts                        (DB handle factory; opens sqlite, applies pragmas, lazy-singleton)
    roster.ts                      (relational repo: list/get/search/has/sets — for species)
    items.ts                       (relational repo: list/get/has — for items)
    abilities.ts                   (relational repo: list/get/has — for abilities)
    moves.ts                       (relational repo: list/get/has — for moves)
    insights.ts                    (vector repo: search/add — stub interface in v1)
scripts/
  data/
    build-reg-m-a.ts               (pipeline → SQLite + vectors)
    refresh-reg-m-a.ts             (snapshot updater — manual trigger)
    fetchers/
      smogon-champions-data.ts     (extracts Champions slices from @smogon/calc)
      smogon-champions-sets.ts     (parses SETDEX_CHAMPIONS)
tests/
  data/
    schema.test.ts                 (zod round-trip)
    roster.test.ts                 (relational repo unit — uses in-memory sqlite)
    insights.test.ts               (vector repo stub interface tests)
    coverage.test.ts               (every reconciled species has a row in `species`)
    integrity.test.ts              (no missing stats, abilities engine-known, etc.)
    sps-evs-translation.test.ts    (sps → evs is identity transform)
    determinism.test.ts            (build outputs byte-identical SQLite on rerun)
  contract/
    upstream-calc.test.ts          (weekly: detect npm release with Champions)
```

### 2.9 Test strategy (Stage 4 will write red first)

- **Schema tests:** `Pokemon` record shape, id regex, `formats` literal `"RegM-A"`, `types` enum, `base_stats` non-negative ints, abilities slots, etc.
- **Repository tests:** `get("Garchomp")` returns Garchomp; case-insensitive lookup; `get("Urshifu")` → `null`; `has("Flutter Mane")` → `false`; `search("garcha")` → Garchomp ranked 1; `sets("garchomp")` returns at least one `SampleSet`.
- **Coverage tests:** every reconciled species has a `pokemon/<id>.json` record. No orphans.
- **Integrity tests:** every `base_stats` field populated and > 0; every `abilities` value either `null` or a non-empty string; every `movepool` non-empty; `cross-check.md` is up-to-date with the reconciled species list.
- **`sps ↔ evs` translation:** round-trip identity test on `SampleSet.evs`.
- **Determinism:** `pnpm data:build:reg-m-a` produces zero diffs on a clean re-run.
- **Contract test:** weekly job watches for an npm release containing Champions.

### 2.10 Out of scope for this slice

- Items DB (separate flow doc; Champions has its own item slice, fetch identically).
- Moves DB (separate flow doc; Champions movepool here is just `string[]` referenced by name).
- Abilities DB (we record names; engine has the rest).
- Item/move legality enforcement at the calc-tool layer (`damage_calc` stays format-agnostic at the math layer).
- UI for browsing the roster.
- Live updates (polling or webhook for new Champions patches).

---

## 3. Data in / out

| Step | Input | Output |
|------|-------|--------|
| `roster.get(name)` | species name (any case) | `Pokemon` or `null` |
| `roster.list()` | none | full `Pokemon[]` |
| `roster.search(query)` | partial name | `SearchHit[]` ranked by edit distance |
| `roster.has(name)` | species name | `boolean` |
| `roster.sets(name)` | species name | `SampleSet[]` (may be empty) |
| build pipeline | raw snapshots + pinned `@smogon/calc` SHA | `pokemon/`, `sets/`, `index.json`, `cross-check.md` |

---

## 4. Error / empty states

- **Unknown species** → `roster.get` returns `null`. Caller decides: throw, suggest, drop.
- **Ambiguous form** (e.g. `"Slowbro"`) → returns base form; explicit qualifier required for alternates.
- **Schema-invalid record** at load time → loud error, refuses to start.
- **Reconciliation gap** → flagged in `cross-check.md`; build still succeeds for the reconciled set.
- **Build runs without snapshot files** → loud error, refuses to build.

---

## 5. Success criteria (this slice)

- [x] `@smogon/calc` upgraded to a pinned GitHub master commit (resolved 2026-05-04); `damage_calc`'s existing 56 tests still green.
- [ ] `data/reg-m-a/raw-sets.smogon.json` snapshot committed.
- [ ] `Pokemon`, `SampleSet`, `Item`, `Ability`, `Move` zod schemas landed; round-trip tests pass.
- [ ] All Champions species have rows in `species` + `species_stats` + `species_abilities` + `species_movepool`, populated from `@smogon/calc` Champions slices.
- [ ] All Champions items / abilities / moves have rows in `items` / `abilities` / `moves`.
- [ ] `roster.{list,get,search,has,sets}`, `items.{list,get,has}`, `abilities.{list,get,has}`, `moves.{list,get,has}` work; unit tests green.
- [ ] Coverage + integrity tests green: every species in `Generations.get(0).species` is in the DB; every recorded ability/move/item is engine-known.
- [ ] `pnpm data:build:reg-m-a` is deterministic (byte-identical SQLite on rerun).
- [ ] Contract test in place to detect a Champions-containing npm release of `@smogon/calc`.
- [ ] Vector tier ships as a stub interface (no real embeddings yet — full integration deferred to first consuming feature).

---

## 6. Open questions for Stage 2 review

1. ~~**Spike before commit.**~~ ✅ **Resolved 2026-05-04.** Two spikes ran (see `docs/spikes/smogon-calc-champions-install.md`). Direct `pnpm add github:smogon/damage-calc#<sha>` fails because of the bundle script + missing `@babel/core` in the `calc/` tarball. Resolution: forked to `RodCaba/damage-calc`, single-line `prepare` patch (`build → compile`), pinned the patched SHA via `git+https://...&path:/calc`. End-to-end Champions calc verified (Garchomp Earthquake vs Tyranitar = 174–206 dmg, 93.8% OHKO). Project's existing 56 tests still pass against the new dep; only one assertion needed updating (`ENGINE_VERSION` from `0.10.0` to `0.11.0`).
2. ~~**`damage_calc` migration.**~~ ✅ **Resolved 2026-05-04.** Migrated `damage_calc` to Champions gen (`Generations.get(0)`). All 56 functional tests pass on Champions gen; required updating the shared test fixture (`tests/fixtures/valid-input.ts`) from SV-VGC species (Urshifu/Flutter Mane/Wicked Blow) to Champions-legal species (Garchomp/Tyranitar/Earthquake) and switching the immunity test to Earthquake vs. Levitate Rotom-Wash. **Notable Champions item-set deltas surfaced**: Choice Band, Choice Specs, Life Orb, Booster Energy, Eviolite, Heavy-Duty Boots are NOT in Champions (only 117 items total; Mega Stones are first-class). Test fixture now uses Choice Scarf + Leftovers as the canonical items.
3. **`sps` vs `evs` terminology.** Stick with `evs` in our domain schemas (familiarity for VGC players) and translate `sps → evs` once at the importer? Or rename to `sps` to match Smogon? **Proposal: keep `evs`, translate at boundary.**
Answer: In champions, EVs are renamed to SPS (Stat Points), it is important know to have that distinction in our domain language. We will use `sps` in our schemas and translate from `evs` at the boundary. This way we maintain clarity and consistency with the source data.
4. **Champions ability handling.** Champions adds abilities (Mega, Piercing Drill, Dragonize). Do we surface these in our schemas as a known enum, or treat ability as opaque `string` and trust the engine? **Proposal: opaque string; the integrity test verifies every ability we record is engine-known.**
Answer: We will treat abilities as opaque strings in our schemas and rely on the engine to validate them. Our integrity tests will ensure that every ability we record is recognized by the engine, allowing us to accommodate Champions' unique abilities without needing to update our schema for each new addition.
5. **`SETDEX_CHAMPIONS` fetch cadence.** Smogon updates the set file on metagame patches. Refresh policy: weekly contract test compares hash, manual `pnpm data:refresh:reg-m-a` produces a PR with the new snapshot. OK?
Answer: OK
6. **Reconciliation: Bulbapedia missing from Smogon.** If a species is on Bulbapedia's roster but Smogon's Champions data doesn't have it, do we exclude (current proposal — we can't serve stats we don't have) or include with `base_stats: null` (so the Pokemon shows up but legality flags as "data-missing")? **Proposal: exclude for now; revisit if it bites.**
Answer: We will exclude Bulbapedia entirely. Roster is available from Smogon, and we want to avoid the complexity of handling partial records with missing stats. If this becomes a significant issue, we can revisit the decision and consider including such species with null stats and a "data-missing" flag.
7. **`@smogon/calc` GitHub install in pnpm.** pnpm sometimes has trouble with git deps that need a build step. If the spike (Q1) shows friction, fallback is to fork the repo, pre-build it, and depend on our fork. Worth flagging as a possible Stage 3 risk.
Answer: We have already resolved this issue by forking the repository and applying a patch to change the build script, allowing us to successfully install the Champions-supporting version of `@smogon/calc`. This approach has been verified through our spike, and we will continue to monitor for any issues that may arise from this setup.
8. **Form-qualifier syntax.** Bulbapedia uses freeform parens (`"Tauros (Paldean Form (Combat Breed))"`). Showdown uses ids (`taurospaldeacombat`). **Proposal: Showdown id is canonical; `display_name` is human; `aliases: string[]` for fuzzy lookup.**
Answer: We will use showdown-style ids as canonical identifiers for species. The `display_name` field will be used for human-readable names, and an `aliases` array will be included to support fuzzy lookup and accommodate variations in naming conventions. This approach allows us to maintain consistency with our data source while providing flexibility for user input.
9. **Champions PvP level.** Confirm L50 (matches our `CalcInput.level: literal(50)`). Smogon's `calculateChampions` likely assumes L50 too — verify in spike.
Answer: We will confirm that the Champions PvP level is indeed Level 50, which aligns with our `CalcInput.level` set to 50. This will be verified during our spike to ensure that our calculations and data align correctly with the expected level for Champions battles.
10. **Stage 4 test ordering.** Schema → repository (in-memory SQLite) → coverage + integrity (real built db.sqlite) → determinism → contract test. OK?
Answer: OK

11. **Vector store choice** (deferred until first use; v1 ships only the relational tier with a stub vector interface). Top candidates:
    - **`sqlite-vec`** — vector-search extension *inside* SQLite. Single file, same handle as the relational tier, zero extra ops. Newest of the three, smallest community, but conceptually clean.
    - **LanceDB** — embedded columnar vector DB. Battle-tested, fast, file-format-stable (Parquet), but a separate process boundary and another lockfile entry.
    - **Chroma** — popular, server-mode by default; embedded mode exists but the project pulls more deps.
    My proposal: **default to `sqlite-vec`** so the relational and vector tiers share one DB file, simplifying backup/restore/diff. Revisit if the embedding workload outgrows it (unlikely for a single-user system). OK to defer the actual install/integration to the lead-planner or YouTube-ingest milestone, with only the stub interface landing here?
Answer: We will default to using `sqlite-vec` for our vector store, as it allows us to keep both the relational and vector data in a single file, simplifying our data management. We will defer the actual installation and integration of the vector store until we have a clear use case that requires it, such as the lead planner or YouTube ingest features. This approach allows us to focus on building out the relational tier first while keeping the option open to integrate the vector store when it's needed.

12. **Champions item-set discovery.** While migrating Q2 we discovered Champions has 117 items and excludes Choice Band/Specs/Life Orb/Eviolite/etc. This implies the team-builder UI must source its item dropdown from the Champions item DB, not from `@smogon/calc`'s SV item table. Worth adding `items` and `abilities` and `moves` tables to the relational tier in this slice (small extra cost), or split into separate flow docs? **Proposal: include items/abilities/moves tables in this slice as read-only tables built from the same Champions slices — they're tiny (under 1 MB total) and avoid a follow-up flow for what is essentially the same source.**
Answer: Include items, abilities, and moves tables in this slice as read-only tables built from the same Champions slices. This approach allows us to maintain consistency across our data sources and ensures that our team-builder UI can accurately reflect the items available in Champions without needing to wait for a separate flow to be completed. Given that these tables are relatively small, the additional cost of including them in this slice is justified by the improved user experience and data integrity it provides.

---

## 7. Reviewed-by

Rodrigo Caballero
