# Pikalytics fixtures

Captured 2026-05-07 from the AI-markdown endpoint
`https://www.pikalytics.com/ai/pokedex/gen9championsvgc2026regma/<species>`.

## Real (live capture)

- `2026-05-07__garchomp.md` — high-usage species, full sections, hyphenated teammates
  including `Charizard-Mega-Y` and `Floette-Mega`. Used as the canonical happy-path
  fixture.
- `2026-05-07__sneasler.md` — high-usage, different teammate/item distribution; covers
  hyphenated teammate names.
- `2026-05-07__kingambit.md` — different ability/move distribution; co-occurs with
  Garchomp + Sneasler.

Capture command (one-shot, executed at fixture creation time):
```
curl -sS \
  -H 'User-Agent: pokemon-ai-trainer-fixture-capture/0.1 (https://github.com/RodCaba)' \
  'https://www.pikalytics.com/ai/pokedex/gen9championsvgc2026regma/<species>' \
  > 2026-05-07__<species>.md
```

## Synthetic (hand-authored)

- `2026-05-07__synthetic-empty-sections.md` — has the required `Data Date` line but
  all four `Common-*` sections are absent. Verifies the parser is permissive on optional
  sections (returns empty arrays + raw_warnings).
- `2026-05-07__synthetic-tera-leak.md` — deliberately injects Tera-shaped headers
  (`> Tera Type: Fire`, `## Common Tera Types`). The parser must IGNORE these and the
  transform's `/tera/i` property check must NOT see them surface in the parsed
  structure. If the parser regresses and forwards them, the transform throws
  `PikalyticsTeraLeakError`.

## Format notes (verified 2026-05-07)

The live AI-markdown endpoint emits:

- A `## Quick Info` table whose `**Data Date**` row carries an `YYYY-MM` value (e.g.
  `2026-04`). The parser maps this to ISO date `YYYY-MM-01` for storage in `as_of`.
- Per-section bullets of the form `- **<name>**: <percent>%` under headers
  `## Common Moves`, `## Common Abilities`, `## Common Items`, `## Common Teammates`.
- No top-level `## Usage` section / overall species usage percentage. The schema's
  `usage_percent` field is therefore nullable in v1; the parser returns `null` when the
  section is absent (deviation from plan §10's `usage_percent` requirement, captured in
  the Stage 4 commit body).
- A FAQ section that mentions Tera Type only to say "not available or not applicable
  for this format" — no actual Tera data leaks through, but the synthetic-tera-leak
  fixture exercises the defensive parser regardless.
