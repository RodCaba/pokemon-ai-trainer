/**
 * Haiku 4.5–driven Insight extractor. One Anthropic `messages.create` call per
 * chunk; strict tool_use schema (`emit_insights`); ≤ 5 insights per chunk;
 * hallucination guard enforces that every `subjects.pokemon[]` id maps back
 * to a surface form actually present in the chunk text.
 *
 * Per `docs/plans/youtube-insights.md` §15 binding answers:
 *   Q3 — cap at 5 per chunk
 *   Q4 — pin extracted_by.prompt_version='v1.0'
 *   Q6 — hallucination guard via species_index reverse lookup
 *   §15.2 — schema_violation: skip-once, no retry
 */

import { InsightExtractionError } from "../../schemas/errors";
import { InsightSchema, type Insight } from "../../schemas/insight";
import type { SpeciesIndex } from "../knowledge/species-tagger";
import type { YoutubeVideoMetadata } from "../youtube/client";

/** Minimal duck-typed seam for the Anthropic SDK client used by extract. */
export interface AnthropicClientLike {
  messages: {
    create(args: unknown): Promise<unknown>;
  };
}

/** Minimal shape required from a `knowledge_chunks` row by extraction. */
export interface KnowledgeChunkRowMinimal {
  id: string;
  chunk_text: string;
  article_url: string;
  /** Carrier of `timestamp_start_seconds` etc. for transcript chunks. */
  metadata?: Record<string, unknown> | null;
}

/** Fixed inputs for one extraction call. */
export interface ExtractInsightsInput {
  chunk: KnowledgeChunkRowMinimal;
  video_meta: YoutubeVideoMetadata;
  species_index: SpeciesIndex;
}

/** Injection slots for {@link extractInsights}. */
export interface ExtractInsightsDeps {
  anthropic: AnthropicClientLike;
  /** Pinned at ship time per Q4 binding. */
  prompt_version: "v1.0";
  clock: () => Date;
  ulid: () => string;
}

/** One rejected raw extraction with the reason discriminator. */
export interface ExtractInsightsRejection {
  reason: "hallucinated_species" | "non_regma_format" | "schema_violation";
  raw: unknown;
}

/** Result of one extraction call. */
export interface ExtractInsightsResult {
  insights: Insight[];
  rejected: ExtractInsightsRejection[];
}

const MODEL_ID = "claude-haiku-4-5-20251001";
const MAX_INSIGHTS = 5;

/**
 * Build the strict `emit_insights` tool definition handed to Anthropic.
 * Kept inline (not a separate file) — the schema is small and the prompt
 * version is the tag of record on extracted_by.
 */
function emitInsightsToolDefinition(): {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
} {
  return {
    name: "emit_insights",
    description:
      "Emit ≤5 atomic VGC claims extracted from a YouTube transcript chunk. " +
      "Each claim must be standalone, ≤280 chars, mention only Reg M-A species " +
      "literally present in the chunk text, and quote a verbatim source_excerpt.",
    input_schema: {
      type: "object",
      properties: {
        insights: {
          type: "array",
          maxItems: MAX_INSIGHTS,
          items: {
            type: "object",
            required: [
              "claim",
              "claim_type",
              "subjects",
              "confidence",
              "stance",
              "source_excerpt",
            ],
            properties: {
              claim: { type: "string", maxLength: 280 },
              claim_type: {
                type: "string",
                enum: ["matchup", "set", "lead", "meta_trend", "tech", "counter"],
              },
              subjects: {
                type: "object",
                required: ["pokemon", "formats"],
                properties: {
                  pokemon: {
                    type: "array",
                    items: { type: "string" },
                    minItems: 1,
                  },
                  moves: { type: "array", items: { type: "string" } },
                  items: { type: "array", items: { type: "string" } },
                  archetypes: { type: "array", items: { type: "string" } },
                  formats: {
                    type: "array",
                    items: { const: "RegM-A" },
                  },
                },
              },
              confidence: { type: "string", enum: ["low", "medium", "high"] },
              stance: {
                type: "string",
                enum: ["supports", "refutes", "neutral"],
              },
              source_excerpt: { type: "string", maxLength: 500 },
            },
          },
        },
      },
      required: ["insights"],
    },
  };
}

