# Flow — `damage_calc` tool

**Slug:** `damage-calc-tool`
**Stage:** 1 (Flow documentation)
**Status:** Approved (Stage 2 complete) — ready for Stage 3 (tech plan)
**Author:** Claude (main agent)
**Date:** 2026-04-28

This is the first tool in the M0 milestone. It wraps `@smogon/calc` and is the load-bearing numerical primitive for every downstream feature (team analyzer, lead planner, replay review). Per `CLAUDE.md` §4, exact numerical correctness is non-negotiable.

> **Pokemon Champions Reg M-A format rules encoded here:**
> - **No Terastallization** — no Tera type, no Tera state, no Tera fields anywhere in input/output.
> - **No IVs** — the mapping layer always sets all six IVs to 31 when calling `@smogon/calc`. `CalcInput` does not expose an IV field.
> - **EV pool = 66 total points** across all six stats. **Per-stat cap = 32.** **Step size = 1** (1 EV = 1 stat point at L50 in Champions). Inputs are rejected if the EV total exceeds 66, any single stat exceeds 32, or any EV is negative/non-integer.

---

## 1. User flow

The `damage_calc` tool is **agent-facing**, not directly user-facing. The end-user experiences it indirectly through three product surfaces. The user flow describes how a player perceives the result of a calc.

### 1.1 Surface A — Team Lab "weakness audit" (primary v1 surface)
1. Player opens the Team Lab and loads a 6-mon team (each set has only EVs, no IVs, total ≤ 66).
2. Player clicks **"Audit weaknesses"**.
3. The agent fans out: for each opposing top-meta threat, it calls `damage_calc` for the relevant attacker→defender→move combinations.
4. The UI renders a table: `Threat → My Mon → Move → Damage % range → KO chance → Notes`.
5. Each row is clickable → opens a "Calc detail" panel showing the exact field state (weather, terrain, screens, item, ability, boosts) and the 16-roll array.
6. Each row is **cited**: `Source: @smogon/calc vX.Y.Z`.

### 1.2 Surface B — Lead planner (consumes calcs internally)
- The `LeadPlan` builder must include `key_calcs` (CLAUDE.md §7). The user sees those calcs inline with the rationale ("`252 SpA Calyrex-S Astral Barrage vs. 4 HP / 0 SpD Urshifu-R: 88.0–104.1% — 25% chance to OHKO`"). EV figures referenced in rationale must respect the 66-point pool.

### 1.3 Surface C — Replay review (post-game)
- After replay parse, the agent calls `damage_calc` to evaluate "what if you'd clicked X instead?" lines. Same citation discipline.

