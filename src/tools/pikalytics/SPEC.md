# pikalytics tool — SPEC

TODO(stage5): full SPEC per CLAUDE.md §8 + plan §4.4. This Stage-4 placeholder
captures the tool surface; bodies land in Stage 5.

## Tools registered

- `pikalytics_fetch_species` — fetch + parse one species snapshot from the
  `/ai/pokedex/<format>/<species>` AI-markdown endpoint.
- `pikalytics_teammates` — top-N teammates for a species (ranked by % desc).
- `pikalytics_usage` — rank items / abilities / moves / teammates / overall
  species by Pikalytics usage %.

## Endpoint

`GET https://www.pikalytics.com/ai/pokedex/gen9championsvgc2026regma/<species_slug>`
→ 200 text/markdown. 404 = not in coverage. Format slug pinned to Reg M-A.

## Parser contract (plan §3 / flow §6 Q5)

- Strict on `as_of` (the `| **Data Date** | YYYY-MM |` row from the Quick Info
  table). Missing → `PikalyticsParseError`.
- Permissive on optional sections (Common Moves / Common Abilities / Common
  Items / Common Teammates). Missing → empty arrays + `raw_warnings`.
- `usage_percent` is nullable in v1 — the live AI-markdown endpoint doesn't
  expose an overall species usage % (verified 2026-05-07; documented in
  fixtures/pikalytics/README.md).

## Reg M-A hygiene

- Strip every `tera_*`-shaped field. Schema is `.strict()`; transform throws
  `PikalyticsTeraLeakError` on leak.
- Format slug hard-coded to `gen9championsvgc2026regma`.

## Cache + throttle

- 1 rps via `_shared/throttle.ts`.
- Disk cache via `_shared/file-cache.ts`, `ttlMs: Number.POSITIVE_INFINITY`.
- 404s NOT cached.