interface RawInsight {
  claim: string;
  claim_type: Insight["claim_type"];
  subjects: {
    pokemon: string[];
    moves?: string[];
    items?: string[];
    archetypes?: string[];
    formats: string[];
  };
  confidence: Insight["confidence"];
  stance: Insight["stance"];
  source_excerpt: string;
}

interface AnthropicResponseShape {
  content?: Array<{
    type?: string;
    name?: string;
    input?: { insights?: unknown };
  }>;
}

function pickToolUseInsights(resp: unknown): RawInsight[] | null {
  const r = resp as AnthropicResponseShape;
  if (!Array.isArray(r?.content)) return null;
  for (const block of r.content) {
    if (block?.type === "tool_use" && block.name === "emit_insights") {
      const ins = block.input?.insights;
      if (Array.isArray(ins)) return ins as RawInsight[];
    }
  }
  return null;
}

/**
 * Reverse-lookup: does the chunk text mention any surface form mapping to
 * `canonicalId` per the species index? Loops `index.entries` to find an entry
 * with the requested `speciesId` and runs its pattern against `chunkText`.
 */
function speciesPresentInChunk(
  canonicalId: string,
  chunkText: string,
  index: SpeciesIndex,
): boolean {
  // Tera-key strip defense-in-depth (memory regulation_m_a_no_tera.md).
  if (/^tera/i.test(canonicalId)) return false;
  for (const e of index.entries) {
    if (e.speciesId !== canonicalId) continue;
    e.pattern.lastIndex = 0;
    if (e.pattern.test(chunkText)) return true;
  }
  return false;
}

function buildSystemPrompt(): string {
  return [
    "You are an extraction engine for competitive Pokémon (VGC) YouTube transcripts.",
    "You will receive ONE chunk of a transcript and emit ≤5 atomic claims via the",
    "`emit_insights` tool. Hard rules:",
    "  1. ONE claim per insight — never combine assertions.",
    "  2. `claim` ≤ 280 chars, standalone (readable without context).",
    "  3. `subjects.pokemon[]` MUST list canonical species ids (lowercase, no spaces)",
    "     and EVERY id must be a Pokémon literally mentioned in the chunk text.",
    "     Do NOT include species the speaker only alludes to.",
    "  4. `subjects.formats` MUST be exactly `[\"RegM-A\"]` — Pokémon Champions",
    "     Regulation M-A. Reject (omit) any claim about other formats.",
    "  5. `source_excerpt` is verbatim from the chunk, ≤500 chars.",
    "  6. Reg M-A has NO Terastallization — never mention Tera in any field.",
    "  7. If the chunk has no salient claims, emit `{ insights: [] }`.",
  ].join("\n");
}

/**
 * Run the Haiku-driven extractor over one chunk.
 *
 * **When to use it:** the per-chunk extraction call inside the YouTube ingest
 * loop. Returns up to 5 schema-validated insights plus a rejection summary;
 * never throws on per-row schema failure (counted in `rejected[]`).
 *
 * @param input - Chunk + video metadata + species lookup index.
 * @param deps - Anthropic client + prompt version + clock + ulid factory.
 * @returns `{ insights, rejected }` — empty `insights` is valid.
 * @throws {InsightExtractionError} On `rate_limit` after retry exhaustion or
 *   `anthropic_error` (e.g. 401/403). Per-row schema violations are counted
 *   in `rejected`, not thrown.
 *
 * @example
 *   const r = await extractInsights({ chunk, video_meta, species_index }, deps);
 *   for (const ins of r.insights) await embed(ins);
 */
