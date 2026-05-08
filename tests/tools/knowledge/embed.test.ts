/**
 * VGC-T30–VGC-T35 — Voyage embed client.
 * Stage 4: every test fails because `createEmbedClient.embed` throws
 * "not implemented (Stage 5)".
 */

import { describe, expect, it, vi } from "vitest";
import { createEmbedClient } from "../../../src/tools/knowledge/embed";
import {
  KnowledgeAuthError,
  KnowledgeEmbeddingError,
} from "../../../src/schemas/errors";

const DIM = 1024;

function makeVoyageOk(n: number): Response {
  const data = Array.from({ length: n }, (_, i) => ({
    embedding: Array.from({ length: DIM }, (_, j) => ((i * 31 + j) % 13) / 13),
    index: i,
  }));
  return new Response(
    JSON.stringify({ data, model: "voyage-3-lite", usage: { total_tokens: n * 5 } }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("EmbedClient (VGC-T30–VGC-T35)", () => {
  it("VGC-T30. returns 1024-dim vectors per input", async () => {
    const fetchImpl = vi.fn(async () => makeVoyageOk(5)) as unknown as typeof fetch;
    const client = createEmbedClient({
      apiKey: "vy_test",
      model: "voyage-3-lite",
      maxBatch: 64,
      maxRetries: 0,
      backoffBaseMs: 1,
      fetchImpl,
    });
    const out = await client.embed(["a", "b", "c", "d", "e"]);
    expect(out.length).toBe(5);
    for (const v of out) {
      expect(v).toBeInstanceOf(Float32Array);
      expect(v.length).toBe(DIM);
    }
  });

  it("VGC-T31. batches inputs of size > 64 into multiple calls", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async (_url, init) => {
      call++;
      const body = JSON.parse((init as RequestInit).body as string) as {
        input: string[];
      };
      return makeVoyageOk(body.input.length);
    }) as unknown as typeof fetch;
    const client = createEmbedClient({
      apiKey: "vy_test",
      model: "voyage-3-lite",
      maxBatch: 64,
      maxRetries: 0,
      backoffBaseMs: 1,
      fetchImpl,
    });
    const inputs = Array.from({ length: 130 }, (_, i) => `t${i}`);
    const out = await client.embed(inputs);
    expect(out.length).toBe(130);
    expect(call).toBe(3); // 64 + 64 + 2
  });

  it("VGC-T32. retries on 429 with exp backoff", async () => {
    let attempts = 0;
    const fetchImpl = vi.fn(async () => {
      attempts++;
      if (attempts === 1) return new Response("rate", { status: 429 });
      return makeVoyageOk(1);
    }) as unknown as typeof fetch;
    const client = createEmbedClient({
      apiKey: "vy_test",
      model: "voyage-3-lite",
      maxBatch: 64,
      maxRetries: 3,
      backoffBaseMs: 1,
      fetchImpl,
    });
    await client.embed(["one"]);
    expect(attempts).toBe(2);
  });

  it("VGC-T33. throws KnowledgeAuthError on 401 (no retry)", async () => {
    let attempts = 0;
    const fetchImpl = vi.fn(async () => {
      attempts++;
      return new Response("unauthorized", { status: 401 });
    }) as unknown as typeof fetch;
    const client = createEmbedClient({
      apiKey: "vy_test",
      model: "voyage-3-lite",
      maxBatch: 64,
      maxRetries: 3,
      backoffBaseMs: 1,
      fetchImpl,
    });
    let thrown: unknown;
    try {
      await client.embed(["one"]);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(KnowledgeAuthError);
    expect(attempts).toBe(1);
  });

  it("VGC-T34. throws KnowledgeAuthError when VOYAGE_API_KEY env unset", async () => {
    const fetchImpl = vi.fn(async () => makeVoyageOk(1)) as unknown as typeof fetch;
    const client = createEmbedClient({
      apiKey: "",
      model: "voyage-3-lite",
      maxBatch: 64,
      maxRetries: 0,
      backoffBaseMs: 1,
      fetchImpl,
    });
    let thrown: unknown;
    try {
      await client.embed(["one"]);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(KnowledgeAuthError);
  });

  it("VGC-T35. throws KnowledgeEmbeddingError after retry exhaustion on 5xx", async () => {
    let attempts = 0;
    const fetchImpl = vi.fn(async () => {
      attempts++;
      return new Response("boom", { status: 500 });
    }) as unknown as typeof fetch;
    const client = createEmbedClient({
      apiKey: "vy_test",
      model: "voyage-3-lite",
      maxBatch: 64,
      maxRetries: 3,
      backoffBaseMs: 1,
      fetchImpl,
    });
    let thrown: unknown;
    try {
      await client.embed(["one"]);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(KnowledgeEmbeddingError);
    // 1 initial + 3 retries = 4 attempts.
    expect(attempts).toBe(4);
  });
});
