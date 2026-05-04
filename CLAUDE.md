# CLAUDE.md — Pokemon AI Trainer

**Audience:** every Claude agent (main, subagents, MCP-invoked, background) operating in this repository. These rules are **non-negotiable**. If a request conflicts with them, surface the conflict before acting.

---

## 1. Project at a glance

- **What:** an AI-assisted training companion for **Pokemon Champions, Regulation M-A** (VGC). See `PRD.md` for full product spec.
- **Who uses it:** a single competitive player (Rodrigo) preparing for Reg M-A events.
- **Shape:** TypeScript monorepo. Next.js UI on top of a tool layer that fetches from Pikalytics, Smogon, Munchstats, Labmaus, Victory Road, the Showdown damage calculator, Showdown replays, and YouTube. Anthropic SDK (Claude) drives the agent loop with prompt caching.
- **North star:** every recommendation is **explainable, cited, and reproducible**.

---

## 2. Development flow — mandatory pipeline

Every change — feature, bugfix, or refactor — moves through these **six gated stages**, in order. Skipping a stage is a process violation; surface it to the user before proceeding.

### Stage 1 — Flow documentation (`docs/flows/<slug>.md`)
- Author both the **user flow** (what the player does, screen by screen, decision by decision) and the **tech flow** (which modules/tools/agents fire, in what order, with what data).
- Include: trigger, preconditions, step-by-step interaction, data in/out per step, error/empty states, success criteria.
- Output: a single markdown file under `docs/flows/`. No code yet.

### Stage 2 — Flow review (user-facing)
- The flow doc is reviewed for product correctness: does it match the PRD, does it match the user's mental model, are edge cases enumerated?
- Reviewer is the user (or a delegated reviewer agent acting as product owner).
- Exit: explicit approval recorded in the doc (`Reviewed-by: …` line).

### Stage 3 — Tech plan (`docs/plans/<slug>.md`), authored by a Tech Lead agent
- Spawn a **Tech Lead subagent** (`Plan` agent type, or `general-purpose` with a tech-lead brief) whose only job is to produce the implementation plan from the approved flow.
- Plan must cover: module boundaries, data schemas (zod), tool contracts, agent prompts touched, error model, test strategy (which unit/contract/golden/integration tests will exist), rollout/feature-flag, and the **architecture patterns** chosen with the *why* (e.g., repository pattern for storage, ports-and-adapters for tool layer, command/query split for agent calls).
- Plan must call out reuse opportunities — do not invent a new abstraction if an existing one fits.
- Exit: user approves the plan. Plan file is committed before any test code.

### Stage 4 — Red tests
- Write the failing tests described in the tech plan, in the order the plan lists them. Run them. Confirm each fails *for the right reason* (see §3).
- Commit the failing tests on a `feat/<slug>` branch. CI is allowed to be red at this commit (mark the commit `test: red — <slug>`).

### Stage 5 — Green production code
- Implement the minimum code to make every red test pass. No extra features, no speculative branches, no untested code paths.
- All tests (new + existing) must pass: `pnpm test && pnpm typecheck && pnpm lint`.
- Commit at green.

### Stage 6 — Code review + refactor
- Spawn a **Reviewer subagent** (`code-reviewer` agent type or `general-purpose` with a reviewer brief). Provide it the tech plan, the diff, and `CLAUDE.md`.
- Reviewer evaluates: best-practice adherence, naming, dead code, duplication, missing edge-case tests, security, accessibility, citation discipline (§4–§5), TDD discipline (was a red test really first?), and **refactor opportunities**.
- Reviewer returns a written report. The implementing agent applies every recommendation that the user approves; tests stay green throughout. Decline-with-reason is acceptable but must be recorded in the plan doc.
- Final commit: `refactor: apply review — <slug>`.

### Pipeline rules
- Each stage's output is a **committed artifact** (markdown file or commit). Verbal sign-off is not enough.
- Stages 1–3 produce no executable code. Stage 4 produces only failing tests. Stage 5 produces production code. Stage 6 may produce refactors but no new features.
- For trivial changes (typo, dependency bump), Stages 1–3 may be collapsed into a single one-paragraph note in the PR description — but only with explicit user approval per change.