export async function extractInsights(
  input: ExtractInsightsInput,
  deps: ExtractInsightsDeps,
): Promise<ExtractInsightsResult> {
  const chunk_id = input.chunk.id;
  const tool = emitInsightsToolDefinition();

  let resp: unknown;
  try {
    resp = await deps.anthropic.messages.create({
      model: MODEL_ID,
      max_tokens: 1024,
      system: buildSystemPrompt(),
      tools: [tool],
      tool_choice: { type: "tool", name: "emit_insights" },
      messages: [
        {
          role: "user",
          content:
            `Source: ${input.video_meta.canonical_url}\n` +
            `Title: ${input.video_meta.title}\n` +
            `Channel: ${input.video_meta.channel}\n` +
            `Chunk text:\n${input.chunk.chunk_text}`,
        },
      ],
    });
  } catch (e) {
    const status =
      typeof e === "object" && e !== null && "status" in e
        ? Number((e as { status?: unknown }).status)
        : undefined;
    const kind = status === 429 ? "rate_limit" : "anthropic_error";
    throw new InsightExtractionError({
      chunk_id,
      kind,
      cause: e,
      message: e instanceof Error ? e.message : `anthropic ${kind}`,
    });
  }

  const raws = pickToolUseInsights(resp);
  if (raws === null) {
    return { insights: [], rejected: [] };
  }

  const cap = raws.slice(0, MAX_INSIGHTS);
  const insights: Insight[] = [];
  const rejected: ExtractInsightsRejection[] = [];
  const extracted_at = deps.clock().toISOString();
  const chunkText = input.chunk.chunk_text;
  const timestamp_seconds =
    typeof input.chunk.metadata?.["timestamp_start_seconds"] === "number"
      ? Number(input.chunk.metadata?.["timestamp_start_seconds"])
      : 0;

  for (const raw of cap) {
    if (
      !Array.isArray(raw?.subjects?.formats) ||
      raw.subjects.formats.length !== 1 ||
      raw.subjects.formats[0] !== "RegM-A"
    ) {
      rejected.push({ reason: "non_regma_format", raw });
      continue;
    }
    if (!Array.isArray(raw.subjects?.pokemon) || raw.subjects.pokemon.length === 0) {
      rejected.push({ reason: "schema_violation", raw });
      continue;
    }
    let allPresent = true;
    for (const sp of raw.subjects.pokemon) {
      if (!speciesPresentInChunk(sp, chunkText, input.species_index)) {
        allPresent = false;
        break;
      }
    }
    if (!allPresent) {
      rejected.push({ reason: "hallucinated_species", raw });
      continue;
    }

    const candidate: Insight = {
      id: deps.ulid(),
      schema_version: 1,
      claim: raw.claim,
      claim_type: raw.claim_type,
      subjects: {
        pokemon: raw.subjects.pokemon,
        moves: raw.subjects.moves,
        items: raw.subjects.items,
        archetypes: raw.subjects.archetypes,
        formats: ["RegM-A"],
      },
      confidence: raw.confidence,
      stance: raw.stance,
      source: {
        type: "youtube",
        url: input.video_meta.canonical_url,
        author:
          input.video_meta.channel.length > 0
            ? input.video_meta.channel
            : undefined,
        published_at: input.video_meta.published_at ?? undefined,
        excerpt: raw.source_excerpt,
        timestamp_seconds,
      },
      extracted_by: {
        model: MODEL_ID,
        prompt_version: deps.prompt_version,
        extracted_at,
      },
      // embedding_ref filled in by the store on insert; placeholder here.
      embedding_ref: "insight_embeddings:0",
      chunk_id: input.chunk.id,
    };

    const parsed = InsightSchema.safeParse(candidate);
    if (!parsed.success) {
      rejected.push({ reason: "schema_violation", raw });
      continue;
    }
    insights.push(parsed.data);
  }

  return { insights, rejected };
}
