/**
 * YT-T55..YT-T62 — Stage 4 tests for `scripts/data/ingest-youtube.ts`.
 * Stage 4: every test fails because `main` throws "not implemented (Stage 5)".
 */

import { describe, expect, it } from "vitest";
import { main } from "../../scripts/data/ingest-youtube";
import { open } from "../../src/db/open";
import type { YoutubeClient } from "../../src/tools/youtube/client";
import type { AnthropicClientLike } from "../../src/tools/insights/extract";
import type { EmbedClient } from "../../src/tools/knowledge/embed";
import type { SpeciesIndex } from "../../src/tools/knowledge/species-tagger";

function fakeYt(): YoutubeClient {
  return {
    async fetchTranscript() {
      return [
        { text: "Hello", start_s: 0, duration_s: 1 },
        { text: "Garchomp leads with Earthquake.", start_s: 1, duration_s: 5 },
      ];
    },
    async fetchMetadata() {
      return {
        video_id: "J0eVKJyJ_DQ",
        title: "T",
        channel: "C",
        published_at: "2026-04-30T00:00:00Z",
        duration_s: 600,
        canonical_url: "https://www.youtube.com/watch?v=J0eVKJyJ_DQ",
        fetched_at: "2026-05-09T00:00:00Z",
        language: "en",
      };
    },
  };
}

function fakeEmbed(): EmbedClient {
  return {
    async embed(texts) {
      return texts.map(() => new Float32Array(512));
    },
  };
}

function fakeAnthropic(): AnthropicClientLike {
  return {
    messages: {
      async create() {
        return {
          content: [
            {
              type: "tool_use",
              name: "emit_insights",
              input: {
                insights: [
                  {
                    claim: "Garchomp leads with Earthquake.",
                    claim_type: "lead",
                    subjects: { pokemon: ["garchomp"], formats: ["RegM-A"] },
                    confidence: "medium",
                    stance: "supports",
                    source_excerpt: "Garchomp leads with Earthquake.",
                  },
                ],
              },
            },
          ],
        };
      },
    },
  };
}

function fakeSpeciesIndex(): SpeciesIndex {
  return {
    entries: [{ pattern: /\bgarchomp\b/i, speciesId: "garchomp", lengthHint: 8 }],
  };
}

