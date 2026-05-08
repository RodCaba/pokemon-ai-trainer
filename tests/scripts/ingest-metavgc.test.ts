/**
 * META-T45..T48 — `scripts/data/ingest-metavgc.ts` orchestration.
 * Stage 4: every test fails because `main` throws "not implemented (Stage 5)".
 */

import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../../scripts/data/ingest-metavgc";
import type { KnowledgeArticleClient } from "../../src/tools/knowledge/article-client";
import type { EmbedClient } from "../../src/tools/knowledge/embed";
import {
  KnowledgeArticleNotFoundError,
  KnowledgeAuthError,
  KnowledgeEmbeddingError,
  KnowledgeStorageError,
} from "../../src/schemas/errors";

const FIXTURES = join(__dirname, "../../fixtures/metavgc");
const DIM = 512;

const SLUGS = [
  "how-to-counter-incineroar-pokemon-champions",
  "regulation-m-a-leads-opening-pokemon-champions",
  "anti-meta-underrated-megas-pokemon-champions-2026",
];
const TEST_SCOPE = new Set(SLUGS);
const FIXTURE_FILES: Record<string, string> = {
  "how-to-counter-incineroar-pokemon-champions":
    "2026-05-08__guides-incineroar-counters.html",
  "regulation-m-a-leads-opening-pokemon-champions":
    "2026-05-08__guides-leads-opening.html",
  "anti-meta-underrated-megas-pokemon-champions-2026":
    "2026-05-08__guides-anti-meta-megas.html",
};

function makeClient(opts: { notFound?: string[]; badHtml?: string[] } = {}): KnowledgeArticleClient {
  return {
    async fetchSitemap() {
      return SLUGS.map((s) => `https://metavgc.com/guides/${s}`);
    },
    async fetchArticleHtml(slug) {
      if (opts.notFound?.includes(slug)) {
        throw new KnowledgeArticleNotFoundError(`404: ${slug}`, {
          article_slug: slug,
        });
      }
      if (opts.badHtml?.includes(slug)) {
        return {
          slug,
          html: "<html><body>no body container</body></html>",
          article_url: `https://metavgc.com/guides/${slug}`,
          fetched_at: "2026-05-08T00:00:00Z",
        };
      }
      const html = readFileSync(join(FIXTURES, FIXTURE_FILES[slug]!), "utf8");
      return {
        slug,
        html,
        article_url: `https://metavgc.com/guides/${slug}`,
        fetched_at: "2026-05-08T00:00:00Z",
      };
    },
  };
}

