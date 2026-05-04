# Pokemon AI Trainer — Product Requirements Document

**Version:** 0.1 (Draft)
**Date:** 2026-04-28
**Owner:** Rodrigo (rodser4@gmail.com)
**Target Format:** Pokemon Champions, Regulation M-A

---

## 1. Vision

A personal AI-powered training companion that helps a competitive Pokemon player climb in **Pokemon Champions (Regulation M-A)** by aggregating knowledge from across the competitive ecosystem (usage stats, tournament results, damage calcs, Showdown replays, YouTube content) into a single interface for **team building, opening strategy, synergy analysis, and post-game review**.

The product is **research-first**: it does not just suggest teams — it explains *why*, citing sources and surfacing the meta context behind every recommendation.

---

## 2. Goals & Non-Goals

### Goals
- Generate, evaluate, and iterate on Reg M-A teams with full builds (item, ability, nature, moves, EVs). **Reg M-A has no Terastallization, no IVs (treated as 31 by the calc), and a 66-point EV pool across all stats.**
- Provide **opening (lead) recommendations**, **team synergies**, **weakness coverage**, and **pivot lines** per matchup.
- Aggregate live data from **Pikalytics, Smogon, Munchstats** (usage), and **Labmaus, Victory Road** (tournament winning teams).
- Integrate **Pokemon Showdown Damage Calculator** and **speed tier benchmarks**.
- Ingest **Pokemon Showdown battle logs** and produce match analysis + improvement recommendations.
- Extract strategic insights from **YouTube videos** (transcripts, comments) about Reg M-A.
- Build a persistent **knowledge base** that improves with every battle, replay, and search.

### Non-Goals (v1)
- Real-time in-battle assistant (no Showdown overlay).
- Multi-user / SaaS (single-user, local-first).
- Formats other than VGC Reg M-A (extensible later).
- Automated team submission to ladders.

---

## 3. Target User

**Primary:** Rodrigo — a competitive VGC player preparing for Pokemon Champions Reg M-A events. Comfortable with Showdown, calc, and meta jargon. Wants to compress hours of meta research into minutes.

**Secondary (future):** Other competitive players, content creators, coaches.

---

## 4. Core Use Cases

| # | Use Case | Acceptance |
|---|----------|------------|
| U1 | "Build me a team around Incineroar + Calyrex-Shadow" | Returns ≥3 distinct team archetypes with full sets, win-condition writeup, and source citations |
| U2 | "Analyze this Showdown replay" | Upload log → get turn-by-turn breakdown, mistake flagging, alt-line suggestions |
| U3 | "What's the meta this week?" | Snapshot of top 20 usage + recent tournament-winning teams with deltas vs last week |
| U4 | "What leads do I bring vs Miraidon + Flutter Mane?" | Lead matrix with %win estimates, pivot plan, key calcs |
| U5 | "Summarize what CybertronVGC said about Terapagos this week" | YouTube transcript + comment summary scoped to a Pokemon/strategy |
| U6 | "Does my team lose to Trick Room?" | Weakness audit with damage calcs + speed tier comparison |

---

## 5. Functional Requirements

### 5.1 Team Builder & Analyzer
- Full Reg M-A legal validation (restricted slot rules, banlist, item clause, etc.).
- Set editor: species, item, ability, nature, EVs (66-point pool), 4 moves. No IVs, no Tera in Reg M-A.
- Auto-generated **Win Condition** and **Common Lead** notes.
- **Synergy graph**: speed control, redirection, screens, weather/terrain coverage.
- **Weakness audit**: type chart × meta threat list × damage calcs.
- **Pivot plan**: per-threat answers, sack candidates, key-item activation timing.

### 5.2 Meta Intelligence
- Daily ingest from Pikalytics, Smogon Stats, Munchstats.
- Weekly ingest from Labmaus & Victory Road tournament results.
- Trend deltas (rising/falling Pokemon, item shifts, spread shifts).

### 5.3 Damage Calc & Speed Benchmarks
- Wrap @smogon/calc for in-app calcs.
- Speed tier table auto-built from current top-50 usage with common spreads.
- "Outspeed / get outsped by" report per set.

### 5.4 Replay Analysis
- Upload `.html` or paste Showdown replay URL → parse log.
- Per-turn: action taken, alternative considered, predicted EV (good/bad/neutral).
- Mistake categories: misprediction, calc error, positioning, switch error, item-trigger timing.
- End-of-match summary with 3 actionable takeaways.

### 5.5 YouTube Knowledge Ingest
- Paste channel/video URL → fetch transcript + top comments.
- Tag insights by Pokemon, archetype, matchup.
- Searchable in the knowledge base.

### 5.6 Knowledge Base
- Vector store of: ingested articles, replays, video transcripts, user notes, calc results.
- Every recommendation cites the underlying KB entries.
- "Why did you suggest this?" — always answerable.

---

## 6. AI / Tool Architecture

**Model:** Claude (Opus 4.7 default for reasoning; Haiku 4.5 for ingest/extraction). Anthropic SDK with prompt caching on the team-builder system prompt + meta snapshot.

