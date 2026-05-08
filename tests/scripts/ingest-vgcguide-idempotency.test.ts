/**
 * VGC-T62 — running ingest twice produces zero knowledge_chunks deltas.
 * Stage 4: fails because `main` throws "not implemented (Stage 5)".
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { main } from "../../scripts/data/ingest-vgcguide";
import { open } from "../../src/db/open";
import type { VgcGuideClient } from "../../src/tools/vgcguide/client";
import type { EmbedClient } from "../../src/tools/knowledge/embed";

const FIXTURES = join(__dirname, "../../fixtures/vgcguide");
const DIM = 512;

function makeClient(): VgcGuideClient {
  return {
    async fetchSitemap() {
      return ["https://www.vgcguide.com/typing"];
    },
    async fetchArticleHtml(slug) {
      const html = readFileSync(
        join(FIXTURES, "2026-05-06__teambuilding__typing.html"),
        "utf8",
      );
      return {
        slug,
        html,
        article_url: `https://www.vgcguide.com/${slug}`,
        fetched_at: "2026-05-06T00:00:00Z",
      };
    },
  };
}

function makeEmbed(): EmbedClient {
  return {
    embed: vi.fn(async (texts) =>
      texts.map((_, i) => {
        const v = new Float32Array(DIM);
        for (let j = 0; j < DIM; j++) v[j] = ((i * 31 + j) % 17) / 17;
        return v;
      }),
    ),
  };
}

describe("ingest-vgcguide idempotency (VGC-T62)", () => {
  it("VGC-T62. running ingest twice produces zero knowledge_chunks deltas", async () => {
    // Use a shared in-memory DB by sharing the path key — since :memory: is
    // per-handle, we instead snapshot rows after each main() call via a
    // separate handle. Simpler: open one DB, run main twice with the same
    // dbPath argument. We mock that by always operating on `:memory:` and
    // observing the embed call count instead — the idempotency invariant
    // surfaces in VGC-T61 too. Here we additionally verify chunks count
    // doesn't grow across runs by inspecting the second run's persistent
    // file-DB.
    const tmp = `/tmp/vgcguide-idempotency-${Date.now()}.sqlite`;
    try {
      await main(["--no-network", "--db", tmp], {
        client: makeClient(),
        embedClient: makeEmbed(),
      });
      const db1 = open(tmp);
      const before = (
        db1.$client
          .prepare("SELECT COUNT(*) AS c FROM knowledge_chunks")
          .get() as { c: number }
      ).c;
      db1.$client.close();
      await main(["--no-network", "--db", tmp], {
        client: makeClient(),
        embedClient: makeEmbed(),
      });
      const db2 = open(tmp);
      const after = (
        db2.$client
          .prepare("SELECT COUNT(*) AS c FROM knowledge_chunks")
          .get() as { c: number }
      ).c;
      db2.$client.close();
      expect(after).toBe(before);
    } finally {
      // tmp file cleanup is best-effort
      try {
        const { unlinkSync } = await import("node:fs");
        unlinkSync(tmp);
      } catch {
        /* noop */
      }
    }
  });
});