function makeEmbed(opts: { fail?: string } = {}): EmbedClient {
  return {
    embed: vi.fn(async (texts) => {
      if (opts.fail === "embedding")
        throw new KnowledgeEmbeddingError("synthetic embedding failure");
      if (opts.fail === "auth")
        throw new KnowledgeAuthError("synthetic auth failure");
      if (opts.fail === "storage")
        throw new KnowledgeStorageError("synthetic storage failure");
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

function captureStdout(): { buffer: string[]; restore: () => void } {
  const buffer: string[] = [];
  const spy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: unknown) => {
      buffer.push(typeof chunk === "string" ? chunk : String(chunk));
      return true;
    });
  return { buffer, restore: () => spy.mockRestore() };
}

function parseSummary(buffer: string[]): RunSummary {
  const joined = buffer.join("");
  const lines = joined.split("\n").filter((l) => l.trim().length > 0);
  const last = lines[lines.length - 1];
  if (last === undefined) throw new Error("no stdout output captured");
  return JSON.parse(last) as RunSummary;
}

describe("ingest-metavgc (META-T45..T48)", () => {
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

  it("META-T45. --no-network end-to-end on cached fixtures (3 articles, summary line emitted)", async () => {
    const cap = captureStdout();
    try {
      const exit = await main(
        ["--no-network", "--db", ":memory:"],
        {
          client: makeClient(),
          embedClient: makeEmbed(),
          scope: TEST_SCOPE,
        },
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

  it("META-T46. body_hash idempotency: rerunning produces zero embedding API calls", async () => {
    const dir = mkdtempSync(join(tmpdir(), "metavgc-t46-"));
    const dbPath = join(dir, "db.sqlite");
    try {
      const embed1 = makeEmbed();
      const embed2 = makeEmbed();
      const cap = captureStdout();
      try {
        await main(["--no-network", "--db", dbPath], {
          client: makeClient(),
          embedClient: embed1,
          scope: TEST_SCOPE,
        });
        await main(["--no-network", "--db", dbPath], {
          client: makeClient(),
          embedClient: embed2,
          scope: TEST_SCOPE,
        });
      } finally {
        cap.restore();
      }
      const fn1 = embed1.embed as unknown as ReturnType<typeof vi.fn>;
      const fn2 = embed2.embed as unknown as ReturnType<typeof vi.fn>;
      expect(fn1).toHaveBeenCalled();
      expect(fn2).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("META-T47. failure modes: 404 / parse / embedding logged into summary; auth / storage propagate or exit 1", async () => {
    // 404 + bad-html + embedding all visible in summary.
    {
      const cap = captureStdout();
      try {
        const exit = await main(
          ["--no-network", "--db", ":memory:"],
          {
            client: makeClient({
              notFound: ["how-to-counter-incineroar-pokemon-champions"],
              badHtml: ["regulation-m-a-leads-opening-pokemon-champions"],
            }),
            embedClient: makeEmbed(),
            scope: TEST_SCOPE,
          },
        );
        expect(exit).toBe(0);
        const summary = parseSummary(cap.buffer);
        expect(summary.not_found).toContain(
          "how-to-counter-incineroar-pokemon-champions",
        );
        expect(summary.parse_failures.map((f) => f.slug)).toContain(
          "regulation-m-a-leads-opening-pokemon-champions",
        );
      } finally {
        cap.restore();
      }
    }

    // Embedding failure visible in summary, exit 0.
    {
      const cap = captureStdout();
      try {
        const exit = await main(
          ["--no-network", "--db", ":memory:"],
          {
            client: makeClient(),
            embedClient: makeEmbed({ fail: "embedding" }),
            scope: TEST_SCOPE,
          },
        );
        expect(exit).toBe(0);
        const summary = parseSummary(cap.buffer);
        const failedSlugs = summary.embedding_failures.map((f) => f.slug);
        for (const s of SLUGS) expect(failedSlugs).toContain(s);
      } finally {
        cap.restore();
      }
    }

    // Auth failure: propagate or exit 1.
    {
      let exit = 0;
      let thrown: unknown;
      try {
        exit = await main(
          ["--no-network", "--db", ":memory:"],
          {
            client: makeClient(),
            embedClient: makeEmbed({ fail: "auth" }),
            scope: TEST_SCOPE,
          },
        );
      } catch (e) {
        thrown = e;
      }
      const propagatedAuth = thrown instanceof KnowledgeAuthError;
      expect(exit === 1 || propagatedAuth).toBe(true);
    }

    // Storage failure: propagate or exit 1.
    {
      let exit = 0;
      let thrown: unknown;
      try {
        exit = await main(
          ["--no-network", "--db", ":memory:"],
          {
            client: makeClient(),
            embedClient: makeEmbed({ fail: "storage" }),
            scope: TEST_SCOPE,
          },
        );
      } catch (e) {
        thrown = e;
      }
      const propagatedStorage = thrown instanceof KnowledgeStorageError;
      expect(exit === 1 || propagatedStorage).toBe(true);
    }
  });

  it.skipIf(!process.env.METAVGC_LIVE)(
    "META-T48. live contract: hits real metavgc.com/sitemap.xml end-to-end (gated by METAVGC_LIVE=1)",
    async () => {
      const exit = await main(["--no-network=false", "--db", ":memory:"], {});
      expect(exit).toBe(0);
    },
  );
});
