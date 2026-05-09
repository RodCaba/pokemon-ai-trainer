# Flow: youtube-insights ingest

**Slug:** `youtube-insights`
**Status:** Stage 1 — flow draft
**Author:** Claude (Opus 4.7)
**Date:** 2026-05-09

## 1. Why this slice

Tournament players upload long-form team-deep-dive videos on YouTube
that contain the kind of strategic context that no roster table or
damage calc captures: *why* a team is built this way, what specific
matchups it's designed to beat, and what plays the author makes against
top-meta opponents in actual replays. The user's example is
`https://www.youtube.com/watch?v=J0eVKJyJ_DQ` — a deep-dive on the
exact 6-species composition the user just imported. The video walks
through:
- composition rationale (why these 6 species, not the 56× cluster default)
- per-slot reasoning (item / SPS / move choices)
- expected matchups and play patterns
- live games against top-meta opponents

This is **strategic prior** the agent should be able to retrieve when
the user asks "how should I play this team in the Tyranitar matchup?"
or "why does this team run Solar Power Charizard?". Today the agent
falls back to generic VGC chunks (vgcguide / metavgc article corpus) +
its own training. With YouTube ingest, it gets the **specific author's
intent** for the specific team.

CLAUDE.md §6 already designs the canonical primitive: **`Insight`** —
atomic, single-claim, citation-bound, retrieval-tagged. Raw transcripts
are noisy; we extract per-claim Insights and store them alongside
`knowledge_chunks` so retrieval surfaces both the chunk (context) and
the structured claim (precise hit).

## 2. User flow

The user has two surfaces:

### 2.1 Manual ingest of a single video

```
pnpm data:ingest:youtube --url https://www.youtube.com/watch?v=J0eVKJyJ_DQ
```

The CLI:
1. Fetches the video metadata + transcript (YouTube auto-captions, default).
2. Chunks the transcript into ~60-90s windows with overlap.
3. Persists chunks into `knowledge_chunks` with `subtype='youtube-transcript'`,
   `source_site='youtube'`, `article_url=<video URL>`,
   `chunk_text=<verbatim transcript chunk>`, `metadata.timestamp_start_seconds`.
4. For each chunk, runs **Haiku-driven Insight extraction** — produces
   N atomic `Insight` rows. Stores them in the `insights` table.
5. Tags species mentioned via `knowledge_chunk_species_tags` AND
   `insight_subjects` (per Insight).
6. Outputs a per-video summary: chunks ingested, insights extracted,
   top-3 species mentioned, sample claims.

### 2.2 Agent retrieval (already-ingested videos)

When the agent answers a question about a saved user team, it runs:
```
knowledge.search(query=<user_question_embed>, species_id_filter=team.species_ids)
```
Today this returns chunks from vgcguide + metavgc. Post-slice, it ALSO
returns chunks from YouTube transcripts. AND a parallel
`insights.search(query, claim_type, species_filter)` returns the
structured atomic claims that match.

The tactical-overview slice's `cite.ts` already surfaces
`knowledge_chunks` per scenario; with this slice it also surfaces
relevant Insights with the video URL + timestamp_seconds, so the agent
can quote and link to the exact moment.

## 3. Tech flow

```
youtube URL ──► fetchTranscript() ──► [{ text, start_s, duration_s }]
                                              │
                              chunkTranscript(window=90s, overlap=15s)
                                              │
                                       TranscriptChunk[]
                                              │
                                              ▼
                          ┌─────────────────────────────────────┐
                          │ persist as knowledge_chunks         │
                          │  subtype='youtube-transcript'        │
                          │  metadata.timestamp_start_seconds   │
                          └─────────────────────────────────────┘
                                              │
                                              ▼
                          ┌─────────────────────────────────────┐
                          │ Haiku extractInsights(chunk)         │
                          │  output: 0..N atomic claims with     │
                          │   claim_type / subjects / stance     │
                          │  cost: ~500 input tok per chunk     │
                          └─────────────────────────────────────┘
                                              │
                                              ▼
                          insights table + insight_subjects link
                                              │
                                              ▼
                          species-tag the chunk via existing
                          knowledge_chunk_species_tags pipeline
                          (insights.subjects.pokemon → tags)
```

Reuse:

