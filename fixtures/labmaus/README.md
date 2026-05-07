# Labmaus Fixtures

Captured 2026-05-04 from `https://labmaus.net/api/...` with browser-like headers
(`Origin: https://labmaus.net`, `Referer: https://labmaus.net/`) — labmaus's
unauthenticated `/api/` route returns `unauthorized` without an Origin header.
Each file is the raw response body run through `python3 -m json.tool` for
deterministic indentation.

## Files

| File | Endpoint | Purpose |
|---|---|---|
| `2026-05-04__completed_tournaments_regm-a_30d.json` | `/api/completed_tournaments?regulation=Regulation+Set+M-A&date_range=2026-04-06+to+2026-05-04` | Listing fixture — 166 entries spanning the cold-start window. |
| `2026-05-04__tournament_56757.json` | `/api/tournament?tournament=56757&language=en` | Large official-style 42-player event with mixed top-cut placements (22/42 placement-null), mixed countries (7 nulls), Sketch Academy. Plan §11 canonical large fixture. |
| `2026-05-04__tournament_56756.json` | `/api/tournament?tournament=56756&language=en` | Medium 32-player Extreme Speed Champions event for variety. |
| `2026-05-04__tournament_56716.json` | `/api/tournament?tournament=56716&language=en` | **Largest** event in window: Champions Cup 128 players, all-placements-filled (top-cut bracket complete), 19 country-null, exhaustive form-suffix coverage (`038-a`, `059-h`, `071-m`, `080-g`, `128-a`, `128-b`, `157-h`, `479-f`, `479-h`, `479-w`, `503-h`, `571-h`, `706-h`, `724-h`). Stress-tests species-map. |
| `2026-05-04__tournament_56588.json` | `/api/tournament?tournament=56588&language=en` | 77-player CROWN FIGHT event with 51/77 `placement: null` rows — primary swiss-only / placement-null variety fixture. Includes Basculegion ♂ entries. |

## Variety coverage matrix

| Concern | Fixture |
|---|---|
| `country: null` rows | 56757 (7), 56716 (19), 56588 (8) |
| All-`placement: null` rows | 56588 covers the swiss-out tail (51/77 null) |
| `num_phase_2: null` | All four — labmaus consistently emits `null` here in current data; the schema must accept null and we call this out as the "unknown" state. |
| `Basculegion ♂` literal in `team_names` | 56716, 56588 |
| Form-suffix breadth | 56716 (14 distinct suffixed ids) |
| `tera_types` field present (must strip) | All four |

## Deviations from plan §3 raw schema

- **`team_names` is a comma-separated string**, not an array. The plan asserted
  `z.array(z.string()).length(6)`; the live API returns
  `"Charizard,Clefable,Kingambit,Sneasler,Garchomp,Aerodactyl"`. The schema
  written in Stage 4 accepts `z.string()` and the transform splits on `,`.
  Flagged as a Stage-4 plan deviation; reviewer to confirm acceptance.
- The listing record schema in plan §3 lacks `tournament_code` (present in
  detail only) — listing entries lack it, so the schema as drafted is correct.

## Re-capture procedure

```bash
HDRS=(-H 'User-Agent: Mozilla/5.0' -H 'Origin: https://labmaus.net' -H 'Referer: https://labmaus.net/')
curl -sS "${HDRS[@]}" "https://labmaus.net/api/completed_tournaments?regulation=Regulation+Set+M-A&date_range=YYYY-MM-DD+to+YYYY-MM-DD" | python3 -m json.tool > <date>__completed_tournaments_regm-a_30d.json
curl -sS "${HDRS[@]}" "https://labmaus.net/api/tournament?tournament=<id>&language=en"            | python3 -m json.tool > <date>__tournament_<id>.json
```