---

## 3. The Prime Directive — TDD, always

> **No production code is written without a failing test first.** No exceptions.

This applies to every agent, every PR, every "quick fix." If you find yourself typing implementation before a failing test exists, stop and back out.

### Required loop (Red → Green → Refactor)
1. **Red.** Write the smallest test that captures the next behavior. Run it. Confirm it fails *for the right reason* (assertion failure, not import error).
2. **Green.** Write the minimum code to pass. No extra features, no speculative branches.
3. **Refactor.** Improve names, dedupe, simplify — tests stay green.
4. **Commit** at green. One behavior per commit when feasible.

### Test layering
- **Unit tests** for every pure function and tool wrapper (mock the network).
- **Contract tests** for every external source (Pikalytics, Smogon, Munchstats, Labmaus, Victory Road, YouTube, Showdown). Pin a real captured fixture per source under `fixtures/<source>/<date>__<slug>.json|html`. Re-run weekly to detect upstream drift.
- **Golden tests** for damage calc and speed benchmarks (see §3).
- **Integration tests** for the agent loop using recorded Anthropic responses.
- **No test = no merge.** A PR that adds production code without tests is rejected by default.

### What "failing for the right reason" means
- The test fails because the *behavior* is missing, not because a file/import/type is missing.
- If the only failure is "module not found," scaffold the module signature first, then write the assertion.

### Pragmatic exemption: pure data definitions
For modules that are **pure data definitions** (zod schemas, enums, fixture JSON, type aliases), tests may be written *after* a cohesive implementation lands as long as each test still asserts a single behavior and the test suite locks in correctness. Per-field red-first cycles on a single zod object buy little (the implementation is largely known up-front and tends to be fully covered by the first happy-path test). For modules with **external dependencies or non-trivial logic** (mapping/adapter layers, tool functions, agent loops, parsers, CLI wiring) — strict per-test Red→Green is required and any vacuous-green slip must be flagged in the change report so the reviewer can scrutinize coverage.

---

## 4. Damage, speed, and numerical correctness

These are the load-bearing primitives. Wrong numbers here poison every downstream recommendation.

- **Source of truth:** `@smogon/calc`. Wrap it; do not reimplement formulas.
- **Golden fixtures:** maintain `fixtures/calcs/*.json` — a curated set of canonical Reg M-A calcs (e.g., "252+ Atk Choice Band Urshifu-S Wicked Blow vs. 4 HP / 0 Def Flutter Mane on a critical hit"). Each entry stores attacker/defender/move/field + the exact damage roll array + KO chance. Tests assert **exact equality** against these. **Reg M-A has no Tera — no fixture may set a Tera type.**
- **Validation:** before shipping the calc tool, cross-check ≥ 20 calcs against the public Showdown calculator UI. Document each check in `fixtures/calcs/README.md` with a screenshot or link.
- **Speed tiers:** generated from current top-50 usage with their common spreads. Golden fixture `fixtures/speed/top50.json` is regenerated weekly and committed; diffs in PRs are reviewed.
- **No silent rounding.** Damage rolls are arrays of 16 integers. Never average, never round, until the UI layer.
- **Field state matters.** Weather, terrain, screens, abilities, items — every calc call must take an explicit `Field` object. No defaults that hide assumptions. (Tera is not part of Reg M-A and must not appear in inputs.)
- **Reg M-A stat rules.** No IVs in inputs (the mapping layer always passes 31s to `@smogon/calc`). **Champions calls them SPS (Stat Points), not EVs** — domain code/schemas/tests all use `sps` and the `evs` key is rejected with a Champions-specific error message. Mapping layer translates `sps → evs` at the `@smogon/calc` boundary (engine API still uses `evs`). SPS totals validated ≤ 66 across all six stats, **per-stat cap 32**, **step size 1** (1 SPS = 1 stat point at L50 in Champions). Any input violating these is a `CalcInputError`.

