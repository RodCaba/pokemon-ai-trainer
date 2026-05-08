/**
 * VGC-T53, VGC-T54 — knowledgeSearch agent-tool wrapper.
 * Stage 4: every test fails because `knowledgeSearch` throws "not implemented".
 */

import { describe, expect, it, vi } from "vitest";
import { open } from "../../../src/db/open";
import { knowledgeSearch } from "../../../src/tools/knowledge/search";
import type { EmbedClient } from "../../../src/tools/knowledge/embed";
import { KnowledgeAuthError } from "../../../src/schemas/errors";

const DIM = 512;

function fakeEmbedClient(vec?: Float32Array): EmbedClient {
  return {
    embed: vi.fn(async () => [vec ?? new Float32Array(DIM)]),
  };
}

describe("knowledgeSearch (VGC-T53, VGC-T54)", () => {
  it("VGC-T53. end-to-end: query → embed → repo.search → hits", async () => {
    const db = open(":memory:");
    try {
      const hits = await knowledgeSearch(
        { query: "what is speed control" },
        { db, embedClient: fakeEmbedClient() },
      );
      // Empty DB → empty hits is the correct semantic.
      expect(Array.isArray(hits)).toBe(true);
    } finally {
      db.$client.close();
    }
  });

  it("VGC-T54. surfaces KnowledgeAuthError on bad API key", async () => {
    const db = open(":memory:");
    try {
      const failing: EmbedClient = {
        embed: async () => {
          throw new KnowledgeAuthError("bad key");
        },
      };
      let thrown: unknown;
      try {
        await knowledgeSearch(
          { query: "what is speed control" },
          { db, embedClient: failing },
        );
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(KnowledgeAuthError);
    } finally {
      db.$client.close();
    }
  });
});