- `src/db/knowledge.ts` — chunk persistence; just add a new `subtype`
  value `'youtube-transcript'` (already uses `subtype` for `'battle-replay'`).
- `src/tools/knowledge/embed.ts` — Voyage embedding for transcript chunks.
- `src/tools/knowledge/chunk.ts` — adapt for transcript-style content
  (windowed-by-time vs section-by-heading) — keep the existing
  article-chunker for vgcguide / metavgc; add a sibling for transcripts.
- `src/db/insights.ts` — stub already exists; this slice ships the
  full impl.
- `src/schemas/insight.ts` — schema already defined per CLAUDE.md §6.
- `src/data/tactical/cite.ts` — extend to also pull Insights when
  citing a tactical scenario.

New, slice-specific:

- `src/tools/youtube/client.ts` — HTTP client for YouTube Data API v3
  + transcript fetch (using `youtube-transcript` npm package).
- `src/tools/youtube/parse-transcript.ts` — normalize fetched
  transcript into `TranscriptSegment[]`.
- `src/tools/youtube/chunk-transcript.ts` — windowed chunker.
- `src/tools/insights/extract.ts` — Haiku-driven extraction
  (chunk → `Insight[]` via Anthropic SDK).
- `src/tools/insights/embed.ts` — Voyage embedding per Insight (the
  `claim` field gets embedded; `subjects.pokemon` provides the species
  filter at retrieval).
- `src/db/insights.ts` — full repo impl: `upsert`, `search`,
  `listBySpecies`, `getByVideoId`.
- `src/db/migrations/0010_insights_and_youtube.sql` — new tables.
- `scripts/data/ingest-youtube.ts` — CLI orchestrator.
- `fixtures/youtube/<video_id>__transcript.json` — captured
  fixtures for tests.

## 4. Schema additions (sketch)

### 4.1 `insights` table

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | ulid |
| `schema_version` | INTEGER NOT NULL | 1 |
| `claim` | TEXT NOT NULL | ≤ 280 chars |
| `claim_type` | TEXT NOT NULL CHECK IN (matchup, set, lead, meta_trend, tech, counter) | |
| `confidence` | TEXT NOT NULL CHECK IN (low, medium, high) | |
| `stance` | TEXT NOT NULL CHECK IN (supports, refutes, neutral) | |
| `source_type` | TEXT NOT NULL CHECK IN (youtube, article, tournament, replay, user_note) | |
| `source_url` | TEXT NOT NULL | |
| `source_author` | TEXT NULL | |
| `source_published_at` | TEXT NULL | ISO-8601 |
| `source_excerpt` | TEXT NOT NULL | ≤ 500 chars verbatim |
| `source_timestamp_seconds` | INTEGER NULL | for video sources |
| `extracted_by_model` | TEXT NOT NULL | "claude-haiku-4-5-20251001" |
| `extracted_by_prompt_version` | TEXT NOT NULL | "v1" |
| `extracted_at` | TEXT NOT NULL | ISO-8601 |
| `embedding_ref` | TEXT NOT NULL | "insight_embeddings:<rowid>" |
| `chunk_id` | TEXT NULL FK → knowledge_chunks.id | source chunk that produced this insight |

### 4.2 `insight_subjects` (link table)

For filtering by species / move / item / archetype:

| Column | Type | Notes |
|---|---|---|
| `insight_id` | TEXT NOT NULL FK → insights.id ON DELETE CASCADE | |
| `subject_kind` | TEXT NOT NULL CHECK IN (pokemon, move, item, archetype, format) | |
| `subject_value` | TEXT NOT NULL | canonical id (lowercase species_id, etc.) |
| | | PRIMARY KEY (insight_id, subject_kind, subject_value) |

### 4.3 `insight_embeddings` (vec0 sidecar)

Mirrors the existing `knowledge_chunk_embeddings` pattern — 512-dim
sqlite-vec virtual table holding `Insight.claim` embeddings for
semantic retrieval.

### 4.4 No changes to `knowledge_chunks`

The transcript chunks land in the existing table. New value for
`subtype = 'youtube-transcript'` (CHECK widens additively). New value
for `source_site = 'youtube'` (CHECK widens additively). Extend
`metadata` JSON column with `timestamp_start_seconds` field.

