/**
 * VGC-T55–VGC-T61 — `scripts/data/ingest-vgcguide.ts` orchestration.
 *
 * Per Stage 6 review item 2, T55–T58 capture stdout and inspect the
 * run-summary JSON; per item 4, T61 shares a temp file DB across two
 * `main()` calls (the prior `:memory:` form required a process-level
 * cache shim that has since been deleted).
 */

import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../../scripts/data/ingest-vgcguide";
import type { VgcGuideClient } from "../../src/tools/vgcguide/client";
import type { EmbedClient } from "../../src/tools/knowledge/embed";
import {
  KnowledgeAuthError,
  KnowledgeEmbeddingError,
  KnowledgeStorageError,
} from "../../src/schemas/errors";

const FIXTURES = join(__dirname, "../../fixtures/vgcguide");
const DIM = 512;

const SLUGS = [
  "what-is-pokemon-showdown",
  "typing",
  "predictions",
];
/**
 * Synthetic scope injected via `MainDeps.scope` to bypass the live
 * `discoverScope(client)` call (which would fetch /intro, /teambuilding,
 * /battling — slugs the mock client doesn't serve). Tests need only the 3
 * fixture articles in scope.
 */
const TEST_SCOPE = new Set(SLUGS);
const FIXTURE_FILES: Record<string, string> = {
  "what-is-pokemon-showdown": "2026-05-06__intro__what-is-pokemon-showdown.html",
  typing: "2026-05-06__teambuilding__typing.html",
  predictions: "2026-05-06__battling__predictions.html",
};

function makeFakeClient(opts: {
  notFound?: string[];
  badHtml?: string[];
} = {}): VgcGuideClient {
  return {
    async fetchSitemap() {
      return SLUGS.map((s) => `https://www.vgcguide.com/${s}`);
    },
    async fetchArticleHtml(slug) {
      if (opts.notFound?.includes(slug)) {
        const { VgcGuideNotFoundError } = await import("../../src/schemas/errors");
        throw new VgcGuideNotFoundError(`404: ${slug}`, { article_slug: slug });
      }
      if (opts.badHtml?.includes(slug)) {
        return {
          slug,
          html: "<html><body>no sqs container</body></html>",
          article_url: `https://www.vgcguide.com/${slug}`,
          fetched_at: "2026-05-06T00:00:00Z",
        };
      }
      const html = readFileSync(join(FIXTURES, FIXTURE_FILES[slug]!), "utf8");
      return {
        slug,
        html,
        article_url: `https://www.vgcguide.com/${slug}`,
        fetched_at: "2026-05-06T00:00:00Z",
      };
    },
  };
}

function makeFakeEmbed(opts: { fail?: string } = {}): EmbedClient {
  return {
    embed: vi.fn(async (texts) => {
      if (opts.fail === "embedding") {
        throw new KnowledgeEmbeddingError("synthetic embedding failure");
      }
      if (opts.fail === "auth") {
        throw new KnowledgeAuthError("synthetic auth failure");
      }
      if (opts.fail === "storage") {
        throw new KnowledgeStorageError("synthetic storage failure");
      }
      return texts.map((_, i) => {
        const v = new Float32Array(DIM);
        for (let j = 0; j < DIM; j++) v[j] = ((i * 31 + j) % 17) / 17;
        return v;
      });
    }),
  };
}

interface RunSummary {
  ok: true;
  articles_fetched: number;
  articles_skipped_unchanged: number;
  chunks_inserted: number;
  chunks_re_embedded: number;
  embedding_failures: Array<{ slug: string; message: string }>;
  network_failures: Array<{ slug: string; status?: number; message: string }>;
  parse_failures: Array<{ slug: string; message: string }>;
  not_found: string[];
}

/**
 * Capture `process.stdout.write` invocations into a buffer and parse
 * the trailing JSON line as the run summary. Per Stage 6 review item 2,
 * the failure-mode tests must inspect the summary, not just exit code.
 */
function captureStdout(): { buffer: string[]; restore: () => void } {
  const buffer: string[] = [];
  const spy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: unknown) => {
      buffer.push(typeof chunk === "string" ? chunk : String(chunk));
      return true;
    });
  return {
    buffer,
    restore: () => spy.mockRestore(),
  };
}

function parseSummary(buffer: string[]): RunSummary {
  const joined = buffer.join("");
  // The summary line is the JSON-encoded RunSummary terminated by \n.
  const lines = joined.split("\n").filter((l) => l.trim().length > 0);
  const last = lines[lines.length - 1];
  if (last === undefined) {
    throw new Error("no stdout output captured");
  }
  return JSON.parse(last) as RunSummary;
}