If a calc result disagrees with the public Showdown calculator, **stop and investigate**. Do not "adjust" the test to match the code.

---

## 5. Data layer — built for LLM consumption

The agent is only as good as the data it can read. Every datum we persist must be:

1. **Serializable** — JSON-first. No class instances, no Dates without ISO strings, no `undefined` in payloads (use `null`).
2. **Self-describing** — every record carries `schema_version`, `source`, `fetched_at` (ISO-8601 UTC), and a stable `id`.
3. **Cited** — every fact links back to a `source_url` and, where possible, a `source_excerpt` (verbatim snippet ≤ 500 chars).
4. **Typed** — defined with `zod` schemas in `src/schemas/`. Schemas are the contract; types derive from them (`z.infer`).
5. **LLM-legible** — prefer flat shapes with explicit field names (`usage_percent`, not `u`). Enumerated values use full strings (`"Choice Specs"`, not codes). Free-text fields are bounded.

### Canonical entities (v1)
- `Pokemon` — species + Reg M-A metadata.
- `Set` — full build (item, ability, nature, EVs, moves) + provenance. **Reg M-A: no IVs (calc layer fills 31s), 66-point EV pool, no Tera.**
- `Team` — 6 sets + win condition + lead plan.
- `UsageSnapshot` — per-source usage data with `as_of` date.
- `TournamentResult` — event, placement, team, player, source.
- `Replay` — parsed Showdown log + structured turns.
- `Insight` — atomic LLM-extracted claim (see §5).
- `CalcResult` — input + 16 rolls + KO chance + field state.
- `LeadPlan` — see §6.

### Storage
- SQLite for relational data, a vector store (Chroma or LanceDB — TBD) for semantic search over `Insight`s, transcripts, and notes.
- Every write goes through a repository function with a zod schema check. No raw SQL in agent code.

---

## 6. Insights & YouTube — modeled for retrieval

YouTube transcripts and comments are noisy. We do **not** dump raw text into the KB. We extract atomic **Insights**.

### `Insight` shape (illustrative)
```ts
{
  id: string,                       // ulid
  schema_version: 1,
  claim: string,                    // ≤ 280 chars, single assertion
  claim_type: "matchup" | "set" | "lead" | "meta_trend" | "tech" | "counter",
  subjects: {                       // what the claim is about — used for retrieval filtering
    pokemon: string[],              // canonical species names
    moves?: string[],
    items?: string[],
    archetypes?: string[],
    formats: ["RegM-A"],
  },
  confidence: "low" | "medium" | "high",
  stance: "supports" | "refutes" | "neutral",
  source: {
    type: "youtube" | "article" | "tournament" | "replay" | "user_note",
    url: string,
    author?: string,
    published_at?: string,          // ISO-8601
    excerpt: string,                // ≤ 500 chars verbatim
    timestamp_seconds?: number,     // for video sources
  },
  extracted_by: { model: string, prompt_version: string, extracted_at: string },
  embedding_ref: string,            // pointer into vector store
}
```

### Extraction rules
- One claim per Insight. If a paragraph contains three claims, produce three Insights.
- The `claim` field must be **standalone** — readable without the surrounding transcript.
- `subjects.pokemon` uses canonical names from our species table. Reject extractions that reference unknown species (flag for review).
- Comments are extracted only if they include a verifiable claim or a tournament result. Pure opinion is dropped.
- **Test coverage:** the extraction pipeline has fixture transcripts with hand-labeled expected Insights. PRs that change extraction must show diff against these fixtures.

### Retrieval contract
When the agent asks "what do we know about X vs Y?", it gets back ranked Insights with their citations. Recommendations must quote at least the `claim` and link the `source.url`.

---

## 7. Lead openers — first-class feature

Lead selection is one of the highest-leverage decisions in VGC. The system must produce, for any (our team, opponent team preview) pair:

