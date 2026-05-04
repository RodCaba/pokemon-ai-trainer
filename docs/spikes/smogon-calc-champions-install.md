# Spike — Installing `@smogon/calc` Champions support

**Date:** 2026-05-04
**Author:** Claude (main agent)
**Trigger:** `pokemon-roster-db` flow §6 Q1 — verify the GitHub-pin install path before Tech Lead writes Stage 3.
**Pinned commit (current master HEAD):** `37b0afaadca7a2c4476cabe27ed44d2e744e3c87` (2026-04-27, "Switch buttons back to em").
**Spike workspace (preserved):** `/tmp/calc-spike/repo` (fully built, has working `dist/`).

---

## TL;DR

- ✅ **Champions calc works end-to-end.** `Generations.get(0)` returns the Champions gen (286 species incl. 60 Mega forms). The existing `calculate(...)` entry point auto-routes by `gen.num` — there's **no separate `calculateChampions` export** to import. A real Champions calc (32+ Atk Adamant Garchomp Earthquake vs. 0 HP / 0 Def Tyranitar) returns sensible numbers (174–206 dmg, 99.4–117.7%, 93.8% chance to OHKO) with description identical in shape to SV gen output.
- ✅ **Champions data IS measurably different from SV** in the patch overlay. Confirmed:
  - **Freeze-Dry** loses its `secondaries: true` flag in Champions.
  - **Mega evolutions** are first-class species in Champions (60 Mega forms; e.g. `Garchomp-Mega` BST 700).
  - Most base species share SV stats — Garchomp's `base_stats` are byte-identical between Champions and SV. The patch is a small overlay, not a wholesale rewrite.
- ❌ **Direct `pnpm add 'github:smogon/damage-calc#<sha>&path:/calc'` install FAILS.** Two compounding reasons:
  1. The repo's root `package.json` has no `name`, so plain `github:smogon/damage-calc#<sha>` errors with `ERR_PNPM_MISSING_PACKAGE_NAME`. Need the `&path:/calc` suffix.
  2. With `&path:/calc`, pnpm fetches the `calc/` subdirectory tarball and runs the package's `prepare` script, which is `npm run compile && npm run bundle`. **`bundle` requires `@babel/core`**, which lives only in the workspace root (`/babel/core` is a devDep of the root, not of `calc/`). Tarball doesn't include it → bundle fails → install fails.
- ✅ **`compile` alone works.** `npm install` of `calc/`'s own deps (`@types/node@^18.14.2` only at runtime; jest/eslint/typescript at devDeps) and then `npm run compile` (= `tsc -p .`) emits a complete `dist/` with `dist/mechanics/champions.js` present and importable.
- ❌ **No clean pnpm-side override** for the failing `prepare` script:
  - `pnpm.packageExtensions` adds dependencies/peerDependencies but does **not** override `scripts`.
  - `--ignore-scripts` skips `prepare` entirely → no `dist/` → import fails at runtime.
  - `pnpm patchedDependencies` could in theory rewrite the package.json but is heavyweight for a git dep, and patches don't apply cleanly to fetched tarballs in pnpm 10's experience (untested here, would itself need a spike).

## Recommendation for Stage 3

Two viable production paths. I recommend **A** for speed and reproducibility.

### A — Fork upstream, patch `prepare`, install from fork *(recommended)*

1. Fork `smogon/damage-calc` to a workspace account (e.g. `rodser4/damage-calc`).
2. On a long-lived branch `champions-pinned-build`, change `calc/package.json`:
   ```diff
   - "prepare": "npm run build",
   + "prepare": "npm run compile",
   ```
3. Tag the branch with the upstream SHA we're tracking.
4. Pin in our `package.json`:
   ```jsonc
   "dependencies": {
     "@smogon/calc": "git+https://github.com/<user>/damage-calc.git#<our-tag>&path:/calc"
   }
   ```
5. `pnpm-workspace.yaml` allowlists it:
   ```yaml
   onlyBuiltDependencies:
     - "@smogon/calc"
   ```
6. **Refresh workflow:** when upstream master moves and we want the new data, rebase our patch branch on the new SHA, retag, bump our pin. Single-line diff, takes ~2 min per refresh.
7. **Contract test** (already in flow doc §2.6) watches for an npm release containing Champions and notifies us to switch back.

**Pros:** zero vendoring; install is just `pnpm install`; collaborators see exactly what we see; one-line patch.
**Cons:** maintains a fork; refresh requires the rebase ritual; if the fork owner's account vanishes the install breaks.

### B — Vendor pre-built `dist/` in our repo