## 5. Insight extraction prompt (sketch)

Single Haiku call per chunk; system prompt enumerates the 6
`claim_type`s + the canonical species roster. User prompt is the
transcript chunk + video metadata. Output is JSON-schema'd `Insight[]`
(0..5 claims per chunk; many chunks will produce 0).

Quality contract:
- Each `claim` must be standalone (no pronouns referring to the chunk).
- `subjects.pokemon` must match canonical species_ids in our roster.
- If the chunk references a non-Reg-M-A species (e.g. "back when I ran
  Calyrex-Shadow in restricteds…"), the extraction discards or marks
  `confidence: low` + `format: !"RegM-A"`.
- The 280-char `claim` cap forces atomicity; one chunk producing a
  paragraph-long claim is a prompt failure → reject and retry.
- Output is JSON; Anthropic SDK `tool_use` mode with a strict schema.

## 6. Extraction cost model

- Average video: 20 minutes = ~3000 words = ~30 chunks (90s windows).
- Haiku 4.5 input: ~500 tokens per chunk + system prompt (~1000 tokens).
- Output: ~500 tokens (5 claims × 100 tok).
- Per-chunk cost: ~$0.0005 input + $0.002 output ≈ $0.003.
- Per-video: ~30 × $0.003 = **~$0.09 / video**.

10 videos = ~$1. Cheap. Embedding cost is also negligible (Voyage
$0.05 / 1M tokens; 30 chunks × 500 tokens ≈ $0.001 / video).

## 7. Retrieval contract

Two surfaces:

### 7.1 Existing `knowledge.search` extends transparently

YouTube transcript chunks land in `knowledge_chunks` with the same
`source_site` / `species_tags` / `subtype` columns. The vec0 cosine
search already returns them. The agent's existing `knowledge_search`
tool gains YouTube hits with no other code change.

### 7.2 New `insights.search` tool

Anthropic-tool-callable: `{ query, claim_type?, species_id_filter?,
limit?: 5 }`. Returns `InsightSearchHit[]` with `cosine_score` + the
full `Insight` object. The agent uses this when it wants atomic claims
with high precision (e.g. "what does the author say about Mega
Charizard Y under Tailwind?").

The two surfaces complement: `knowledge.search` returns the *context*
(2-3 paragraphs around a topic); `insights.search` returns the
*structured claims* (atomic, citation-bound, retrieval-tagged).

## 8. Error / empty states

- **Video has no captions / disabled** → soft fail: log + skip. Don't
  block the ingest run for other videos.
- **Transcript has long single-speaker monologue with no clear claims**
  → 0 insights extracted from chunks; chunks still persist for
  full-text retrieval.
- **Haiku extraction error / rate limit** → retry with exp backoff;
  if exhausted, leave the chunk un-extracted (record in
  `extraction_failures` summary line).
- **Auto-caption garbled (non-English / heavy accent)** → extraction
  produces low-confidence insights; downstream retrieval threshold
  filters them.
- **Channel paywall / age-gate / region-block** → fetch fails; log
  + skip.

## 9. Success criteria

- Ingest the user's example video (`J0eVKJyJ_DQ`) end-to-end in <5
  minutes. Captures ≥10 chunks and ≥5 distinct insights with
  `subjects.pokemon` covering ≥4 of the team's 6 species.
- Re-running the ingest is idempotent (skip-existing on video_id).
- Tactical-overview's `cite.ts` surfaces ≥1 YouTube citation when the
  scenario species overlap the video's subjects.
- The agent, asked "why does this team run Solar Power Charizard
  instead of Blaze?", retrieves an Insight whose claim discusses Solar
  Power and cites the video timestamp.
- Existing tests stay green.

## 10. Out of scope (deferred)

- **Comments ingest** — CLAUDE.md §6 says comments are extracted only
  when they include a verifiable claim or tournament result; defer
  until we measure if it adds signal.
- **Whisper transcription** for videos without captions — paid API,
  defer.
- **Subtitle translation** for non-English videos — defer.
- **Channel-level subscription** (auto-pull new videos from a tracked
  channel) — defer; manual ingest only in v1.
- **Backfill of existing 0 YouTube videos** — there are none today;
  no backfill needed.
- **Retroactive insight extraction over vgcguide/metavgc chunks** —
  worth doing, but separate slice. The current slice only extracts
  from YouTube transcripts.
- **UI for browsing insights** — CLI + agent only; UI lands in
  `user-teams-ui` slice or a dedicated `insights-ui`.

## 11. Open questions for Stage 2 review

1. **Transcript fetcher**: `youtube-transcript` npm package (free,
   no API key; uses YouTube's internal endpoint) vs YouTube Data API
   v3 (requires `YOUTUBE_API_KEY`, has 10k quota/day, returns proper
   metadata + caption tracks). Proposal: `youtube-transcript` for v1
   (no key needed); upgrade to Data API when we hit rate limits or
   need richer metadata (description, tags, channel info).
   Answer: youtube-transcript is a good choice.

2. **Window size**: 90s with 15s overlap (= 13 chunks for a 20-min
   video) vs 60s with 10s overlap (= 20 chunks). Smaller windows
   produce more atomic insights but cost more Haiku calls. Proposal:
   **90s/15s** for v1 — extraction quality matters more than chunk
   count.
   Answer: 90s/15s is a good starting point. We can experiment with smaller windows in the future if we find that the insights are often too broad or contain multiple distinct claims.

3. **Insight verbosity per chunk**: cap at 5 insights per chunk?
   2-3? Some chunks have multiple claims. Proposal: **prompt
   instructs ≤ 5, no minimum** (many chunks produce 0 — that's fine).
    Answer: Capping at 5 insights per chunk seems reasonable to balance between capturing multiple claims and keeping the output manageable. The prompt should clearly instruct the model to prioritize the most salient claims if there are more than 5, and it's perfectly fine for some chunks to yield 0 insights if they don't contain any clear claims.

4. **`extracted_by_prompt_version`** — versioning scheme. Proposal:
   semver-like `"v1.0"`. Bump major when prompt structure changes.
   Answer: Using a semver-like versioning scheme for the prompt makes sense.

5. **Citation surface in tactical-overview**: when an Insight
   matches the scenario's species, should `cite.ts` return it
   alongside the existing `knowledge_chunk` citations or as a
   distinct field? Proposal: **distinct field** `insights: InsightCitation[]`
   on `ScenarioOverview` so the agent can format them differently
   ("the author of the team explains: …" vs "per the metavgc guide
   …"). Adds a schema field; non-breaking.
   Answer: Adding a distinct field for insights in the citation surface is a good idea to allow the agent to differentiate between general context and specific claims. This way, the agent can choose to highlight insights in its response when they are particularly relevant to the user's question, while still providing the broader context from the knowledge chunks.

6. **Hallucination guard**: Haiku might fabricate species names that
   weren't in the chunk. Proposal: **reject any insight whose
   `subjects.pokemon[]` includes a species not literally present
   in the chunk text** (substring match). Adds a post-extraction
   filter; rejects ~5% of insights based on initial estimates.
   Answer: Implementing a hallucination guard that checks for the presence of species names in the original chunk text is a good way to improve the precision of our insights.

7. **Idempotency key**: re-running the ingest on the same video id
   produces… what? Proposal: **skip-existing on
   (source_url + chunk_index)** for transcript chunks (mirrors
   metavgc's `body_hash` pattern). Skip-existing on
   (chunk_id + claim) for insights (mirrors knowledge_chunk_species_tags
   composite-PK pattern).
   Answer: Using a skip-existing pattern based on (source_url + chunk_index) for transcript chunks and (chunk_id + claim) for insights is a solid approach to ensure idempotency while allowing for updates if the video content changes.

8. **Live retrieval cost**: Insight search via vec0 cosine over a
   growing corpus — at what corpus size do we need to add a payload
   filter pre-cosine? Proposal: defer, profile when we hit ~10K
   insights.
   Answer: Let the tech lead this decision.

9. **Multi-language**: video title + description may be Spanish /
   Japanese / etc. Pokémon names typically stay English in the
   transcript even when the speaker isn't English. Proposal:
   **detect transcript language; only extract from English captions
   in v1.** Spanish/Japanese support is a separate slice.
   Answer: Only English captions for v1 is a good approach to keep the scope manageable.

## 12. Reviewed-by

Reviewed-by: _Rodrigo Caballero_
