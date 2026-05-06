/**
 * Tests T18–T25 for `PokepasteClient`. Stage 4: every test fails because
 * `createPokepasteClient` throws "not implemented (Stage 5)".
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPokepasteClient } from "../../../src/tools/pokepaste/client";
import {
  PokepasteNetworkError,
  PokepasteNotFoundError,
} from "../../../src/schemas/errors";

function tmpCacheDir(): string {
  return mkdtempSync(join(tmpdir(), "pokepaste-cache-"));
}

describe("PokepasteClient", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("T18. fetchRaw URL is correct (https://pokepast.es/<id>/raw)", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("Charizard @ Charizardite Y\n", { status: 200 }),
    ) as unknown as typeof fetch;
    const client = createPokepasteClient({
      cacheDir: tmpCacheDir(),
      throttleRps: 100,
      maxRetries: 0,
      backoffBaseMs: 1,
      fetchImpl,
    });
    await client.fetchRaw("7205bf28f85d1e79");
    const fn = fetchImpl as unknown as ReturnType<typeof vi.fn>;
    expect(fn).toHaveBeenCalledTimes(1);
    expect(String(fn.mock.calls[0]?.[0])).toBe(
      "https://pokepast.es/7205bf28f85d1e79/raw",
    );
  });

  it("T19. fetchRaw throws PokepasteNotFoundError on 404 (no retry)", async () => {
    let attempts = 0;
    const fetchImpl = vi.fn(async () => {
      attempts++;
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;
    const client = createPokepasteClient({
      cacheDir: tmpCacheDir(),
      throttleRps: 100,
      maxRetries: 3,
      backoffBaseMs: 1,
      fetchImpl,
    });
    let thrown: unknown;
    try {
      await client.fetchRaw("0000000000000000");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(PokepasteNotFoundError);
    expect(attempts).toBe(1);
  });

  it("T20. fetchRaw retries 429/5xx with exp backoff", async () => {
    let attempts = 0;
    const fetchImpl = vi.fn(async () => {
      attempts++;
      if (attempts < 3) return new Response("rate", { status: 429 });
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;
    const client = createPokepasteClient({
      cacheDir: tmpCacheDir(),
      throttleRps: 100,
      maxRetries: 3,
      backoffBaseMs: 1,
      fetchImpl,
    });
    await client.fetchRaw("7205bf28f85d1e79");
    expect(attempts).toBe(3);
  });

  it("T21. fetchRaw surrenders after maxRetries on 5xx", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("boom", { status: 503 }),
    ) as unknown as typeof fetch;
    const client = createPokepasteClient({
      cacheDir: tmpCacheDir(),
      throttleRps: 100,
      maxRetries: 2,
      backoffBaseMs: 1,
      fetchImpl,
    });
    let thrown: unknown;
    try {
      await client.fetchRaw("7205bf28f85d1e79");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(PokepasteNetworkError);
  });

  it("T22. client throttles to its own (2 rps) bucket independently", async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    try {
      const fetchImpl = vi.fn(async () =>
        new Response("ok", { status: 200 }),
      ) as unknown as typeof fetch;
      const client = createPokepasteClient({
        cacheDir: tmpCacheDir(),
        throttleRps: 2,
        maxRetries: 0,
        backoffBaseMs: 1,
        fetchImpl,
      });
      const promise = (async (): Promise<void> => {
        await client.fetchRaw("aaaaaaaaaaaaaaaa");
        await client.fetchRaw("bbbbbbbbbbbbbbbb");
        await client.fetchRaw("cccccccccccccccc");
      })();
      await vi.runAllTimersAsync();
      await promise;
      // 2 rps ⇒ 500ms intervals; expect at least two waits ≥ ~400ms.
      const throttleDelays = setTimeoutSpy.mock.calls
        .map((c) => Number(c[1] ?? 0))
        .filter((ms) => ms >= 400);
      expect(throttleDelays.length).toBeGreaterThanOrEqual(2);
    } finally {
      setTimeoutSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("T23. client reads from disk cache when present (no expiry)", async () => {
    const dir = tmpCacheDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    // Pre-seed using the canonical content-addressed filename `<paste_id>.txt`.
    writeFileSync(join(dir, "7205bf28f85d1e79.txt"), "PRESEEDED PASTE BODY");
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const client = createPokepasteClient({
      cacheDir: dir,
      throttleRps: 100,
      maxRetries: 0,
      backoffBaseMs: 1,
      fetchImpl,
    });
    const out = await client.fetchRaw("7205bf28f85d1e79");
    expect(out).toBe("PRESEEDED PASTE BODY");
    expect(fetchImpl as unknown as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it("T24. client writes to disk cache after a 200 fetch", async () => {
    const dir = tmpCacheDir();
    const fetchImpl = vi.fn(async () =>
      new Response("Charizard @ Charizardite Y\n", { status: 200 }),
    ) as unknown as typeof fetch;
    const client = createPokepasteClient({
      cacheDir: dir,
      throttleRps: 100,
      maxRetries: 0,
      backoffBaseMs: 1,
      fetchImpl,
    });
    await client.fetchRaw("7205bf28f85d1e79");
    const files = readdirSync(dir);
    expect(files.some((f) => f.includes("7205bf28f85d1e79"))).toBe(true);
  });

  it("T25. client does NOT cache 404 responses", async () => {
    const dir = tmpCacheDir();
    let attempts = 0;
    const fetchImpl = vi.fn(async () => {
      attempts++;
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;
    const client = createPokepasteClient({
      cacheDir: dir,
      throttleRps: 100,
      maxRetries: 0,
      backoffBaseMs: 1,
      fetchImpl,
    });
    try {
      await client.fetchRaw("0000000000000000");
    } catch {
      /* expected */
    }
    // No cache file should exist for the 404.
    const files = existsSync(dir) ? readdirSync(dir) : [];
    expect(files.some((f) => f.includes("0000000000000000"))).toBe(false);
    // A second call hits the network again.
    try {
      await client.fetchRaw("0000000000000000");
    } catch {
      /* expected */
    }
    expect(attempts).toBe(2);
  });
});