1. Build upstream once (we already have a working `dist/` at `/tmp/calc-spike/repo/calc/dist`).
2. Copy `dist/`, `package.json`, `LICENSE`, `README.md` into `vendor/smogon-calc-champions/`.
3. In our `package.json`:
   ```jsonc
   "dependencies": {
     "@smogon/calc": "file:./vendor/smogon-calc-champions"
   }
   ```
4. Refresh = `git clone smogon/damage-calc → npm install → npm run compile → cp dist/ ...`. Document as a script.

**Pros:** zero external dep on a fork; install is hermetic.
**Cons:** vendored binaries in git; refresh is a manual ritual; harder to diff "what changed upstream" at a glance.

### C — Wait for upstream npm release

No timeline. Master diverges further from `0.11.0` daily. Not viable for an active milestone.

## Other findings worth pinning

1. **Champions roster size (286) vs Bulbapedia (229)** — gap is **60 Mega forms**. Bulbapedia's "Regular Roster M-A" lists base species only; Megas aren't separately enumerated there. Our reconciliation step (`pokemon-roster-db` flow §2.7) needs a special case: Mega forms are legal iff their base form is in the Bulbapedia roster.

2. **`Mega` is not exposed as a standalone ability** in either Champions or SV abilities tables — `champ.abilities.get('mega')` returns null. The agent's earlier investigation note about "new abilities (Mega, Piercing Drill, Dragonize)" needs requalifying. Mega evolutions in Champions appear to be modeled as separate species with their post-Mega stats baked in (Garchomp-Mega BST 700), not as a runtime ability transformation. Worth a follow-up to confirm Piercing Drill and Dragonize specifically.

3. **`damage_calc` migration** (flow §6 Q2) — once we upgrade, switching `damage_calc`'s engine call from `Generations.get(9)` to `Generations.get(0)` is a one-line change. Most existing 56 tests will keep passing because Garchomp/Tyranitar Champions stats happen to equal SV stats. Tests that touch a Champions-patched move (Freeze-Dry secondaries) or a Mega form will need adjustment.

4. **`damage_calc` constructor signature change in newer @smogon/calc.** In v0.10.0 we call `new Pokemon(9, 'Urshifu', {...})` (gen as a number). In master, the signature is `new Pokemon(gen, 'Garchomp', {...})` where `gen` is the `Generation` object from `Generations.get(0)`. This is a **breaking API change** between 0.10.0 and master — our `mapping.ts` will need a small update (pass the `Generation` object, not the number). Easy to fix; flagging here so it doesn't surprise Stage 3.

5. **Champions PvP level** (flow §6 Q9) — not directly verified in spike; the calc accepted `level: 50` without complaint, which matches our `CalcInput.level: literal(50)` assumption.

## What to update in the flow doc

- §2.6 dep strategy: replace "pin via `github:smogon/damage-calc#<sha>`" with "pin via `git+https://github.com/<fork>/damage-calc.git#<tag>&path:/calc`, fork patches `prepare` to compile-only".
- §2.6 add the `pnpm-workspace.yaml` allowlist requirement.
- §2.7 reconciliation: add Mega-form special case (Bulbapedia lists base; Champions data has separate Mega entries; both are legal).
- §6 close Q1 ✅, Q9 (likely ✅), Q7 partially ✅ (we now know the install path works *with* the fork patch).
- New mention of the 0.10.0 → master `Pokemon` constructor signature change in §2 or as a §6 risk.

## Spike-2 addendum (same day): forked-and-patched install validated

Simulated the real fork by cloning upstream locally, applying the one-line `prepare` patch, committing on a `champions-pinned-build` branch, pushing to a bare git repo, and installing into a fresh project via `git+file:///...&path:/calc`.

Result: **install succeeds, smoke test passes.** The exact same Champions calc (Garchomp Earthquake vs. Tyranitar) returns 174–206 dmg / 99.4–117.7% / 93.8% OHKO — identical to the standalone build. `dist/mechanics/champions.js` is present in the installed package. pnpm's behavior for `git+file://` and `git+https://` is equivalent for these mechanics, so the real-fork case behaves the same.

The single-line patch:
```diff
- "prepare": "npm run build",
+ "prepare": "npm run compile",
```
applied in `calc/package.json` of the forked branch.

Required at the consumer side:
```yaml
# pnpm-workspace.yaml
onlyBuiltDependencies:
  - "@smogon/calc"
```
and the dependency line:
```jsonc
"@smogon/calc": "git+https://github.com/<fork>/damage-calc.git#<patched-sha>&path:/calc"
```

Recommendation A in §Recommendation is fully de-risked — proceed.

## Cleanup

- `/tmp/calc-spike/repo` retained as evidence; tear down with `rm -rf /tmp/calc-spike /tmp/calc-fork-spike /tmp/pnpm-fork-spike` after Stage 3 plan lands.
- No changes made to the project's `package.json`, `node_modules/`, or `pnpm-lock.yaml`.
