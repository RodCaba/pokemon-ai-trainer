/**
 * Thin Voyage AI embedding client. Direct `fetch` (no SDK). Batches up to 64
 * inputs per request; retries 429/5xx with exp backoff; hard fails on 401/403.
 *
 * Stage 4 stub: throws `not implemented (Stage 5)`.
 */

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
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function createEmbedClient(opts: EmbedClientOptions): EmbedClient {
  return {
    embed(
      _texts: string[],
      _input_type?: "document" | "query",
    ): Promise<Float32Array[]> {
      throw new Error("not implemented (Stage 5)");
    },
  };
}
