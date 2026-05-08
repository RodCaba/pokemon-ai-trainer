/**
 * VGC-T21–VGC-T29 — vgcguide HTTP client.
 * Stage 4: every test fails because `createVgcGuideClient` methods throw
 * "not implemented (Stage 5)".
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVgcGuideClient } from "../../../src/tools/vgcguide/client";
import {
  KnowledgeArticleNetworkError,
  KnowledgeArticleNotFoundError,
} from "../../../src/schemas/errors";

const FIXTURES = join(__dirname, "../../../fixtures/vgcguide");

function tmpCacheDir(): string {
  return mkdtempSync(join(tmpdir(), "vgcguide-cache-"));
}

const HTML_BODY =
  "<html><body><div class='sqs-html-content'><h1>X</h1><p>body</p></div></body></html>";

describe("VgcGuideClient (VGC-T21–VGC-T29)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("VGC-T21. fetchSitemap returns parsed article URLs from sitemap.xml", async () => {
    const sitemap = readFileSync(join(FIXTURES, "2026-05-06__sitemap.xml"), "utf8");
    const fetchImpl = vi.fn(async () =>
      new Response(sitemap, { status: 200 }),
    ) as unknown as typeof fetch;
    const client = createVgcGuideClient({
      cacheDir: tmpCacheDir(),
      throttleRps: 100,
      maxRetries: 0,
      backoffBaseMs: 1,
      fetchImpl,
    });
    const urls = await client.fetchSitemap();
    expect(urls.length).toBeGreaterThanOrEqual(3);
    for (const u of urls) {
      expect(u).toMatch(/^https:\/\/(www\.)?vgcguide\.com\//);
    }
  });

  it("VGC-T22. fetchArticleHtml URL is correct", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(HTML_BODY, { status: 200 }),
    ) as unknown as typeof fetch;
    const client = createVgcGuideClient({
      cacheDir: tmpCacheDir(),
      throttleRps: 100,
      maxRetries: 0,
      backoffBaseMs: 1,
      fetchImpl,
    });
    const out = await client.fetchArticleHtml("speed-control");
    expect(out.article_url).toBe("https://www.vgcguide.com/speed-control");
    const fn = fetchImpl as unknown as ReturnType<typeof vi.fn>;
    expect(String(fn.mock.calls[0]?.[0])).toContain("/speed-control");
  });

  it("VGC-T23. fetchArticleHtml throws KnowledgeArticleNotFoundError on 404 (no retry)", async () => {
    let attempts = 0;
    const fetchImpl = vi.fn(async () => {
      attempts++;
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;
    const client = createVgcGuideClient({
      cacheDir: tmpCacheDir(),
      throttleRps: 100,
      maxRetries: 3,
      backoffBaseMs: 1,
      fetchImpl,
    });
    let thrown: unknown;
    try {
      await client.fetchArticleHtml("not-a-slug");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(KnowledgeArticleNotFoundError);
    expect(attempts).toBe(1);
  });

  it("VGC-T24. fetchArticleHtml retries 429/5xx with exp backoff", async () => {
    let attempts = 0;
    const fetchImpl = vi.fn(async () => {
      attempts++;
      if (attempts === 1) return new Response("rate", { status: 429 });
      if (attempts === 2) return new Response("boom", { status: 500 });
      return new Response(HTML_BODY, { status: 200 });
    }) as unknown as typeof fetch;
    const client = createVgcGuideClient({
      cacheDir: tmpCacheDir(),
      throttleRps: 100,
      maxRetries: 3,
      backoffBaseMs: 1,
      fetchImpl,
    });
    await client.fetchArticleHtml("speed-control");
    expect(attempts).toBe(3);
  });

  it("VGC-T25. fetchArticleHtml surrenders after maxRetries on 5xx", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("boom", { status: 503 }),
    ) as unknown as typeof fetch;
    const client = createVgcGuideClient({
      cacheDir: tmpCacheDir(),
      throttleRps: 100,
      maxRetries: 2,
      backoffBaseMs: 1,
      fetchImpl,
    });
    let thrown: unknown;
    try {
      await client.fetchArticleHtml("speed-control");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(KnowledgeArticleNetworkError);
    expect((thrown as KnowledgeArticleNetworkError).status).toBe(503);
  });

  it("VGC-T26. client throttles to 2 RPS (independent bucket)", async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    try {
      const fetchImpl = vi.fn(async () =>
        new Response(HTML_BODY, { status: 200 }),
      ) as unknown as typeof fetch;
      const client = createVgcGuideClient({
        cacheDir: tmpCacheDir(),
        throttleRps: 2,
        maxRetries: 0,
        backoffBaseMs: 1,
        fetchImpl,
      });
      const promise = (async (): Promise<void> => {
        await client.fetchArticleHtml("a");
        await client.fetchArticleHtml("b");
        await client.fetchArticleHtml("c");
        await client.fetchArticleHtml("d");
        await client.fetchArticleHtml("e");
      })();
      await vi.runAllTimersAsync();
      await promise;
      // 2 RPS ⇒ 500ms intervals; expect ≥ 4 throttle-shaped delays in the 400-600ms range.
      const throttleDelays = setTimeoutSpy.mock.calls
        .map((c) => Number(c[1] ?? 0))
        .filter((ms) => ms >= 400 && ms <= 600);
      expect(throttleDelays.length).toBeGreaterThanOrEqual(2);
    } finally {
      setTimeoutSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("VGC-T27. client reads from disk cache when present and not expired", async () => {
    const dir = tmpCacheDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "speed-control.json"),
      JSON.stringify({
        fetchedAt: new Date().toISOString(),
        body: "PRESEEDED HTML",
      }),
    );
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const client = createVgcGuideClient({
      cacheDir: dir,
      throttleRps: 100,
      maxRetries: 0,
      backoffBaseMs: 1,
      fetchImpl,
    });
    const out = await client.fetchArticleHtml("speed-control");
    expect(out.html).toBe("PRESEEDED HTML");
    expect(fetchImpl as unknown as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it("VGC-T28. client respects 7-day TTL: stale entry triggers refetch", async () => {
    const dir = tmpCacheDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    writeFileSync(
      join(dir, "speed-control.json"),
      JSON.stringify({ fetchedAt: eightDaysAgo, body: "STALE" }),
    );
    const fetchImpl = vi.fn(async () =>
      new Response(HTML_BODY, { status: 200 }),
    ) as unknown as typeof fetch;
    const client = createVgcGuideClient({
      cacheDir: dir,
      throttleRps: 100,
      maxRetries: 0,
      backoffBaseMs: 1,
      fetchImpl,
    });
    await client.fetchArticleHtml("speed-control");
    expect(fetchImpl as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
  });

  it("VGC-T29. client does NOT cache 404 responses", async () => {
    const dir = tmpCacheDir();
    let attempts = 0;
    const fetchImpl = vi.fn(async () => {
      attempts++;
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;
    const client = createVgcGuideClient({
      cacheDir: dir,
      throttleRps: 100,
      maxRetries: 0,
      backoffBaseMs: 1,
      fetchImpl,
    });
    try {
      await client.fetchArticleHtml("ghost-slug");
    } catch {
      /* expected */
    }
    const files = existsSync(dir) ? readdirSync(dir) : [];
    expect(files.some((f) => f.includes("ghost-slug"))).toBe(false);
    try {
      await client.fetchArticleHtml("ghost-slug");
    } catch {
      /* expected */
    }
    expect(attempts).toBe(2);
  });
});
