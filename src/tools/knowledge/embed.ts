/**
 * Thin Voyage AI embedding client. Direct `fetch` (no SDK). Batches up to 64
 * inputs per request; retries 429/5xx with exp backoff; hard fails on 401/403.
 */

import {
  KnowledgeAuthError,
  KnowledgeEmbeddingError,
} from "../../schemas/errors";

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_DIM = 1024;

/** Configuration for {@link createEmbedClient}. */
export interface EmbedClientOptions {
  /** Voyage API key. Empty string is rejected at first call. */
  apiKey: string;
  /** Pinned literal — switching models requires a re-embedding run. */
  model: "voyage-3-lite";
  /** Max inputs per request. Default 64. */
  maxBatch?: number;
  /** Max retry attempts on 429/5xx. Default 3. */
  maxRetries?: number;
  /** Base delay for exponential backoff in ms. Default 1000. */
  backoffBaseMs?: number;
  /** Injectable `fetch` for tests. */
  fetchImpl?: typeof fetch;
  /** Injectable clock for tests. */
  clock?: () => number;
}

/** Voyage embed client surface. */
export interface EmbedClient {
  /**
   * Embed `texts` and return one Float32Array per input. Each vector is
   * 1024-dim (`voyage-3-lite`).
   *
   * @param texts — Inputs to embed; the client batches internally.
   * @param input_type — `"document"` for ingest-time chunks; `"query"` for
   *   tool-time queries.
   */
  embed(
    texts: string[],
    input_type?: "document" | "query",
  ): Promise<Float32Array[]>;
}

interface VoyageResponse {
  data: Array<{ embedding: number[]; index: number }>;
  model?: string;
  usage?: { total_tokens?: number };
}

const sleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Build an {@link EmbedClient}.
 *
 * **When to use it:** the dep injected into `knowledgeSearch` and the
 * vgcguide ingest script. Tests inject `fetchImpl` to avoid real network.
 *
 * @param opts — see {@link EmbedClientOptions}.
 * @returns An {@link EmbedClient}.
 * @throws {KnowledgeAuthError} On Voyage 401/403 or empty `apiKey`.
 * @throws {KnowledgeEmbeddingError} On retry exhaustion (429/5xx).
 */
export function createEmbedClient(opts: EmbedClientOptions): EmbedClient {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const maxBatch = opts.maxBatch ?? 64;
  const maxRetries = opts.maxRetries ?? 3;
  const backoffBaseMs = opts.backoffBaseMs ?? 1000;

  async function embedBatch(
    inputs: string[],
    input_type: "document" | "query",
  ): Promise<Float32Array[]> {
    if (!opts.apiKey) {
      throw new KnowledgeAuthError(
        "VOYAGE_API_KEY is missing or empty — refusing to call Voyage",
      );
    }
    if (inputs.length === 0) return [];

    const body = JSON.stringify({
      input: inputs,
      model: opts.model,
      input_type,
    });

    let attempt = 0;
    let lastStatus = 0;
    while (attempt <= maxRetries) {
      const res = await fetchImpl(VOYAGE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${opts.apiKey}`,
        },
        body,
      });
      lastStatus = res.status;
      if (res.ok) {
        const json = (await res.json()) as VoyageResponse;
        const sorted = [...json.data].sort((a, b) => a.index - b.index);
        const out: Float32Array[] = [];
        for (const row of sorted) {
          if (row.embedding.length !== VOYAGE_DIM) {
            throw new RangeError(
              `voyage returned ${row.embedding.length}-dim vector; expected ${VOYAGE_DIM}`,
            );
          }
          out.push(Float32Array.from(row.embedding));
        }
        return out;
      }
      if (res.status === 401 || res.status === 403) {
        throw new KnowledgeAuthError(
          `Voyage rejected credentials (HTTP ${res.status}) — check VOYAGE_API_KEY`,
        );
      }
      const retryable =
        res.status === 429 || (res.status >= 500 && res.status < 600);
      if (!retryable || attempt === maxRetries) {
        // Capture the response body so operator debugging isn't blind on
        // 4xx (validation errors, model-not-found, etc.). Per Stage 6
        // review item 9. Truncate at 200 chars; prefer Voyage's
        // structured `{ detail: "..." }` if parseable.
        let bodySnippet = "";
        try {
          const raw = await res.text();
          let detail: string | undefined;
          try {
            const parsed = JSON.parse(raw) as { detail?: unknown };
            if (typeof parsed.detail === "string") detail = parsed.detail;
          } catch {
            /* not JSON; fall through to raw */
          }
          const text = detail ?? raw;
          bodySnippet =
            text.length > 200 ? text.slice(0, 200) + "…" : text;
        } catch {
          /* body read failed; ignore */
        }
        const suffix = bodySnippet.length > 0 ? ` — ${bodySnippet}` : "";
        throw new KnowledgeEmbeddingError(
          `Voyage embed failed: HTTP ${lastStatus}${suffix}`,
        );
      }
      const backoff = backoffBaseMs * 2 ** attempt;
      await sleep(backoff);
      attempt++;
    }
    throw new KnowledgeEmbeddingError(
      `Voyage embed retries exhausted (status=${lastStatus})`,
    );
  }

  return {
    async embed(
      texts: string[],
      input_type: "document" | "query" = "document",
    ): Promise<Float32Array[]> {
      const out: Float32Array[] = [];
      for (let i = 0; i < texts.length; i += maxBatch) {
        const slice = texts.slice(i, i + maxBatch);
        const vecs = await embedBatch(slice, input_type);
        for (const v of vecs) out.push(v);
      }
      return out;
    },
  };
}
