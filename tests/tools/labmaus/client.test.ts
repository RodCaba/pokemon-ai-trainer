/**
 * Tests T19–T24 for the `LabmausClient`. Stage 4: tests fail at assertion time
 * because every client method throws "not implemented (Stage 5)".
 */

import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLabmausClient } from "../../../src/tools/labmaus/client";
import { LabmausNetworkError } from "../../../src/schemas/errors";

function tmpCacheDir(): string {
  return mkdtempSync(join(tmpdir(), "labmaus-cache-"));
}

describe("LabmausClient", () => {
  it("T19. listCompletedTournaments URL-encodes regulation correctly", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify([]), { status: 200 }),
    ) as unknown as typeof fetch;
    const client = createLabmausClient({
      cacheDir: tmpCacheDir(),
      cacheTtlMs: 60_000,
      throttleRps: 1,
      maxRetries: 0,
      backoffBaseMs: 1,
      fetchImpl,
    });
    await client.listCompletedTournaments({
      regulation: "Regulation Set M-A",
      from: "2026-04-06",
      to: "2026-05-04",
    });
    const fn = fetchImpl as unknown as ReturnType<typeof vi.fn>;
    expect(fn).toHaveBeenCalledTimes(1);
    const calledUrl = String(fn.mock.calls[0]?.[0]);
    // Either '+' or '%20' for spaces is acceptable; key invariant is that the
    // regulation string is correctly URL-encoded (no raw spaces).
    expect(calledUrl).toMatch(/regulation=Regulation(\+|%20)Set(\+|%20)M-A/);
    expect(calledUrl).not.toMatch(/regulation=Regulation Set M-A/);
  });

  it("T20. client throttles to 1 rps", async () => {
    // With a fixed simulated clock at t=0, the token bucket must still reserve
    // future slots: after three calls at 1 rps, `nextAllowedAt` is ≥ 2000ms.
    const clock = (): number => 0;
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify([]), { status: 200 }),
    ) as unknown as typeof fetch;
    const client = createLabmausClient({
      cacheDir: tmpCacheDir(),
      cacheTtlMs: 0,
      throttleRps: 1,
      maxRetries: 0,
      backoffBaseMs: 1,
      fetchImpl,
      clock,
    });
    await client.listCompletedTournaments({ regulation: "x", from: "2026-04-06", to: "2026-04-07" });
    await client.listCompletedTournaments({ regulation: "x", from: "2026-04-06", to: "2026-04-07" });
    await client.listCompletedTournaments({ regulation: "x", from: "2026-04-06", to: "2026-04-07" });
    expect(client.nextAllowedAt()).toBeGreaterThanOrEqual(2000);
  });

  it("T21. client retries 429 with exponential backoff", async () => {
    let attempts = 0;
    const fetchImpl = vi.fn(async () => {
      attempts++;
      if (attempts < 3) return new Response("rate", { status: 429 });
      return new Response(JSON.stringify({}), { status: 200 });
    }) as unknown as typeof fetch;
    const client = createLabmausClient({
      cacheDir: tmpCacheDir(),
      cacheTtlMs: 0,
      throttleRps: 100,
      maxRetries: 3,
      backoffBaseMs: 1,
      fetchImpl,
    });
    await client.getTournament({ id: 56757 });
    expect(attempts).toBe(3);
  });

  it("T22. client surrenders after maxRetries on 5xx", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("boom", { status: 503 }),
    ) as unknown as typeof fetch;
    const client = createLabmausClient({
      cacheDir: tmpCacheDir(),
      cacheTtlMs: 0,
      throttleRps: 100,
      maxRetries: 2,
      backoffBaseMs: 1,
      fetchImpl,
    });
    let thrown: unknown;
    try {
      await client.getTournament({ id: 56757 });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(LabmausNetworkError);
  });

  it("T23. client reads from disk cache when fresh", async () => {
    const dir = tmpCacheDir();
    // Pre-seed a cache file with the "expected" payload. The exact key shape is
    // a Stage-5 implementation detail; the test asserts behavior: when a fresh
    // cache hit exists, fetch must NOT be called.
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "preseed.json"),
      JSON.stringify({
        key: "tournament/56757",
        args: { id: 56757 },
        fetchedAt: new Date().toISOString(),
        body: { overview: { id: 56757 } },
      }),
    );
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const client = createLabmausClient({
      cacheDir: dir,
      cacheTtlMs: 24 * 60 * 60 * 1000,
      throttleRps: 1,
      maxRetries: 0,
      backoffBaseMs: 1,
      fetchImpl,
    });
    const out = await client.getTournament({ id: 56757 });
    expect((out as { overview?: { id?: number } }).overview?.id).toBe(56757);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("T24. client writes to disk cache after fetch", async () => {
    const dir = tmpCacheDir();
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ overview: { id: 56757 } }), { status: 200 }),
    ) as unknown as typeof fetch;
    const client = createLabmausClient({
      cacheDir: dir,
      cacheTtlMs: 24 * 60 * 60 * 1000,
      throttleRps: 100,
      maxRetries: 0,
      backoffBaseMs: 1,
      fetchImpl,
    });
    await client.getTournament({ id: 56757 });
    // After Stage 5 wires the cache, *some* file should appear in the dir.
    const { readdirSync } = await import("node:fs");
    const files = readdirSync(dir);
    expect(files.length).toBeGreaterThan(0);
  });
});
