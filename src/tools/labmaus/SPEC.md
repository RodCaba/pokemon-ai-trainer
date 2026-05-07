# Labmaus Tool Spec

**Status:** Stage 4 stub — body lands in Stage 5.

Two agent-callable tools wrap labmaus.net's public `/api/` endpoints.

## Tools

- `labmaus_list_tournaments` — list completed Reg M-A tournaments in a date range.
  Inputs: `LabmausListArgs` (zod). Outputs: `TournamentSummary[]`.
- `labmaus_get_tournament` — fetch full payload for one tournament.
  Inputs: `LabmausGetArgs`. Outputs: `TournamentDetail` (Tera fields stripped,
  species mapped to canonical roster ids).

## Edge cases

- Empty date windows → empty array, no error.
- Swiss-only events → all `placement: null`, preserved verbatim.
- Single-phase events → `num_phase_2: null`, preserved.
- `country: null` for some players — preserved.
- `tournament_code: null` on some events — preserved.
- `team_names` is a comma-separated string in the live API (not an array as plan
  §3 originally specified) — accepted as `z.string()`, transform splits.
- `Basculegion ♂` literal is the *display name* for labmaus dex id `902`, not
  the dex id itself; the species-map maps `902 → basculegionm`.

## Cache + throttle (Stage 5)

- Disk cache under `data/cache/labmaus/<sha1-of-key>.json`, TTL 24h.
- Token bucket throttle, 1 rps.
- Retry on 429/5xx with exponential backoff (`backoffBaseMs * 2^attempt`, ±20% jitter), max 3 attempts.

## Error matrix

| Class | When |
|---|---|
| `LabmausInputError` | Tool-arg zod failure |
| `LabmausNetworkError` | HTTP retry exhaustion / network failure |
| `LabmausSchemaError` | Raw response failed `LabmausRawTournamentSchema` |
| `LabmausUnknownSpeciesError` | Species id has no roster mapping |

## Citation rules

Every persisted record carries `source_url = https://labmaus.net/tournaments/<id>`
and `fetched_at` (ISO-8601 UTC).

## Reg M-A hygiene

`tera_*` keys are stripped in two layers: (1) raw schema `.transform`, (2) strict
domain schemas with no Tera field. A property test scans all persisted rows for
any column matching `/tera/i`.

## Out of scope

- Pokepaste fetching (`team_url` is opaque; separate `pokepaste-sets` slice).
- Cross-source dedup (separate "meta merger" slice).
- Junior/Senior divisions in v1 (Masters only).
