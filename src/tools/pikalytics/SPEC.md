# pikalytics tool — SPEC

Implementation surface for the pikalytics meta-intelligence slice. See
`docs/plans/pikalytics.md` for design rationale.

## Tools registered

- `pikalytics_fetch_species` — fetch + parse one species snapshot from the
  `/ai/pokedex/<format>/<species>` AI-markdown endpoint.
- `pikalytics_teammates` — top-N teammates for a species (ranked by % desc).
- `pikalytics_usage` — rank items / abilities / moves / teammates / overall
  species by Pikalytics usage %.

## Endpoint

`GET https://www.pikalytics.com/ai/pokedex/gen9championsvgc2026regma/<species_slug>`
→ 200 text/markdown. 404 = not in coverage. Format slug pinned to Reg M-A.

`<species_slug>` is the Showdown-style hyphenated lowercase form derived from
`roster.get(...).display_name.toLowerCase()` — NOT the no-hyphen
`species_roster_id` (regression test: PIKA-T29b).

## Inputs

Defined in `src/schemas/pikalytics.ts`. Each is a `.strict()` zod object:

- **`PikalyticsFetchSpeciesArgs`** — `{ format: "RegM-A", species_roster_id: <kebab-or-flat lowercase id> }`.
- **`PikalyticsTeammatesArgs`** — `{ format: "RegM-A", species: <roster_id>, limit?: 1..50 }` (default 10).
- **`PikalyticsUsageArgs`** — `{ format: "RegM-A", dimension: "species" | "item" | "ability" | "move" | "teammate", species?: <roster_id>, limit?: 1..100 }` (default 50). Cross-field rule: when `dimension !== "species"`, `species` is required (zod `superRefine`).

## Outputs

- **`fetchSpecies`** → `{ snapshot: PikalyticsSnapshot, unknown_teammate_names: string[] }`. The snapshot is the canonical persisted shape (see plan §3); `unknown_teammate_names` accumulates teammate display names that didn't resolve through `roster.get`, so the ingest can record them in the run summary without re-deriving.
- **`teammates`** → `TeammateEntry[]` (length ≤ limit, descending by `percent`). Empty array if no snapshot exists.
- **`usage`** → `PikalyticsUsageRow[]` (length ≤ limit, descending by `usage_percent`). Each row carries `{ dimension, key, display_label, usage_percent, source_url, as_of }`. Empty array if no snapshot exists for the requested species (or, for `dimension="species"`, if no rows have a non-null `usage_percent`).
- All outputs are zod-validated at the trust boundary; the persisted shape is `.strict()` so any stray `tera_*` field is a hard reject.

## Edge cases

| Case | Behavior |
|---|---|
| HTTP 404 on `<slug>` | `PikalyticsNotFoundError`; not cached; ingest records in `species_404s`. |
| HTML response instead of markdown | `PikalyticsParseError` — Data-Date row missing → throw at parser layer. |
| Mega / regional / form variant (`charizard-mega-y`, `ninetales-alola`) | Resolved via `roster.display_name.toLowerCase()`; never via `species_roster_id`. |
| Apostrophe species (e.g. Farfetch'd) | Roster `display_name` carries the hyphenated kebab form; the apostrophe never appears in the URL slug. |
| `as_of` regression (upstream republishes older `YYYY-MM`) | `get` returns the latest by `as_of DESC`; an older write conflicts on `(species, as_of)` and is a no-op. |
| Two `as_of` rows for the same species in `usage(dimension="species")` | Latest-per-species via the `(species, MAX(as_of))` filter — older row never appears (regression: PIKA-T39b). |
| Optional sections missing (`Common Items`, `Common Moves`, etc.) | Empty arrays + a `raw_warnings` entry; not a throw. |
| `usage_percent` absent from live AI-markdown | `null` in the snapshot; `usage(dimension="species")` filters those out. |
| `--no-network` with empty cache directory | Preflight fails loud (exit 1, clear "no cache to replay" message); never silently 404s. |

## Citation rules

Every persisted row carries:

- `source.source_url` — human-facing pokedex URL (`/pokedex/<format>/<slug>`); this is the URL the agent surfaces in its citations.
- `source.ai_url` — machine-facing AI-markdown URL (`/ai/pokedex/<format>/<slug>`); used for re-fetch.
- `source.fetched_at` — OUR fetch time (ISO-8601 UTC with offset).
- `as_of` — Pikalytics's own publication date, parsed from the `**Data Date**` Quick-Info row and normalized to `YYYY-MM-01`. Recommendations must quote `as_of` so the user knows the snapshot's age.
- `usage(...)` rows propagate `source_url` + `as_of` from the snapshot they project.

## Error matrix

| Class | Trigger | Routed to (in ingest summary) |
|---|---|---|
| `PikalyticsInputError` | Tool-input zod failure or unknown roster id | `input_errors[]` |
| `PikalyticsNotFoundError` | HTTP 404 | `species_404s[]` |
| `PikalyticsNetworkError` | HTTP non-2xx (≠ 404) after retries; DNS / timeout | `network_failures[]` |
| `PikalyticsParseError` | Missing required `**Data Date**` row; structurally bad markdown | `parse_failures[]` |
| `PikalyticsTeraLeakError` | Any `tera_*` field appears in parser/transform output (Reg M-A invariant) | propagates → ingest exits 1 (programmer bug) |
| `RosterDbError` | SQLite I/O failure inside `pikalytics.{get,teammates,usage,exists,upsertSnapshot}` | propagates (caller decides) |

## Reg M-A hygiene

- Strip every `tera_*`-shaped field. Schema is `.strict()`; transform throws
  `PikalyticsTeraLeakError` on leak. Defense-in-depth at three layers
  (parser ignores, transform `findTeraKey`, schema reject).
- Format slug hard-coded to `gen9championsvgc2026regma`.
- Reg M-A SPS rules don't apply to Pikalytics inputs (the source publishes
  aggregate frequencies, not specific spreads).

## Cache + throttle

- 1 rps via `_shared/throttle.ts`.
- Disk cache via `_shared/file-cache.ts`, `ttlMs: Number.POSITIVE_INFINITY`.
- Cache key: `<species_slug>` (the `as_of_hint` parameter was removed in
  Stage 6; today's calendar-week skip-existing pre-check makes a per-`as_of`
  cache key dead weight).
- 404s NOT cached.

## Out-of-scope (v1)

- Munchstats / VR cores / any non-Pikalytics meta source — those land in
  separate slices.
- Reg M-B or any non-Reg-M-A format — explicit per flow §2.10.
- True `as_of`-based skip-existing (today's heuristic is calendar-week on
  `fetched_at`); deferred until upstream republish cadence is observed.
- Cross-source merging with labmaus tournament cores — `meta-merger` slice.
- Real fixture-driven `--no-network` integration (today's tests pre-seed a
  preflight placeholder; tracked deferral, see plan §19.3).
