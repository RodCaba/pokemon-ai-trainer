/**
 * PIKA-T20–PIKA-T28 — pikalytics HTTP client.
 * Stage 4: every test fails because `createPikalyticsClient`'s
 * `fetchSpeciesMarkdown` throws "not implemented (Stage 5)".
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPikalyticsClient } from "../../../src/tools/pikalytics/client";
import {
  PikalyticsNetworkError,
  PikalyticsNotFoundError,
} from "../../../src/schemas/errors";

function tmpCacheDir(): string {
  return mkdtempSync(join(tmpdir(), "pikalytics-cache-"));
}

const MD_BODY =
  "# Garchomp\n| **Data Date** | 2026-04 |\n## Common Teammates\n- **Sneasler**: 46.767%\n";

describe("PikalyticsClient (PIKA-T20–PIKA-T28)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("PIKA-T20. fetchSpeciesMarkdown URL is correct", async () => {
    const fetchImpl = vi.fn(async () => new Response(MD_BODY, { status: 200 })) as unknown as typeof fetch;
    const client = createPikalyticsClient({
      cacheDir: tmpCacheDir(),
      throttleRps: 100,
      maxRetries: 0,
      backoffBaseMs: 1,
      fetchImpl,
    });
    await client.fetchSpeciesMarkdown("garchomp");
    const fn = fetchImpl as unknown as ReturnType<typeof vi.fn>;
    expect(fn).toHaveBeenCalledTimes(1);
    expect(String(fn.mock.calls[0]?.[0])).toBe(
      "https://www.pikalytics.com/ai/pokedex/gen9championsvgc2026regma/garchomp",
    );
  });

  it("PIKA-T21. fetchSpeciesMarkdown returns both source_url (human) and ai_url (machine)", async () => {
    const fetchImpl = vi.fn(async () => new Response(MD_BODY, { status: 200 })) as unknown as typeof fetch;
    const client = createPikalyticsClient({
      cacheDir: tmpCacheDir(),
      throttleRps: 100,
      maxRetries: 0,
      backoffBaseMs: 1,
      fetchImpl,
    });
    const out = await client.fetchSpeciesMarkdown("garchomp");
    expect(out.source_url).toBe(
      "https://www.pikalytics.com/pokedex/gen9championsvgc2026regma/garchomp",
    );
    expect(out.ai_url).toBe(
      "https://www.pikalytics.com/ai/pokedex/gen9championsvgc2026regma/garchomp",
    );
    expect(out.body).toBe(MD_BODY);
  });

  it("PIKA-T22. fetchSpeciesMarkdown throws PikalyticsNotFoundError on 404 (no retry)", async () => {
    let attempts = 0;
    const fetchImpl = vi.fn(async () => {
      attempts++;
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;
    const client = createPikalyticsClient({
      cacheDir: tmpCacheDir(),
      throttleRps: 100,
      maxRetries: 3,
      backoffBaseMs: 1,
      fetchImpl,
    });
    let thrown: unknown;
    try {
      await client.fetchSpeciesMarkdown("not-a-species");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(PikalyticsNotFoundError);
    expect(attempts).toBe(1);
  });

  it("PIKA-T23. fetchSpeciesMarkdown retries 429/5xx with exp backoff", async () => {
    let attempts = 0;
    const fetchImpl = vi.fn(async () => {
      attempts++;
      if (attempts < 3) return new Response("rate", { status: 429 });
      return new Response(MD_BODY, { status: 200 });
    }) as unknown as typeof fetch;
    const client = createPikalyticsClient({
      cacheDir: tmpCacheDir(),
      throttleRps: 100,
      maxRetries: 3,
      backoffBaseMs: 1,
      fetchImpl,
    });
    await client.fetchSpeciesMarkdown("garchomp");
    expect(attempts).toBe(3);
  });

  it("PIKA-T24. fetchSpeciesMarkdown surrenders after maxRetries on 5xx", async () => {
    const fetchImpl = vi.fn(async () => new Response("boom", { status: 503 })) as unknown as typeof fetch;
    const client = createPikalyticsClient({
      cacheDir: tmpCacheDir(),
      throttleRps: 100,
      maxRetries: 2,
      backoffBaseMs: 1,
      fetchImpl,
    });
    let thrown: unknown;
    try {
      await client.fetchSpeciesMarkdown("garchomp");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(PikalyticsNetworkError);
  });

  it("PIKA-T25. client throttles to its own (1 rps) bucket independently", async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    try {
      const fetchImpl = vi.fn(async () => new Response(MD_BODY, { status: 200 })) as unknown as typeof fetch;
      const client = createPikalyticsClient({
        cacheDir: tmpCacheDir(),
        throttleRps: 1,
        maxRetries: 0,
        backoffBaseMs: 1,
        fetchImpl,
      });
      const promise = (async (): Promise<void> => {
        await client.fetchSpeciesMarkdown("a");
        await client.fetchSpeciesMarkdown("b");
        await client.fetchSpeciesMarkdown("c");
      })();
      await vi.runAllTimersAsync();
      await promise;
      // 1 rps ⇒ 1000ms intervals; expect at least two waits ≥ ~900ms.
      const throttleDelays = setTimeoutSpy.mock.calls
        .map((c) => Number(c[1] ?? 0))
        .filter((ms) => ms >= 900);
      expect(throttleDelays.length).toBeGreaterThanOrEqual(2);
    } finally {
      setTimeoutSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("PIKA-T26. client reads from disk cache when present (no expiry)", async () => {
    const dir = tmpCacheDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "garchomp.json"),
      JSON.stringify({
        fetchedAt: new Date().toISOString(),
        body: "PRESEEDED PIKA BODY",
      }),
    );
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const client = createPikalyticsClient({
      cacheDir: dir,
      throttleRps: 100,
      maxRetries: 0,
      backoffBaseMs: 1,
      fetchImpl,
    });
    const out = await client.fetchSpeciesMarkdown("garchomp");
    expect(out.body).toBe("PRESEEDED PIKA BODY");
    expect(fetchImpl as unknown as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it("PIKA-T27. client writes to disk cache after a 200 fetch", async () => {
    const dir = tmpCacheDir();
    const fetchImpl = vi.fn(async () => new Response(MD_BODY, { status: 200 })) as unknown as typeof fetch;
    const client = createPikalyticsClient({
      cacheDir: dir,
      throttleRps: 100,
      maxRetries: 0,
      backoffBaseMs: 1,
      fetchImpl,
    });
    await client.fetchSpeciesMarkdown("garchomp");
    const files = readdirSync(dir);
    expect(files.some((f) => f.includes("garchomp"))).toBe(true);
  });

  it("PIKA-T28. client does NOT cache 404 responses", async () => {
    const dir = tmpCacheDir();
    let attempts = 0;
    const fetchImpl = vi.fn(async () => {
      attempts++;
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;
    const client = createPikalyticsClient({
      cacheDir: dir,
      throttleRps: 100,
      maxRetries: 0,
      backoffBaseMs: 1,
      fetchImpl,
    });
    try {
      await client.fetchSpeciesMarkdown("ghostmon");
    } catch {
      /* expected */
    }
    const files = existsSync(dir) ? readdirSync(dir) : [];
    expect(files.some((f) => f.includes("ghostmon"))).toBe(false);
    try {
      await client.fetchSpeciesMarkdown("ghostmon");
    } catch {
      /* expected */
    }
    expect(attempts).toBe(2);
  });
});
