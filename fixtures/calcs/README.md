# Golden Calc Fixtures — Cross-check Log

Per `CLAUDE.md` §4 and `docs/plans/damage-calc-tool.md` §8.

Each fixture in this directory is a JSON file with a full `CalcInput` and an `expected` block whose `rolls`, `min_percent`, `max_percent`, `ko_chance`, and `description` were **hand-verified against the public Showdown calculator UI** at <https://calc.pokemonshowdown.com/>.

## Verification protocol

For each fixture:

1. Open <https://calc.pokemonshowdown.com/> in a browser.
2. Set **Generation** to "Gen 9" (Reg M-A is Gen 9).
3. Configure the attacker and defender per the `input` block. **Set all IVs to 31** (the team-builder default in Showdown — required because Reg M-A doesn't expose IVs and our mapping layer always passes 31s).
4. Set EVs to match `input.attacker.evs` / `input.defender.evs` exactly.
5. Set field/side conditions per `input.field`.
6. Pick the attacker's move; confirm Showdown's output line matches what we'll store in `expected.description`.
7. Copy the rolls (16 integers), the percent range, the KO chance text + numeric chance, into the fixture's `expected` block.
8. Update the fixture: set `verified_at` (today's date, ISO YYYY-MM-DD) and `verified_by` (your initials).
9. Update `showdown_calc_url` with a sharable URL if Showdown produces one (otherwise leave `null` — the cross-check log row below documents the scenario in prose).
10. Update the corresponding row in the table below.

A fixture without a row in this table is a CI failure (see `golden.test.ts`).

## Cross-check table

| ID | Scenario | Attacker EV total | Defender EV total | Showdown URL | Verified at | Verified by |
|---|---|---|---|---|---|---|
| 001-stab-physical-baseline | Plain STAB physical, no item, no field. Urshifu Close Combat vs. Flutter Mane. | 32 | 0 | _pending_ | _pending_ | _pending_ |
| 006-type-immunity-ghost | Type immunity (Normal vs Ghost). Urshifu Quick Attack vs. Flutter Mane → 0 dmg. | 32 | 0 | _pending_ | _pending_ | _pending_ |
| 008-critical-hit | Crit modifier. CB Urshifu Wicked Blow (always crits) vs. Flutter Mane. | 32 | 0 | _pending_ | _pending_ | _pending_ |
| 009-multi-hit-surging-strikes | Multi-hit (3 hits, always crits). Urshifu-Rapid-Strike Surging Strikes vs. Flutter Mane. | 32 | 0 | _pending_ | _pending_ | _pending_ |
| 010-choice-band | Choice Band 1.5x (no crit). CB Urshifu Close Combat vs. Flutter Mane. | 32 | 0 | _pending_ | _pending_ | _pending_ |
| 021-friend-guard | Friend Guard 0.75x (one ally beside defender). CB Urshifu Close Combat vs. Flutter Mane + 1 FG. | 32 | 0 | _pending_ | _pending_ | _pending_ |

_(Remaining 22 fixtures will be added once this batch's authoring workflow is validated.)_