### Acceptance (user-perceived)
- Damage ranges shown in the UI must match the public Showdown calculator UI to the percent (with Showdown's IVs set to 31 — the team-builder default — to match our internal assumption).
- Every calc is reproducible: clicking "Reproduce in Showdown" opens the equivalent calc URL, with IVs at 31 and EVs from our set.
- No calc is shown without the field state that produced it.

---

## 2. Tech flow

### 2.1 Tool contract (high level)

```
damage_calc(input: CalcInput) -> CalcResult
```

- **Pure function.** No I/O. No network. No globals.
- Synchronous (the underlying `@smogon/calc` is sync).
- Deterministic: same input → same output, byte-for-byte.

### 2.2 `CalcInput` (sketch — final shape lands in Stage 3 tech plan)

- `gen`: literal `9` (Reg M-A is Gen 9).
- `format`: literal `"RegM-A"` (used for legality checks in this layer).
- `attacker`: `{ species, level, item, ability, nature, evs, moves, statBoosts, status, hpPercent }`.
  - `evs`: object `{ hp, atk, def, spa, spd, spe }`, each a non-negative integer in `[0, 32]` (step size 1), with **sum ≤ 66**.
  - **No `ivs` field.** Mapping layer always uses 31s.
  - **No `teraType` / `teraActive` field.**
- `defender`: same shape as attacker.
- `move`: `{ name, isCrit?: boolean, hits?: number }` — name is the canonical Showdown move name.
- `field`: `{ weather?, terrain?, isGravity?, isMagicRoom?, isWonderRoom?, attackerSide: SideConditions, defenderSide: SideConditions }` where `SideConditions` covers screens, Tailwind, Friend Guard count, etc.

All fields **explicit**. No silent defaults. Missing optional fields default to `null` in the schema; the wrapper sets the `@smogon/calc` equivalent explicitly.

### 2.3 `CalcResult` (sketch)

- `rolls: number[16]` — exact integer damage rolls. Never averaged, never rounded.
- `min_percent: number`, `max_percent: number` — to one decimal, computed at the boundary.
- `ko_chance: { description: string, chance: number }` — from `@smogon/calc`'s KO calculator.
- `description: string` — the human-readable line (e.g., `252 Atk Choice Band Urshifu-S Wicked Blow vs. 4 HP / 0 Def Flutter Mane on a critical hit: 312-368 (118.6 - 139.9%) -- guaranteed OHKO`).
- `field_echo: Field` — the exact field state used (so the UI can render it without re-deriving).
- `source: { tool: "@smogon/calc", version: string, computed_at: string }`.
- `schema_version: 1`.

### 2.4 Sequence (single calc)

```
caller (agent or UI server route)
  └─► damage_calc(input)
       ├─ zod.parse(input)               // reject malformed input loudly
       │                                  //   - rejects ivs, teraType, EV total > 66
       ├─ map → @smogon/calc primitives  // Pokemon (with IVs=31), Move, Field
       ├─ new calculate(...)             // sync
       ├─ extract rolls, koChance, desc
       ├─ assemble CalcResult
       └─ zod.parse(output)              // self-check before return
```

No try/catch swallowing. Validation errors throw `CalcInputError`; calc engine errors throw `CalcEngineError`. Both carry the offending input for debugging.

### 2.5 Where it sits in the repo

```
src/
  schemas/
    calc.ts            # zod schemas for CalcInput, CalcResult, Field, Side
    evs.ts             # Reg M-A EV validator (≤66 total, ≤32 per stat, integer step 1)
  tools/
    damage-calc/
      SPEC.md          # contract doc
      index.ts         # damage_calc(input)
      mapping.ts       # CalcInput → @smogon/calc primitives (fills IVs=31)
      describe.ts      # canonical description string
fixtures/
  calcs/
    README.md          # checklist of cross-checks vs Showdown UI (IVs=31 in Showdown)
    *.json             # golden fixtures (one file per scenario)
tests/
  tools/damage-calc/
    schema.test.ts     # zod round-trip + Tera/IV/EV-cap rejection
    mapping.test.ts    # CalcInput → engine primitives (IVs always 31)
    golden.test.ts     # fixture-driven exact-equality calcs
    determinism.test.ts# same input → same output
    errors.test.ts     # malformed input throws CalcInputError
```

### 2.6 Test strategy (Stage 4 will write these as red first)

- **Schema tests:**
  - Every required field rejected when missing; enums reject unknown values.
  - **Reject any payload containing `ivs`** → `CalcInputError("IVs not configurable in Reg M-A")`.
  - **Reject any payload containing `teraType` or `teraActive`** → `CalcInputError("Tera not legal in Reg M-A")`.
  - **Reject EV total > 66**, per-stat EV > 32, negative EVs, non-integer EVs.
- **Mapping tests:** `@smogon/calc` `Pokemon` is constructed with IVs `{31,31,31,31,31,31}` regardless of input; EVs pass through verbatim.
- **Golden tests:** ≥ 20 fixtures from `fixtures/calcs/`, every set within the 66-EV cap. Each asserts `rolls`, `min_percent`, `max_percent`, `ko_chance.chance` to **exact equality**. Fixtures cover: STAB, no-STAB, crits, multi-hit, weather/terrain bonuses, screens, Choice items, Life Orb, Helping Hand, Friend Guard, weakness/resistance via ability (Levitate, Lightning Rod), and burn/paralysis. **No Tera fixtures. No fixture sets IVs.**
- **Cross-check log:** `fixtures/calcs/README.md` lists each fixture with a Showdown calc URL (IVs=31 across the board) and the date it was verified by hand.
- **Determinism test:** call twice, deep-equal results.
- **Error tests:** unknown move name, illegal EV total (>66), HP percent out of [0,100], presence of `ivs`/`teraType` fields.

### 2.7 Out of scope for this slice

- Speed benchmarks (separate tool, separate flow doc).
- Caching (the function is pure and cheap; caching belongs at the agent-call layer if needed).
- Multi-target / spread move damage reduction nuances beyond what `@smogon/calc` provides natively (will revisit).
- UI rendering. This slice ends at the tool boundary.

---

## 3. Data in / out per step

| Step | Input | Output |
|------|-------|--------|
| Caller invokes | `CalcInput` (TS object matching zod schema) | — |
| zod parse input | `CalcInput` | typed `CalcInput` or `CalcInputError` (Tera/IV/EV-cap violations rejected here) |
| map to engine | `CalcInput` | `{ Pokemon (IVs=31), Pokemon (IVs=31), Move, Field }` |
| engine `calculate` | engine primitives | engine `Result` |
| extract + describe | engine `Result` | `{ rolls, koChance, description }` |
| assemble | extracted | `CalcResult` |
| zod parse output | `CalcResult` | `CalcResult` or `CalcEngineError` |

---

## 4. Error / empty states

- **Unknown species / move / item / ability** → `CalcInputError` with the offending field.
- **Illegal EV spread** (total > 66, single EV > 32, negative, non-integer) → `CalcInputError`.
- **`ivs` field present** → `CalcInputError("IVs are not configurable in Reg M-A")`.
- **Tera field present** → `CalcInputError("Tera is not legal in Reg M-A")`.
- **Move that does no damage** (e.g., status move) → `CalcInputError("non-damaging move")`.
- **Engine returns 0 damage legitimately** (immunity) → valid `CalcResult` with `rolls = [0,…,0]`, `ko_chance.chance = 0`, description noting immunity.
- **Engine throws** → `CalcEngineError` wrapping the original.

No silent fallbacks. No "best effort" results.

---

## 5. Success criteria (this slice)

- [ ] `damage_calc` callable from a CLI script (`pnpm tool:calc <fixture-name>`) returning the structured result.
- [ ] All ≥ 20 golden fixtures pass with exact equality.
- [ ] Cross-check log in `fixtures/calcs/README.md` is complete (link + date per fixture, IVs=31 in Showdown UI).
- [ ] Schema, mapping, determinism, and error tests all green — including the Tera-rejected, IV-rejected, and EV-cap tests.
- [ ] No `any`, no swallowed errors, no implicit defaults.
- [ ] Tool exports a JSON Schema description usable as an Anthropic SDK tool definition (consumed in a later milestone).

---

## 6. Open questions for Stage 2 review

1. **`@smogon/calc` version pin.** Pin exact (`x.y.z`) or caret? I propose **exact** — this is golden-fixture territory; an upstream patch could shift rolls.
  Answer: pin to exact version.
2. **IV handling at the mapping boundary.** Confirm: hard-code IVs to `{31,31,31,31,31,31}` in `mapping.ts`, never read from input. (Stage 3 will verify this against the live `@smogon/calc` API — if the library lets IVs be omitted entirely and defaults to 31, we use that path; otherwise we pass 31s explicitly.)
  Answer: yes, hard-code IVs to 31 in the mapping layer.
3. **Per-stat EV ceiling under Reg M-A.** Standard VGC allows 252 per stat. Pokemon Champions still allows 252 per stat in addition to the 66 total cap, correct? If there's a tighter per-stat cap (e.g., 60 or 64), tell me now so the validator is right on day one.
  Answer: No, the per-stat cap is 66 total across all stats.
4. **EV step size.** Standard rules require EVs in multiples of 4 (since 4 EVs = 1 stat point at L50). Champions keeps that, right? If Champions allows 1-EV granularity, the validator changes.
  Answer: No, Champions have EVs steps in 1s, not 4s. 1 EV = 1 stat point at L50.
5. **Description string source.** Use `@smogon/calc`'s built-in `desc()` (matches Showdown calc UI exactly) or build our own? I propose **use built-in** for v1 — but we'll need to verify it never emits "Tera" text for our inputs.
  Answer: Use @smogon/calc's built-in desc() for v1, but verify it never emits "Tera" text for our inputs.
6. **CLI smoke tool.** Worth shipping `pnpm tool:calc` in this slice, or defer to a later slice? I propose ship it now — it's the user's smoke-test path for M0 acceptance.
  Answer: Yes, ship the CLI smoke tool in this slice.
7. **Fixture count and scenarios.** `CLAUDE.md` §4 says "≥ 20." Comfortable with 20 as the floor, or do you want a specific Reg M-A scenario list called out (e.g., must include Calyrex-S, Miraidon, Urshifu, Incineroar, Amoonguss, Rillaboom — adjusted to whichever restricteds/cores are actually legal in Reg M-A)?
  Answer: 20 is the floor, but we should aim to cover a broad range of scenarios including the ones mentioned. We should cover legal in Reg M-A scenarios, including the restricted Pokemon and common meta threats.
8. **Restricted slot legality.** Reg M-A's allowed restricted Pokemon list — should the calc tool care about it, or is that purely a `team_validate` concern (calc accepts any species, validation lives elsewhere)? I lean toward **calc doesn't care** (it's a math layer), but flag it for confirmation.
  Answer: The calc tool should not enforce restricted slot legality; that should be handled by the team validation layer. The calc tool is purely a math layer and should accept any species for calculation purposes.

---

## 7. Reviewed-by

Rodrigo Caballero
