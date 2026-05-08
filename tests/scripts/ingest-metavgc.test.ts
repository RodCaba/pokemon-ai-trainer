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
  SpeciesTaggerError,
} from "../../src/schemas/errors";
import type { SpeciesIndex } from "../../src/tools/knowledge/species-tagger";
import { open } from "../../src/db/open";
import { knowledgeChunks, knowledgeChunkSpeciesTags } from "../../src/db/drizzle-schema";
import { eq } from "drizzle-orm";

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

/**
 * Build a synthetic species index covering the species named in the captured
 * fixtures. Lets `:memory:` tests bypass DB seeding while still exercising the
 * tagger contract end-to-end.
 */
function makeFakeSpeciesIndex(): SpeciesIndex {
  const entries = [
    { id: "incineroar", names: ["Incineroar"] },
    { id: "sneasler", names: ["Sneasler"] },
    { id: "farigiraf", names: ["Farigiraf"] },
    { id: "kingambit", names: ["Kingambit"] },
    { id: "milotic", names: ["Milotic"] },
    { id: "mamoswine", names: ["Mamoswine"] },
    { id: "dragapult", names: ["Dragapult"] },
    { id: "basculegion", names: ["Basculegion"] },
    { id: "tyranitar", names: ["Tyranitar"] },
    { id: "rotomwash", names: ["Rotom-Wash"] },
    { id: "glimmoramega", names: ["Mega Glimmora", "Glimmora-Mega"] },
    { id: "manectricmega", names: ["Mega Manectric", "Manectric-Mega"] },
    { id: "skarmorymega", names: ["Mega Skarmory", "Skarmory-Mega"] },
    { id: "starmiemega", names: ["Mega Starmie", "Starmie-Mega"] },
    { id: "emboarmega", names: ["Mega Emboar", "Emboar-Mega"] },
    { id: "glimmora", names: ["Glimmora"] },
    { id: "manectric", names: ["Manectric"] },
    { id: "skarmory", names: ["Skarmory"] },
    { id: "starmie", names: ["Starmie"] },
    { id: "emboar", names: ["Emboar"] },
    { id: "whimsicott", names: ["Whimsicott"] },
    { id: "pelipper", names: ["Pelipper"] },
    { id: "archaludon", names: ["Archaludon"] },
  ];
  return {
    entries: entries.flatMap(({ id, names }) =>
      names.map((n) => ({
        pattern: new RegExp(
          `\\b${n.replace(/[.*+?^${}()|[\\\]\\\\]/g, "\\$&")}\\b`,
          "gi",
        ),
        speciesId: id,
        lengthHint: n.length,
      })),
    ),
  };
}

/**
 * Seed minimal species rows + Reg-M-A roster_membership for every species id
 * referenced by {@link makeFakeSpeciesIndex}. The link table FK
 * `knowledge_chunk_species_tags.species_id → species(id)` requires real rows;
 * tests would otherwise fail with FOREIGN KEY constraint.
 */
function seedFakeSpecies(dbPath: string, ids: string[]): void {
  const db = open(dbPath);
  const insertSpecies = db.$client.prepare(
    `INSERT OR IGNORE INTO species
       (id, display_name, is_mega, types, weight_kg, aliases, movepool, source_json)
     VALUES (?, ?, ?, '["Normal"]', 1.0, '[]', '[]', '{}')`,
  );
  const insertMembership = db.$client.prepare(
    `INSERT OR IGNORE INTO roster_membership
       (species_id, format, is_legal, is_mega)
     VALUES (?, 'RegM-A', 1, ?)`,
  );
  const tx = db.$client.transaction((rows: string[]) => {
    for (const id of rows) {
      const display = id.charAt(0).toUpperCase() + id.slice(1);
      const isMega = id.endsWith("mega") ? 1 : 0;
      insertSpecies.run(id, display, isMega);
      insertMembership.run(id, isMega);
    }
  });
  tx(ids);
  db.$client.close();
}

/**
 * Allocate a fresh tmp DB file, run the migration chain, and seed species.
 * Tests that need to inspect persisted rows must use a file path (not
 * `:memory:`) so the test's own `open()` sees the same data as `main()`.
 */