- **One primary lead** with explicit reasoning.
- **3–4 alternative leads** keyed to plausible opponent leads or game plans.
- For each lead: the **back pair**, the **win condition turn 1–3**, the **key item / ability activation timing**, and the **abandon condition** (when to pivot off this plan). (Reg M-A has no Tera, so no Tera trigger field.)

### `LeadPlan` shape (illustrative)
```ts
{
  our_team_id: string,
  opponent_preview: string[],            // 4–6 species shown at preview
  primary: LeadOption,
  alternatives: LeadOption[],            // length 3–4
  generated_at: string,
  citations: string[],                   // Insight ids + tournament result ids
}

type LeadOption = {
  leads: [string, string],               // two species
  back: [string, string],                // two species
  rationale: string,                     // ≤ 400 chars, cites evidence
  expected_opponent_leads: string[][],   // each entry is a [a,b] pair
  win_condition: string,                 // turn 1–3 plan
  key_timing: string,                    // when to activate items/abilities (no Tera in Reg M-A)
  abandon_if: string,
  key_calcs: CalcResultRef[],            // 1–3 calcs that justify the plan
}
```

### Required behavior
- The agent **must** call `damage_calc` and `speed_benchmark` while constructing a `LeadPlan`. A plan without supporting calcs is invalid and must be rejected by the validator.
- Alternatives must be **meaningfully distinct** (different leads or fundamentally different game plan) — not cosmetic variants.
- Lead plans are tested against fixture team-vs-team scenarios with expected primary leads (curated from tournament data).

---

## 8. Tool layer rules

Every external data source is a **tool** under `src/tools/<source>.ts` with this contract:

1. **Pure function signature.** Inputs in, structured output out. No hidden globals.
2. **Zod-validated output.** Defined schema in `src/schemas/`.
3. **Cached.** TTL per source (see PRD §7). Cache key includes all inputs.
4. **Throttled.** Per-source rate limiter. Respect `robots.txt`.
5. **Cited.** Every returned record carries `source_url` + `fetched_at`.
6. **Tested.** Unit tests against committed fixtures + a contract test that hits the live source weekly (skipped in CI by default, run via `pnpm test:contract`).
7. **Documented.** Each tool exports a JSON Schema description used by the Anthropic SDK tool definition.

### Adding a new tool
- Open a `tools/<source>/SPEC.md` first describing inputs, outputs, edge cases.
- Write the failing schema test.
- Capture a fixture from the live source.
- Implement against the fixture.
- Then wire into the agent.

---

## 9. Agent / Anthropic SDK conventions

- Default model: **Opus 4.7** for reasoning (team building, replay analysis, lead planning). **Haiku 4.5** for ingest/extraction (transcript → Insights, HTML → structured).
- **Prompt caching is required** on: the system prompt, the tool definitions, and the meta snapshot context block. Verify cache hits in tests.
- Agents must always cite. The system prompt instructs the model to refuse to make a recommendation without retrieving at least one supporting `Insight` or `TournamentResult`.
- Agents must call `team_validate` before returning any team. Reg M-A legality is non-negotiable.

---

## 10. Repo conventions

- **Language:** TypeScript, `strict: true`. No `any` without an inline justification comment.
- **Typed function signatures, always.** Every exported function, method, and class member must declare its parameter and return types explicitly — no inference-only signatures, no implicit `any`. Trust-boundary functions (CLI entry points, agent tool dispatchers, JSON loaders, network handlers) should still type their parameter as the *expected* domain type and validate via the corresponding zod schema; the runtime contract is the schema, not the type. Untrusted callers cast through `unknown` at the call site (`fn(raw as unknown as Domain)`), which keeps the trust boundary explicit while preserving in-process autocomplete and type-checking for the much larger surface of typed callers. Internal helpers (closures, `const fn = () => …`) may rely on inference where the return type is obvious from a single expression, but anything multi-line or exported must be annotated.
- **TSDoc on every exported tool / function / method.** Anything `export`ed from `src/` (especially in `src/tools/`, `src/db/`, `src/data/`, and any module the agent loop can call as a tool) carries a TSDoc block before its declaration. Agents pick which tool to use by reading these blocks — sparse or missing docs cause wrong-tool selection, which is hard to debug after the fact. Required content per block:
  1. **Summary line** — one sentence stating *what the function does*, in present-tense active voice. Avoid restating the name.
  2. **When to use it** — one sentence (or short bullet list) describing the use cases this tool is the right answer for. If two tools could plausibly handle the same input, each one's "when to use it" must disambiguate.
  3. `@param` for each parameter, with the domain meaning (not just the type, which is already in the signature). Note constraints the type can't express (e.g., "EV total ≤ 66", "must be a Reg M-A legal species").
  4. `@returns` describing the shape and semantics, including what `null`/empty represents.
  5. `@throws` for every error class the function can throw, with the trigger condition.
  6. `@example` with a runnable code snippet for non-trivial entry points (`damage_calc`, `roster.get`, etc.). Skip for one-line getters.
  Keep the prose factual. Do not duplicate type information that the signature already encodes — describe the *meaning*, not the syntax.