describe("scripts/data/ingest-youtube (YT-T55..YT-T62)", () => {
  it("YT-T55. ingest --no-extract persists chunks via cached fixture", async () => {
    const db = open(":memory:");
    try {
      const exit = await main(
        ["--url", "https://www.youtube.com/watch?v=J0eVKJyJ_DQ", "--no-extract"],
        {
          db,
          ytClient: fakeYt(),
          embedClient: fakeEmbed(),
          anthropic: fakeAnthropic(),
          speciesIndex: fakeSpeciesIndex(),
        },
      );
      expect(exit).toBe(0);
      const count = (
        db.$client
          .prepare("SELECT COUNT(*) AS c FROM knowledge_chunks WHERE source_site = 'youtube'")
          .get() as { c: number } | undefined
      )?.c;
      expect((count ?? 0) > 0).toBe(true);
    } finally {
      db.$client.close();
    }
  });

  it("YT-T56. ingest with mocked Anthropic persists ≥1 insight row", async () => {
    const db = open(":memory:");
    try {
      const exit = await main(
        ["--url", "https://www.youtube.com/watch?v=J0eVKJyJ_DQ"],
        {
          db,
          ytClient: fakeYt(),
          embedClient: fakeEmbed(),
          anthropic: fakeAnthropic(),
          speciesIndex: fakeSpeciesIndex(),
        },
      );
      expect(exit).toBe(0);
      const count = (
        db.$client.prepare("SELECT COUNT(*) AS c FROM insights").get() as
          | { c: number }
          | undefined
      )?.c;
      expect((count ?? 0) >= 1).toBe(true);
    } finally {
      db.$client.close();
    }
  });

  it("YT-T57. soft-skips non-English video, exits 0", async () => {
    const db = open(":memory:");
    try {
      const ytJa: YoutubeClient = {
        ...fakeYt(),
        async fetchMetadata() {
          return {
            video_id: "abc",
            title: "T",
            channel: "C",
            published_at: null,
            duration_s: null,
            canonical_url: "https://www.youtube.com/watch?v=abc",
            fetched_at: "2026-05-09T00:00:00Z",
            language: "ja",
          };
        },
      };
      const exit = await main(["--url", "https://www.youtube.com/watch?v=abc"], {
        db,
        ytClient: ytJa,
        embedClient: fakeEmbed(),
        anthropic: fakeAnthropic(),
        speciesIndex: fakeSpeciesIndex(),
      });
      expect(exit).toBe(0);
    } finally {
      db.$client.close();
    }
  });

  it("YT-T58. soft-skips no-captions video, exits 0", async () => {
    const db = open(":memory:");
    try {
      const ytNoCaps: YoutubeClient = {
        ...fakeYt(),
        async fetchTranscript() {
          const e = new Error("no captions") as Error & {
            kind?: string;
            video_id?: string;
            name?: string;
          };
          e.name = "YoutubeFetchError";
          e.kind = "no_captions";
          e.video_id = "abc";
          throw e;
        },
      };
      const exit = await main(["--url", "https://www.youtube.com/watch?v=abc"], {
        db,
        ytClient: ytNoCaps,
        embedClient: fakeEmbed(),
        anthropic: fakeAnthropic(),
        speciesIndex: fakeSpeciesIndex(),
      });
      expect(exit).toBe(0);
    } finally {
      db.$client.close();
    }
  });

  it("YT-T59. fails loud (exit 1) on KnowledgeAuthError from Voyage", async () => {
    const db = open(":memory:");
    try {
      const badEmbed: EmbedClient = {
        async embed() {
          const { KnowledgeAuthError } = await import("../../src/schemas/errors");
          throw new KnowledgeAuthError("bad voyage key");
        },
      };
      const exit = await main(["--url", "https://www.youtube.com/watch?v=abc"], {
        db,
        ytClient: fakeYt(),
        embedClient: badEmbed,
        anthropic: fakeAnthropic(),
        speciesIndex: fakeSpeciesIndex(),
      }).catch(() => 1);
      expect(exit).toBe(1);
    } finally {
      db.$client.close();
    }
  });

  it("YT-T60. --no-extract bypasses Haiku when ANTHROPIC_API_KEY missing", async () => {
    const db = open(":memory:");
    try {
      const exit = await main(
        ["--url", "https://www.youtube.com/watch?v=abc", "--no-extract"],
        {
          db,
          ytClient: fakeYt(),
          embedClient: fakeEmbed(),
          // anthropic intentionally omitted
          speciesIndex: fakeSpeciesIndex(),
        },
      );
      expect(exit).toBe(0);
      const insightsCount = (
        db.$client.prepare("SELECT COUNT(*) AS c FROM insights").get() as
          | { c: number }
          | undefined
      )?.c;
      expect(insightsCount ?? 0).toBe(0);
    } finally {
      db.$client.close();
    }
  });

  it("YT-T62. running ingest twice produces zero new chunks AND zero new insights", async () => {
    const db = open(":memory:");
    try {
      await main(["--url", "https://www.youtube.com/watch?v=abc"], {
        db,
        ytClient: fakeYt(),
        embedClient: fakeEmbed(),
        anthropic: fakeAnthropic(),
        speciesIndex: fakeSpeciesIndex(),
      });
      const chunks1 = (
        db.$client.prepare("SELECT COUNT(*) AS c FROM knowledge_chunks").get() as
          | { c: number }
          | undefined
      )?.c;
      const insights1 = (
        db.$client.prepare("SELECT COUNT(*) AS c FROM insights").get() as
          | { c: number }
          | undefined
      )?.c;
      await main(["--url", "https://www.youtube.com/watch?v=abc"], {
        db,
        ytClient: fakeYt(),
        embedClient: fakeEmbed(),
        anthropic: fakeAnthropic(),
        speciesIndex: fakeSpeciesIndex(),
      });
      const chunks2 = (
        db.$client.prepare("SELECT COUNT(*) AS c FROM knowledge_chunks").get() as
          | { c: number }
          | undefined
      )?.c;
      const insights2 = (
        db.$client.prepare("SELECT COUNT(*) AS c FROM insights").get() as
          | { c: number }
          | undefined
      )?.c;
      expect(chunks2).toBe(chunks1);
      expect(insights2).toBe(insights1);
    } finally {
      db.$client.close();
    }
  });
});