### 6.1 Tools (MCP-style, exposed to the agent)

| Tool | Purpose | Source |
|------|---------|--------|
| `pikalytics_fetch(pokemon, format)` | Usage %, common items/moves/spreads/teammates | pikalytics.com |
| `smogon_stats_fetch(format, month)` | Raw usage stats, weighted ratings | smogon.com/stats |
| `munchstats_fetch(format)` | Tournament-derived usage | munchstats.com |
| `labmaus_tournaments(filters)` | Recent tournament winning teams | labmaus.com |
| `victory_road_fetch(query)` | Tournament reports, articles, team rentals | victoryroadvgc.com |
| `damage_calc(attacker, defender, move, field)` | Showdown calc wrapper | @smogon/calc npm |
| `speed_benchmark(spread, threats)` | Outspeed matrix | derived from usage |
| `showdown_replay_parse(url_or_file)` | Parse log → structured turns | pokemonshowdown.com |
| `youtube_transcript(video_url)` | Video transcript + metadata | youtube-transcript / oEmbed |
| `youtube_comments(video_url)` | Top comments | YouTube Data API |
| `kb_search(query)` | Semantic search over local KB | local vector DB |
| `kb_write(entry)` | Persist insight to KB | local vector DB |
| `team_validate(team)` | Reg M-A legality check | local rules engine |

### 6.2 Agent Flow (example: team build)
1. User prompt → Planner agent decomposes into sub-tasks.
2. Parallel fan-out: `pikalytics_fetch`, `labmaus_tournaments`, `kb_search`.
3. Synthesis: candidate cores → fill 4–6 slots.
4. Validation loop: `team_validate` + `damage_calc` against top threats.
5. Present 3 archetypes with citations.

---

## 7. Data Sources & Compliance

| Source | Method | Caching | Notes |
|--------|--------|---------|-------|
| Pikalytics | HTML scrape / JSON endpoints | 24h | Respect robots.txt, throttle |
| Smogon Stats | Public stats files | 7d | Monthly drops, reliable |
| Munchstats | API/scrape | 24h | TBD on terms |
| Labmaus | Scrape | 24h | Credit source in UI |
| Victory Road | Scrape / RSS | 24h | Credit source |
| Showdown Calc | npm `@smogon/calc` | n/a | MIT |
| Showdown Replays | User-provided | n/a | No auto-scrape of others |
| YouTube | Data API v3 + transcript lib | 7d | Quota-managed |

All scraped sources cached locally; user-facing UI cites + links every datum.

---

## 8. UX / Interface

**Stack assumption:** Next.js + React + Tailwind, local SQLite + a vector store (e.g., Chroma or LanceDB). TypeScript end-to-end. Anthropic SDK server-side.

### Primary Surfaces
1. **Dashboard** — meta snapshot, recent replays, KB activity.
2. **Team Lab** — team builder + analyzer with side-panel AI chat.
3. **Replay Review** — upload, timeline, AI commentary.
4. **Meta Explorer** — usage charts, tournament results, trend deltas.
5. **Knowledge Base** — searchable notes, video summaries, calcs.
6. **Settings** — API keys (Anthropic, YouTube), source toggles, cache controls.

---

## 9. Milestones

| Phase | Scope | Exit criteria |
|-------|-------|---------------|
| **M0 — Tooling** *(this step)* | Wire all data-source tools as callable functions; verify each returns clean structured data | Each tool callable from a CLI script with caching + tests |
| **M1 — Team Lab MVP** | Team builder UI + AI suggestions using M0 tools | Can generate + validate a Reg M-A team end-to-end |
| **M2 — Replay Review** | Showdown log parser + analysis pipeline | Upload replay → get 3 takeaways |
| **M3 — Meta Explorer** | Dashboards + trend deltas | Daily refresh job runs unattended |
| **M4 — YouTube + KB** | Transcript ingest + semantic search | "What did X say about Y" works |
| **M5 — Polish** | Citations, exports, rentals | Shareable team report PDF |

---

## 10. Success Metrics

- Time from "team idea" → validated full team: **< 5 min**.
- Replay → actionable takeaways: **< 60s**.
- % of recommendations with ≥1 cited source: **100%**.
- Personal ladder rating delta after 1 month of use: **target +150**.

---

## 11. Open Questions

- Munchstats / Labmaus terms of service — confirm scraping is permitted; otherwise switch to manual import.
- Vector DB choice (Chroma vs LanceDB vs sqlite-vss).
- Where to host (local-only vs Vercel + Supabase)?
- Voice input for replay annotation?

---

## 12. Next Action (M0)

Stand up the tool layer:
1. Scaffold TS project (`pnpm`, Next.js, TypeScript strict).
2. Implement tool wrappers in `/src/tools/` with shared `fetch + cache + zod-validate` pattern.
3. CLI smoke-test each tool (`pnpm tool:pikalytics Incineroar`).
4. Wire tools into an Anthropic SDK agent loop with prompt caching.
5. Land a `tools/README.md` documenting each tool's contract.