- **TSDoc enforcement is a review gate, not a lint gate (yet).** Stage 6 reviewer checks that every new `export` carries TSDoc with all six elements. If a future PR adds an undocumented export, reject in review. We can add an ESLint plugin (`eslint-plugin-tsdoc` + `jsdoc/require-jsdoc`) later if review burden grows.
- **New DB reference tables use `createSimpleRepo`.** Any read-only Champions reference table (items, abilities, moves, future natures/types/...) where lookups are by canonical id or case-insensitive display name **must** instantiate `createSimpleRepo<Row, Entity>` from `src/db/simple-repo.ts` rather than copy-pasting the cache + lookup pattern. The factory is the single source of truth for the per-`Db` `WeakMap` cache, prepared-statement lifecycle, `toCanonicalId` normalization, and `RosterDbError`/`RosterDataError` wrapping. A new ref-table file is ~30 lines: row interface, `createSimpleRepo` call with a zod-validated `rowToEntity` (use `parseOrThrow`), three TSDoc'd one-liner wrappers exposing `list`/`get`/`has`. Bespoke lookups (multi-source like `roster.get` resolving id + display_name + alias, or multi-table assembly like `roster.get` joining species + stats + abilities) stay bespoke — the factory deliberately doesn't generalize that far. See `src/db/items.ts` for the canonical example. Memory: `db_orm_drizzle.md`.
- **Package manager:** `pnpm`.
- **Test runner:** Vitest.
- **Lint/format:** ESLint + Prettier; commit hooks enforce.
- **Commits:** Conventional Commits (`feat:`, `fix:`, `test:`, `chore:`, `docs:`). One behavior per commit.
- **Branches:** `feat/<slug>`, `fix/<slug>`. Never push to `main` directly.
- **Secrets:** `.env.local` only. Never commit keys. `ANTHROPIC_API_KEY`, `YOUTUBE_API_KEY` minimum.

---

## 11. Definition of Done (per change)

A change is done when **all** are true:
- [ ] Flow doc exists and is reviewed (`docs/flows/<slug>.md`, Stage 1–2).
- [ ] Tech plan exists and is approved (`docs/plans/<slug>.md`, Stage 3).
- [ ] A failing test was written first (visible in commit history, Stage 4).
- [ ] All tests pass locally (`pnpm test`).
- [ ] Types check (`pnpm typecheck`).
- [ ] Lint clean (`pnpm lint`).
- [ ] New external data is schema-validated and fixture-backed.
- [ ] Any user-facing claim is cited (`source_url` present).
- [ ] Docs touched if behavior changed (`PRD.md`, tool `SPEC.md`, or this file).
- [ ] Reviewer subagent ran and recommendations applied or recorded (Stage 6).

---

## 12. When in doubt

- If the user asks for a shortcut around TDD, **push back once**, then comply only with explicit confirmation. Record the deviation in the commit message.
- If a data source is ambiguous about scraping, ask the user before scraping.
- If a calc disagrees with Showdown, the calc is wrong — investigate, don't paper over.
- If you are about to write production code without a red test, **stop**.
