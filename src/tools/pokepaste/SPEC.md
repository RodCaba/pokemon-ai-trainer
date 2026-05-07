# Pokepaste Tool Spec

**Status:** Stage 5 shipped. Stage 6 reviewed.

One agent-callable tool wraps `pokepast.es`'s public `/raw` endpoint; three
sibling repo tools (`sets.list` / `sets.get` / `sets.usage`) expose the
parsed `team_sets` rows.

## Tools

- `pokepaste_fetch_paste` — fetch + parse one Showdown export by paste id.
  Inputs: `PokepastePasteArgs` (zod) — `{ paste_id: hex(12..32) }`.
  Outputs: `PasteFetchResult` — `{ paste_id, raw_text, sets: TeamSet[1..6], warnings, fetched_at }`.
- `sets_list` — list parsed sets matching a filter
  (`tournament_team_id` / `species_roster_id` / `tournament_id`; at least one required).
- `sets_get` — exact lookup by composite key `(tournament_team_id, slot)`.
- `sets_usage` — rank items / abilities / moves / natures for a species across a date window.

## Inputs (zod schemas)

- `PokepastePasteArgsSchema` — `paste_id` only. `tournament_team_id` is a
  *dep*, not an arg, so the agent-facing JSON Schema stays minimal (per
  plan §17 Q2). Persistence is the ingest hook's responsibility.
- `SetsListFilterSchema` — at least one of `tournament_id`,
  `tournament_team_id`, `species_roster_id`. Empty filter rejected via
  `.refine`.
- `SetsUsageArgsSchema` — `species` (canonical roster id), `format`
  (`"RegM-A"`), `lookback_days` (positive int), `dimension`
  (`"item" | "ability" | "move" | "nature"`).

## Outputs (zod schemas)

- `PasteFetchResultSchema` — strict; `sets.length ∈ [1, 6]`. Every entry
  conforms to `TeamSetSchema` (no `tera_*` field; SPS caps enforced).
- `TeamSetSchema` — composite-key entity with `id =
  "${tournament_team_id}:${slot}"`. `sps` / `ivs` / `nature` nullable;
  `completeness ∈ {"minimal","partial","full"}` (mapping in CompletenessSchema TSDoc).
- `SetsUsageRowSchema` — `{ dimension, key, display_label, appearances,
  total_sets, usage_percent, citations }`. `citations` is a list of
  `tournament_team_id` strings, capped at 50 (sorted by placement ASC,
  completeness DESC per plan §17 Q3).

## Edge cases

- Pastes with <6 mons — accepted (`sets.length` may be 1..6).
- `Tera Type:` line present (any value, including `None`) — stripped at
  the parser boundary; defense-in-depth via `.strict()` on `TeamSetSchema`.
- `♂ / ♀` symbols on species names — stripped before roster lookup
  (Basculegion-M / -F still resolve via roster aliases).
- Mega forms — `normalizeSpeciesName` rewrites `"Mega Charizard Y"` →
  `"Charizard-Mega-Y"` before roster lookup. Champions treats Mega forms
  as first-class species (61 `-Mega` entries in the roster), not implied
  by the held stone. Word-boundary safe (`"Megalopolis"` passes through).
- Missing ability line / 0 moves — drops below `minimal` completeness →
  `PokepasteParseError` (per plan §17 footer).
- Partial IVs (e.g., `IVs: 0 Atk` only) — entire `ivs` field returned as
  `null` rather than inventing 31s for the unspecified stats. The Reg M-A
  calc layer fills 31s downstream regardless.
