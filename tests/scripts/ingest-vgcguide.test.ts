/**
 * VGC-T55–VGC-T61 — `scripts/data/ingest-vgcguide.ts` orchestration.
 * Stage 4: every test fails because `main` throws "not implemented (Stage 5)".
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { main } from "../../scripts/data/ingest-vgcguide";
import type { VgcGuideClient } from "../../src/tools/vgcguide/client";
import type { EmbedClient } from "../../src/tools/knowledge/embed";
import {
  KnowledgeAuthError,
  KnowledgeEmbeddingError,
  KnowledgeStorageError,
} from "../../src/schemas/errors";

const FIXTURES = join(__dirname, "../../fixtures/vgcguide");
const DIM = 1024;

const SLUGS = [
  "what-is-pokemon-showdown",
  "typing",
  "predictions",
];
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

describe("ingest-vgcguide (VGC-T55–VGC-T61)", () => {
  it("VGC-T55. --no-network runs end-to-end on cached fixtures (3 articles)", async () => {
    const exit = await main(
      ["--no-network", "--db", ":memory:"],
      { client: makeFakeClient(), embedClient: makeFakeEmbed() },
    );
    expect(exit).toBe(0);
  });

  it("VGC-T56. logs not_found on 404 article", async () => {
    const exit = await main(
      ["--no-network", "--db", ":memory:"],
      {
        client: makeFakeClient({ notFound: ["typing"] }),
        embedClient: makeFakeEmbed(),
      },
    );
    expect(exit).toBe(0);
  });

  it("VGC-T57. logs parse_failures on bad HTML", async () => {
    const exit = await main(
      ["--no-network", "--db", ":memory:"],
      {
        client: makeFakeClient({ badHtml: ["typing"] }),
        embedClient: makeFakeEmbed(),
      },
    );
    expect(exit).toBe(0);
  });

  it("VGC-T58. logs embedding_failures on Voyage retry exhaustion (per article)", async () => {
    const exit = await main(
      ["--no-network", "--db", ":memory:"],
      {
        client: makeFakeClient(),
        embedClient: makeFakeEmbed({ fail: "embedding" }),
      },
    );
    // exit 0 because per-article failures are bounded; ingest continues.
    expect(exit).toBe(0);
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
        },
      );
    } catch (e) {
      thrown = e;
    }
    const propagatedStorage = thrown instanceof KnowledgeStorageError;
    expect(exit === 1 || propagatedStorage).toBe(true);
  });

  it("VGC-T61. skip-existing on body_hash: rerunning produces zero embedding API calls", async () => {
    const dbPath = ":memory:";
    const embed1 = makeFakeEmbed();
    const embed2 = makeFakeEmbed();
    await main(["--no-network", "--db", dbPath], {
      client: makeFakeClient(),
      embedClient: embed1,
    });
    await main(["--no-network", "--db", dbPath], {
      client: makeFakeClient(),
      embedClient: embed2,
    });
    // Second run: body_hash matches → zero embedding calls.
    const fn = embed2.embed as unknown as ReturnType<typeof vi.fn>;
    expect(fn).not.toHaveBeenCalled();
  });
});