describe("ingest-vgcguide (VGC-T55–VGC-T61)", () => {
  // Suppress per-article stderr lines in test output.
  let stderrSpy: { mockRestore: () => void } | null = null;
  beforeEach(() => {
    stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
  });
  afterEach(() => {
    stderrSpy?.mockRestore();
    stderrSpy = null;
  });

  it("VGC-T55. --no-network runs end-to-end on cached fixtures (3 articles)", async () => {
    const cap = captureStdout();
    try {
      const exit = await main(
        ["--no-network", "--db", ":memory:"],
        { client: makeFakeClient(), embedClient: makeFakeEmbed(), scope: TEST_SCOPE },
      );
      expect(exit).toBe(0);
      const summary = parseSummary(cap.buffer);
      expect(summary.articles_fetched).toBe(3);
      expect(summary.chunks_inserted).toBeGreaterThan(0);
      expect(summary.not_found).toEqual([]);
      expect(summary.parse_failures).toEqual([]);
      expect(summary.embedding_failures).toEqual([]);
    } finally {
      cap.restore();
    }
  });

  it("VGC-T56. logs not_found on 404 article", async () => {
    const cap = captureStdout();
    try {
      const exit = await main(
        ["--no-network", "--db", ":memory:"],
        {
          client: makeFakeClient({ notFound: ["typing"] }),
          embedClient: makeFakeEmbed(),
          scope: TEST_SCOPE,
        },
      );
      expect(exit).toBe(0);
      const summary = parseSummary(cap.buffer);
      expect(summary.not_found).toContain("typing");
    } finally {
      cap.restore();
    }
  });

  it("VGC-T57. logs parse_failures on bad HTML", async () => {
    const cap = captureStdout();
    try {
      const exit = await main(
        ["--no-network", "--db", ":memory:"],
        {
          client: makeFakeClient({ badHtml: ["typing"] }),
          embedClient: makeFakeEmbed(),
          scope: TEST_SCOPE,
        },
      );
      expect(exit).toBe(0);
      const summary = parseSummary(cap.buffer);
      expect(summary.parse_failures.map((f) => f.slug)).toContain("typing");
    } finally {
      cap.restore();
    }
  });

  it("VGC-T58. logs embedding_failures on Voyage retry exhaustion (per article)", async () => {
    const cap = captureStdout();
    try {
      const exit = await main(
        ["--no-network", "--db", ":memory:"],
        {
          client: makeFakeClient(),
          embedClient: makeFakeEmbed({ fail: "embedding" }),
          scope: TEST_SCOPE,
        },
      );
      // exit 0 because per-article failures are bounded; ingest continues.
      expect(exit).toBe(0);
      const summary = parseSummary(cap.buffer);
      const failedSlugs = summary.embedding_failures.map((f) => f.slug);
      // Every article hit the synthetic embed failure.
      for (const slug of SLUGS) {
        expect(failedSlugs).toContain(slug);
      }
    } finally {
      cap.restore();
    }
  });

  it("VGC-T59. fails loud on KnowledgeAuthError", async () => {
    // Stage 5 contract: ingest must not swallow KnowledgeAuthError. Either
    // exit nonzero (the script catches at top-level and returns 1) OR
    // propagate the same KnowledgeAuthError class. Catching it as a generic
    // Error is not enough.
    let exit = 0;
    let thrown: unknown;
    try {
      exit = await main(
        ["--no-network", "--db", ":memory:"],
        {
          client: makeFakeClient(),
          embedClient: makeFakeEmbed({ fail: "auth" }),
          scope: TEST_SCOPE,
        },
      );
    } catch (e) {
      thrown = e;
    }
    const propagatedAuth = thrown instanceof KnowledgeAuthError;
    expect(exit === 1 || propagatedAuth).toBe(true);
  });

  it("VGC-T60. fails loud on KnowledgeStorageError", async () => {
    // Stage 5 contract: ingest must not swallow KnowledgeStorageError.
    let exit = 0;
    let thrown: unknown;
    try {
      exit = await main(
        ["--no-network", "--db", ":memory:"],
        {
          client: makeFakeClient(),
          embedClient: makeFakeEmbed({ fail: "storage" }),
          scope: TEST_SCOPE,
        },
      );
    } catch (e) {
      thrown = e;
    }
    const propagatedStorage = thrown instanceof KnowledgeStorageError;
    expect(exit === 1 || propagatedStorage).toBe(true);
  });

  it("VGC-T61. skip-existing on body_hash: rerunning produces zero embedding API calls", async () => {
    // Per Stage 6 review item 4: share a *file* DB across two main() calls
    // so the persisted body_hash is the only source of truth. The previous
    // `:memory:` form needed a process-level cache shim, which has since
    // been deleted.
    const dir = mkdtempSync(join(tmpdir(), "vgcguide-t61-"));
    const dbPath = join(dir, "db.sqlite");
    try {
      const embed1 = makeFakeEmbed();
      const embed2 = makeFakeEmbed();
      const cap = captureStdout();
      try {
        await main(["--no-network", "--db", dbPath], {
          client: makeFakeClient(),
          embedClient: embed1,
          scope: TEST_SCOPE,
        });
        await main(["--no-network", "--db", dbPath], {
          client: makeFakeClient(),
          embedClient: embed2,
          scope: TEST_SCOPE,
        });
      } finally {
        cap.restore();
      }
      // First run embedded; second run: body_hash matches → zero calls.
      const fn1 = embed1.embed as unknown as ReturnType<typeof vi.fn>;
      const fn2 = embed2.embed as unknown as ReturnType<typeof vi.fn>;
      expect(fn1).toHaveBeenCalled();
      expect(fn2).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