function makeTestDb(): { dbPath: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "metavgc-test-"));
  const dbPath = join(dir, "db.sqlite");
  // open() runs migrations; close immediately so main() can take over.
  open(dbPath).$client.close();
  seedFakeSpecies(dbPath, FAKE_SPECIES_IDS);
  return { dbPath, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const FAKE_SPECIES_IDS = [
  "incineroar", "sneasler", "farigiraf", "kingambit", "milotic",
  "mamoswine", "dragapult", "basculegion", "tyranitar", "rotomwash",
  "glimmoramega", "manectricmega", "skarmorymega", "starmiemega",
  "emboarmega", "glimmora", "manectric", "skarmory", "starmie",
  "emboar", "whimsicott", "pelipper", "archaludon",
];

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
    const { dbPath, cleanup } = makeTestDb();
    const cap = captureStdout();
    try {
      const exit = await main(
        ["--no-network", "--db", dbPath],
        {
          client: makeClient(),
          embedClient: makeEmbed(),
          scope: TEST_SCOPE,
            speciesIndex: makeFakeSpeciesIndex(),
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
      cleanup();
    }
  });

  it("META-T46. body_hash idempotency: rerunning produces zero embedding API calls", async () => {
    const { dbPath, cleanup } = makeTestDb();
    try {
      const embed1 = makeEmbed();
      const embed2 = makeEmbed();
      const cap = captureStdout();
      try {
        await main(["--no-network", "--db", dbPath], {
          client: makeClient(),
          embedClient: embed1,
          scope: TEST_SCOPE,
            speciesIndex: makeFakeSpeciesIndex(),
        });
        await main(["--no-network", "--db", dbPath], {
          client: makeClient(),
          embedClient: embed2,
          scope: TEST_SCOPE,
            speciesIndex: makeFakeSpeciesIndex(),
        });
      } finally {
        cap.restore();
      }
      const fn1 = embed1.embed as unknown as ReturnType<typeof vi.fn>;
      const fn2 = embed2.embed as unknown as ReturnType<typeof vi.fn>;
      expect(fn1).toHaveBeenCalled();
      expect(fn2).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  it("META-T47. failure modes: 404 / parse / embedding logged into summary; auth / storage propagate or exit 1", async () => {
    // 404 + bad-html + embedding all visible in summary.
    {
      const { dbPath, cleanup } = makeTestDb();
      const cap = captureStdout();
      try {
        const exit = await main(
          ["--no-network", "--db", dbPath],
          {
            client: makeClient({
              notFound: ["how-to-counter-incineroar-pokemon-champions"],
              badHtml: ["regulation-m-a-leads-opening-pokemon-champions"],
            }),
            embedClient: makeEmbed(),
            scope: TEST_SCOPE,
            speciesIndex: makeFakeSpeciesIndex(),
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
        cleanup();
      }
    }

    // Embedding failure visible in summary, exit 0.
    {
      const { dbPath, cleanup } = makeTestDb();
      const cap = captureStdout();
      try {
        const exit = await main(
          ["--no-network", "--db", dbPath],
          {
            client: makeClient(),
            embedClient: makeEmbed({ fail: "embedding" }),
            scope: TEST_SCOPE,
            speciesIndex: makeFakeSpeciesIndex(),
          },
        );
        expect(exit).toBe(0);
        const summary = parseSummary(cap.buffer);
        const failedSlugs = summary.embedding_failures.map((f) => f.slug);
        for (const s of SLUGS) expect(failedSlugs).toContain(s);
      } finally {
        cap.restore();
        cleanup();
      }
    }

    // Auth failure: propagate or exit 1.
    {
      const { dbPath, cleanup } = makeTestDb();
      let exit = 0;
      let thrown: unknown;
      try {
        exit = await main(
          ["--no-network", "--db", dbPath],
          {
            client: makeClient(),
            embedClient: makeEmbed({ fail: "auth" }),
            scope: TEST_SCOPE,
            speciesIndex: makeFakeSpeciesIndex(),
          },
        );
      } catch (e) {
        thrown = e;
      } finally {
        cleanup();
      }
      const propagatedAuth = thrown instanceof KnowledgeAuthError;
      expect(exit === 1 || propagatedAuth).toBe(true);
    }

    // Storage failure: propagate or exit 1.
    {
      const { dbPath, cleanup } = makeTestDb();
      let exit = 0;
      let thrown: unknown;
      try {
        exit = await main(
          ["--no-network", "--db", dbPath],
          {
            client: makeClient(),
            embedClient: makeEmbed({ fail: "storage" }),
            scope: TEST_SCOPE,
            speciesIndex: makeFakeSpeciesIndex(),
          },
        );
      } catch (e) {
        thrown = e;
      } finally {
        cleanup();
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

  it("META-T40. fail loud on empty species index (flow §8 contract)", async () => {
    // No `speciesIndex` injected and no species seeded in :memory: DB →
    // buildSpeciesIndex throws SpeciesTaggerError; ingest must NOT swallow.
    let thrown: unknown;
    let exit = 0;
    try {
      exit = await main(["--no-network", "--db", ":memory:"], {
        client: makeClient(),
        embedClient: makeEmbed(),
        scope: TEST_SCOPE,
      });
    } catch (e) {
      thrown = e;
    }
    const propagated = thrown instanceof SpeciesTaggerError;
    expect(propagated || exit === 1).toBe(true);
  });

  it("META-T49. persisted chunks carry author='MetaVGC' (citation contract, CLAUDE.md §5)", async () => {
    const { dbPath, cleanup } = makeTestDb();
    try {
      const cap = captureStdout();
      try {
        await main(["--no-network", "--db", dbPath], {
          client: makeClient(),
          embedClient: makeEmbed(),
          scope: TEST_SCOPE,
          speciesIndex: makeFakeSpeciesIndex(),
        });
      } finally {
        cap.restore();
      }
      const db = open(dbPath);
      const rows = db
        .select({ author: knowledgeChunks.author })
        .from(knowledgeChunks)
        .where(eq(knowledgeChunks.sourceSite, "metavgc"))
        .all();
      db.$client.close();
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) expect(r.author).toBe("MetaVGC");
    } finally {
      cleanup();
    }
  });

  it("META-T50. parent-h2 heading inherits into tagger input — each Mega's sub-chunks carry that Mega's tag", async () => {
    // Regression for commit bcd76b8: the megas guide repeats h3 headings
    // ("Strategic Overview", "Base Stats and Ability") once per Mega. Sub-
    // chunks must inherit their PARENT h2 ("1. Mega Glimmora", etc.) so each
    // Mega gets equal coverage — not all attributed to the last h2 seen.
    const { dbPath, cleanup } = makeTestDb();
    try {
      const cap = captureStdout();
      try {
        await main(["--no-network", "--db", dbPath], {
          client: makeClient(),
          embedClient: makeEmbed(),
          scope: new Set([
            "anti-meta-underrated-megas-pokemon-champions-2026",
          ]),
          speciesIndex: makeFakeSpeciesIndex(),
        });
      } finally {
        cap.restore();
      }
      const db = open(dbPath);
      const counts = db.$client
        .prepare(
          `SELECT t.species_id AS species_id, COUNT(DISTINCT t.chunk_id) AS n
             FROM knowledge_chunk_species_tags t
             JOIN knowledge_chunks k ON k.id = t.chunk_id
            WHERE k.source_site = 'metavgc'
              AND t.species_id IN ('glimmoramega','manectricmega',
                                   'skarmorymega','starmiemega','emboarmega')
            GROUP BY t.species_id
            ORDER BY t.species_id`,
        )
        .all() as Array<{ species_id: string; n: number }>;
      db.$client.close();
      // All five Megas must be tagged in roughly equal numbers of chunks
      // (the article gives each one the same 4-subsection treatment). Pre-
      // bcd76b8 the LAST h2 (emboarmega) absorbed all sub-chunks.
      expect(counts).toHaveLength(5);
      const ns = counts.map((c) => c.n);
      const min = Math.min(...ns);
      const max = Math.max(...ns);
      expect(min).toBeGreaterThanOrEqual(4);
      expect(max - min).toBeLessThanOrEqual(2);
      // unused import guard
      void knowledgeChunkSpeciesTags;
    } finally {
      cleanup();
    }
  });
});