- Partial SPS (e.g., `EVs: 32 HP` only) — unspecified stats default to
  `0` (the Showdown convention; the SPS line being *present* is the
  author's affirmation that omitted stats are zero).
- Rate of partial vs full pastes: in the wild, "minimal" (no SPS / IV /
  nature) dominates — pokepaste authors often share team previews
  without spreads.

## Cache + throttle

- Disk cache under `data/cache/pokepaste/<paste_id>.txt` (path overridable
  via `POKEPASTE_CACHE_DIR` env var). The shared `_shared/file-cache`
  primitive is used with `ttlMs: Number.POSITIVE_INFINITY`. Pokepaste
  URLs are content-addressed (the paste id is a hex hash of the body) →
  200 responses are immutable, never expire. Eviction is manual `rm`.
- 404 responses are NOT cached (so a re-uploaded paste eventually starts
  working without manual cache nuke).
- Token-bucket throttle at **2 rps** (distinct from labmaus's 1 rps;
  separate bucket instance, no shared state). Implemented via the shared
  `_shared/throttle.ts` `createTokenBucket`.
- Retry on `429` / `5xx` with exponential backoff
  (`backoffBaseMs * 2^attempt`, ±20% jitter), max 3 attempts. `4xx`
  other than 429 maps directly: 404 → `PokepasteNotFoundError` (no
  retry); other 4xx → `PokepasteNetworkError`.

## Error matrix

| Class | When |
|---|---|
| `PokepasteInputError` | Tool-arg zod failure (malformed paste id) |
| `PokepasteNetworkError` | HTTP retry exhaustion / non-404 5xx / DNS / timeout |
| `PokepasteNotFoundError` | HTTP 404 (paste deleted or never existed) |
| `PokepasteParseError` | `@pkmn/sets` returns no team / completeness < `minimal` / final schema validation fails (e.g. SPS cap violation) |
| `PokepasteRefValidationError` | Unknown item / ability / move (carries `kind`, `value`, `paste_id`, `slot`) |
| `PokepasteUnknownSpeciesError` | Species not in the Champions roster after `normalizeSpeciesName` + alias lookup |

## Citation rules

Every persisted record carries:
- `source.site = "pokepaste"`,
- `source.paste_id` (the hex hash),
- `source.source_url = "https://pokepast.es/${paste_id}"`,
- `source.fetched_at` (ISO-8601 UTC).

Recommendations grounded in `team_sets` data must include the
`tournament_team_id` and the `source_url` so the user can re-derive the
claim from the original paste.

## Reg M-A hygiene

- **Tera strip mandatory.** The transform deletes `teraType` from every
  parsed `PokemonSet` before constructing the domain entity; the domain
  schema has no `tera_*` field at all and is `.strict()`. Any
  defense-in-depth slip is rejected at validation time.
- **SPS naming, not EVs.** The transform renames `evs → sps` at the
  `@pkmn/sets` boundary. Domain code, schemas, and test fixtures all
  use `sps`.
- **SPS caps.** `SpsSchema` enforces total ≤ 66 and per-stat ≤ 32 via
  `.refine` and `.max(32)`. A paste with Showdown-legal but
  Champions-illegal EV totals (e.g. 510) parses through `@pkmn/sets`
  but is rejected at final schema validation → `PokepasteParseError`.
- **No IVs in calc inputs.** The persisted `ivs` field is provenance
  only; the calc layer always fills 31s downstream.

## Reject-and-fail validation contract (load-bearing)

Per plan §8.1 — the transform's behavior on unknown items / abilities /
moves is **non-negotiable**:

1. The transform validates every parsed item / ability / move against
   the Champions ref tables (`itemsRepo.has`, `abilitiesRepo.has`,
   `movesRepo.has`).
2. On the **first** unknown value, the transform throws
   `PokepasteRefValidationError` carrying `{ kind, value, paste_id, slot }`.
3. The transform **MUST NOT** swallow the error and produce partial
   output. It returns either a complete `PasteFetchResult` or it throws.
4. The labmaus ingest's per-team `try/catch` (`pokepaste-hook.ts`) is
   the only place this error is caught. The catch records the offending
   value into the run summary's `ref_validation_failures[]`, skips
   persistence of that team's `team_sets` rows, and continues to the
   next team.
5. Resolution path: refresh the Champions ref tables
   (`pnpm data:build:reg-m-a`), then re-run the labmaus ingest. The
   pokepaste cache means previously-successful teams cost zero network.

The same per-team catch-and-continue contract applies to
`PokepasteUnknownSpeciesError` (real labmaus tournaments contain
format-illegal teams accepted by unofficial organizers — recurring
unknowns indicate a real roster gap; one-off unknowns are normal).

## Out of scope

- Paste *authoring* (we read, never write).
- Set diffing (`set A vs set B`) — separate slice.
- Player-attributed retrieval (no player-id field in pokepaste).
- Image scraping / sprite resolution.
- Cross-source dedup (e.g., the same team uploaded twice with different
  paste ids) — pokepaste-sets persists both verbatim; the dedupe is the
  meta-merger slice's problem.
