# pokepaste fixtures

Captured 2026-05-04 for the `pokepaste-sets` slice (`docs/plans/pokepaste-sets.md` §11).
Files are immutable; filenames carry the capture date.

## Real fixtures (curl from live `pokepast.es`)

### `2026-05-04__7205bf28f85d1e79.txt`
- Source: `https://pokepast.es/7205bf28f85d1e79/raw`
- Purpose: representative real Reg M-A team. Six mons with `Tera Type: None`
  on every entry. No `EVs:` / `IVs:` / `<Nature> Nature` lines anywhere —
  expected `completeness === "minimal"` for every set.
- Reg-M-A hygiene: every Pokemon has a `Tera Type: None` line that the
  transform must strip.

### `2026-05-04__a5f32930d39e424e.txt`
- Source: `https://pokepast.es/a5f32930d39e424e/raw`
- Purpose: second real team. Includes Mega-evolved species names as the paste
  authored them (`Mega Floette @ Floettite`, `Delphox @ Delphoxite`) — the
  transform's species-mapping layer should normalize these to the
  base-species roster id (Mega evolution is implied by the held stone, not by
  the species name).
- Tera lines: all `Tera Type: None`.

## Synthetic fixtures (hand-authored, verified parsable by `Teams.importTeam`)

### `2026-05-04__synthetic-full-spread.txt`
- Purpose: every Pokemon carries `EVs:`, `IVs:`, and a `<Nature> Nature` line.
  Drives the `completeness === "full"` branch.
- SPS values target Reg M-A caps (≤ 32 per stat, ≤ 66 total) using the
  Champions SPS interpretation of EV-syntax inputs.
- Tera: all `Tera Type: None` — must strip.

### `2026-05-04__synthetic-partial.txt`
- Purpose: mixed completeness — some Pokemon carry only `EVs:`, some only a
  `<Nature> Nature` line, some neither. Drives `completeness === "partial"`
  on the entries that carry one of the two, and `"minimal"` on the rest.
- IVs absent everywhere (the calc layer fills 31s per Reg M-A stat rules).

### `2026-05-04__synthetic-edge-cases.txt`
- Purpose: parser edge-case coverage required by plan §11 — covers paths that
  the transform must HANDLE (not reject). Empty-moves rejection lives in its
  own fixture (see below) so T15's success path and T17's reject path don't
  collide on the same file.
  - **Mega Stone item:** `Charizardite Y` (slot 0).
  - **Regional form:** `Ninetales-Alola` (slot 1).
  - **Gender symbol:** `Basculegion ♂` (slot 2).
  - **Missing `Ability:` line:** `Sneasler` (slot 3) — minimal completeness
    in this slice does NOT require ability (matches real-world labmaus pastes
    that omit it; flagged for plan §2.5 reconciliation in Stage 6).
  - **Missing Tera line entirely:** `Aerodactyl` (slot 4) — strip's "field
    absent" branch.

### `2026-05-04__synthetic-empty-moves.txt`
- Purpose: focused fixture for T17 (`transform rejects empty-moves set`).
  Single Kingambit entry with zero `- <move>` lines, drops below `minimal`,
  must throw `PokepasteParseError`. Split out from the original kitchen-sink
  edge-cases fixture during Stage 5 to remove the T15/T17 collision.

## Tera lines summary (for T7 — `transform strips Tera Type unconditionally`)

| Fixture | Tera lines present |
|---|---|
| `2026-05-04__7205bf28f85d1e79.txt` | 6 × `Tera Type: None` |
| `2026-05-04__a5f32930d39e424e.txt` | 6 × `Tera Type: None` |
| `2026-05-04__synthetic-full-spread.txt` | 6 × `Tera Type: None` |
| `2026-05-04__synthetic-partial.txt` | 6 × `Tera Type: None` |
| `2026-05-04__synthetic-edge-cases.txt` | 4 × `Tera Type: None`, 1 × absent |
| `2026-05-04__synthetic-empty-moves.txt` | 1 × `Tera Type: None` |
