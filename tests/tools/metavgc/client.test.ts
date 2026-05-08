/**
 * META-T18..T28 — metavgc HTTP client.
 * Stage 4: every test fails because `createMetaVgcClient` methods throw
 * "not implemented (Stage 5)".
 */

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
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMetaVgcClient } from "../../../src/tools/metavgc/client";
import {
  KnowledgeArticleNetworkError,
  KnowledgeArticleNotFoundError,
} from "../../../src/schemas/errors";

const FIXTURES = join(__dirname, "../../../fixtures/metavgc");
const SITEMAP = readFileSync(
  join(FIXTURES, "2026-05-08__sitemap.xml"),
  "utf8",
);

function tmpCacheDir(): string {
  return mkdtempSync(join(tmpdir(), "metavgc-cache-"));
}

const HTML_BODY =
  "<html><body><article><h1>X</h1><p>body</p></article></body></html>";

describe("MetaVgcClient (META-T18..T28)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("META-T18. fetchSitemap parses the metavgc sitemap fixture into absolute URLs", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(SITEMAP, { status: 200 }),
    ) as unknown as typeof fetch;
    const client = createMetaVgcClient({
      cacheDir: tmpCacheDir(),
      throttleRps: 100,
      maxRetries: 0,
      backoffBaseMs: 1,
      fetchImpl,
    });
    const urls = await client.fetchSitemap();
    expect(urls.length).toBeGreaterThan(50);
    for (const u of urls) {
      expect(u).toMatch(/^https:\/\/metavgc\.com\//);
    }
  });

  it("META-T19. fetchSitemap hits https://metavgc.com/sitemap.xml", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(SITEMAP, { status: 200 }),
    ) as unknown as typeof fetch;
    const client = createMetaVgcClient({
      cacheDir: tmpCacheDir(),
      throttleRps: 100,
      maxRetries: 0,
      backoffBaseMs: 1,
      fetchImpl,
    });
    await client.fetchSitemap();
    const fn = fetchImpl as unknown as ReturnType<typeof vi.fn>;
    expect(String(fn.mock.calls[0]?.[0])).toBe(
      "https://metavgc.com/sitemap.xml",
    );
  });

  it("META-T20. fetchArticleHtml URL is canonical /guides/<slug>", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(HTML_BODY, { status: 200 }),
    ) as unknown as typeof fetch;
    const client = createMetaVgcClient({
      cacheDir: tmpCacheDir(),
      throttleRps: 100,
      maxRetries: 0,
      backoffBaseMs: 1,
      fetchImpl,
    });
    const out = await client.fetchArticleHtml(
      "how-to-counter-incineroar-pokemon-champions",
    );
    expect(out.article_url).toBe(
      "https://metavgc.com/guides/how-to-counter-incineroar-pokemon-champions",
    );
    const fn = fetchImpl as unknown as ReturnType<typeof vi.fn>;
    expect(String(fn.mock.calls[0]?.[0])).toContain(
      "/guides/how-to-counter-incineroar-pokemon-champions",
    );
  });

  it("META-T21. fetchArticleHtml sends a User-Agent identifying our crawler", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(HTML_BODY, { status: 200 }),
    ) as unknown as typeof fetch;
    const client = createMetaVgcClient({
      cacheDir: tmpCacheDir(),
      throttleRps: 100,
      maxRetries: 0,
      backoffBaseMs: 1,
      fetchImpl,
    });
    await client.fetchArticleHtml("getting-started-with-vgc");
    const fn = fetchImpl as unknown as ReturnType<typeof vi.fn>;
    const initArg = fn.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = (initArg?.headers ?? {}) as Record<string, string>;
    const ua = headers["User-Agent"] ?? headers["user-agent"];
    expect(typeof ua).toBe("string");
    expect(String(ua)).toMatch(/pokemon-ai-trainer/i);
  });

  it("META-T22. fetchArticleHtml throws KnowledgeArticleNotFoundError on 404 (no retry)", async () => {
    let attempts = 0;
    const fetchImpl = vi.fn(async () => {
      attempts++;
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;
    const client = createMetaVgcClient({
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

  it("META-T23. fetchArticleHtml retries 429/5xx with exp backoff", async () => {
    let attempts = 0;
    const fetchImpl = vi.fn(async () => {
      attempts++;
      if (attempts === 1) return new Response("rate", { status: 429 });
      if (attempts === 2) return new Response("boom", { status: 500 });
      return new Response(HTML_BODY, { status: 200 });
    }) as unknown as typeof fetch;
    const client = createMetaVgcClient({
      cacheDir: tmpCacheDir(),
      throttleRps: 100,
      maxRetries: 3,
      backoffBaseMs: 1,
      fetchImpl,
    });
    await client.fetchArticleHtml("getting-started-with-vgc");
    expect(attempts).toBe(3);
  });

  it("META-T24. fetchArticleHtml surrenders after maxRetries on 5xx", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("boom", { status: 503 }),
    ) as unknown as typeof fetch;
    const client = createMetaVgcClient({
      cacheDir: tmpCacheDir(),
      throttleRps: 100,
      maxRetries: 2,
      backoffBaseMs: 1,
      fetchImpl,
    });
    let thrown: unknown;
    try {
      await client.fetchArticleHtml("getting-started-with-vgc");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(KnowledgeArticleNetworkError);
    expect((thrown as KnowledgeArticleNetworkError).status).toBe(503);
  });

  it("META-T25. client throttles to 2 RPS (independent bucket)", async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    try {
      const fetchImpl = vi.fn(
        async () => new Response(HTML_BODY, { status: 200 }),
      ) as unknown as typeof fetch;
      const client = createMetaVgcClient({
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
      const throttleDelays = setTimeoutSpy.mock.calls
        .map((c) => Number(c[1] ?? 0))
        .filter((ms) => ms >= 400 && ms <= 600);
      expect(throttleDelays.length).toBeGreaterThanOrEqual(2);
    } finally {
      setTimeoutSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("META-T26. client reads from disk cache when present and not expired", async () => {
    const dir = tmpCacheDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(
        dir,
        "how-to-counter-incineroar-pokemon-champions.json",
      ),
      JSON.stringify({
        fetchedAt: new Date().toISOString(),
        body: "PRESEEDED HTML",
      }),
    );
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const client = createMetaVgcClient({
      cacheDir: dir,
      throttleRps: 100,
      maxRetries: 0,
      backoffBaseMs: 1,
      fetchImpl,
    });
    const out = await client.fetchArticleHtml(
      "how-to-counter-incineroar-pokemon-champions",
    );
    expect(out.html).toBe("PRESEEDED HTML");
    expect(
      fetchImpl as unknown as ReturnType<typeof vi.fn>,
    ).not.toHaveBeenCalled();
  });

  it("META-T27. client respects 7-day TTL: stale entry triggers refetch", async () => {
    const dir = tmpCacheDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const eightDaysAgo = new Date(
      Date.now() - 8 * 24 * 60 * 60 * 1000,
    ).toISOString();
    writeFileSync(
      join(dir, "getting-started-with-vgc.json"),
      JSON.stringify({ fetchedAt: eightDaysAgo, body: "STALE" }),
    );
    const fetchImpl = vi.fn(
      async () => new Response(HTML_BODY, { status: 200 }),
    ) as unknown as typeof fetch;
    const client = createMetaVgcClient({
      cacheDir: dir,
      throttleRps: 100,
      maxRetries: 0,
      backoffBaseMs: 1,
      fetchImpl,
    });
    await client.fetchArticleHtml("getting-started-with-vgc");
    expect(
      fetchImpl as unknown as ReturnType<typeof vi.fn>,
    ).toHaveBeenCalledTimes(1);
  });

  it("META-T28. client does NOT cache 404 responses", async () => {
    const dir = tmpCacheDir();
    let attempts = 0;
    const fetchImpl = vi.fn(async () => {
      attempts++;
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;
    const client = createMetaVgcClient({
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
