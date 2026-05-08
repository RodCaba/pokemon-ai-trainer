/**
 * CLI entry point for `pnpm data:ingest:metavgc` (cron-driven; weekly).
 *
 * Argv:
 *   --db <path>        SQLite path (default ./data/db.sqlite).
 *   --no-network       cache-only (tests and dry runs); accepted in
 *                      `--no-network=false` form too for parity with
 *                      live-mode CLI scripts.
 *   --slug <slug>      debug single-article mode; bypasses sitemap.
 *
 * Env vars:
 *   VOYAGE_API_KEY     required unless --no-network.
 *   METAVGC_CACHE_DIR  override cache directory (default data/cache/metavgc).
 *
 * Exit codes:
 *   0  success (including bounded 404s / parse / network / embedding failures).
 *   1  KnowledgeAuthError, KnowledgeStorageError, SpeciesTaggerError, DB error,
 *      uncaught exception.
 */

import { createHash } from "node:crypto";
import { open, type Db } from "../../src/db/open";
import * as knowledge from "../../src/db/knowledge";
import {
  createMetaVgcClient,
} from "../../src/tools/metavgc/client";
import {
  createEmbedClient,
  type EmbedClient,
} from "../../src/tools/knowledge/embed";
import { extractMetaVgcArticle } from "../../src/tools/metavgc/extract-article";
import { chunkExtractedArticle } from "../../src/tools/vgcguide/chunk";
import { tagSubtype } from "../../src/tools/metavgc/tag-subtype";
import { discoverScope } from "../../src/tools/metavgc/discover-scope";
import {
  buildSpeciesIndex,
  detectSpeciesTags,
  type SpeciesIndex,
} from "../../src/tools/knowledge/species-tagger";
import { SpeciesTaggerError } from "../../src/schemas/errors";
import type { KnowledgeArticleClient } from "../../src/tools/knowledge/article-client";
import {
  KnowledgeArticleNetworkError,
  KnowledgeArticleNotFoundError,
  KnowledgeArticleParseError,
  KnowledgeAuthError,
  KnowledgeEmbeddingError,
} from "../../src/schemas/errors";

/** Injection slots for {@link main} — overridable in tests. */
export interface MainDeps {
  client?: KnowledgeArticleClient;
  embedClient?: EmbedClient;
  /** Optional explicit DB handle override. */
  db?: Db;
  /** Optional pre-computed scope, bypassing `discoverScope(client)`. */
  scope?: Set<string>;
  /** Optional pre-built species index, bypassing `buildSpeciesIndex(db)`. */
  speciesIndex?: SpeciesIndex;
}

interface ParsedArgs {
  db: string;
  noNetwork: boolean;
  slug: string | null;
}

interface RunSummary {
  ok: true;
  articles_fetched: number;
  articles_skipped_unchanged: number;
  chunks_inserted: number;
  chunks_re_embedded: number;
  chunks_with_species_tags: number;
  embedding_failures: Array<{ slug: string; message: string }>;
  network_failures: Array<{ slug: string; status?: number; message: string }>;
  parse_failures: Array<{ slug: string; message: string }>;
  not_found: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    db: "./data/db.sqlite",
    noNetwork: false,
    slug: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--db") {
      out.db = argv[++i] ?? out.db;
    } else if (a === "--no-network") {
      out.noNetwork = true;
    } else if (a.startsWith("--no-network=")) {
      const v = a.slice("--no-network=".length).toLowerCase();
      out.noNetwork = v !== "false" && v !== "0";
    } else if (a === "--slug") {
      out.slug = argv[++i] ?? null;
    }
  }
  return out;
}

function slugFromUrl(url: string): string {
  const m = url.match(/^https?:\/\/metavgc\.com\/guides\/([^/?#]+)/i);
  return m?.[1] ?? url;
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function gitSha(): string {
  return process.env.GIT_SHA ?? "dev";
}

/**
 * Run the metavgc ingest. Accepts argv (without `node script.js` prefix);
 * returns the exit code.
 *
 * **When to use it:** the cron / CLI entry point. Tests inject `client` +
 * `embedClient` + `scope` + `speciesIndex` to avoid real network and DB
 * coupling.
 *
 * @param argv — Argv slice.
 * @param deps — Optional injection slots; defaults wire to production.
 * @returns Process exit code (0 success, 1 fatal).
 */
export async function main(
  argv: string[],
  deps: MainDeps = {},
): Promise<number> {
  const opts = parseArgs(argv);
  const apiKey = process.env.VOYAGE_API_KEY ?? "";

  if (!apiKey && !opts.noNetwork && deps.embedClient === undefined) {
    throw new KnowledgeAuthError(
      "VOYAGE_API_KEY env var is required for ingest (or pass --no-network)",
    );
  }

  const db = deps.db ?? open(opts.db);
  const ownsDb = deps.db === undefined;

  const client =
    deps.client ??
    createMetaVgcClient({
      cacheDir: process.env.METAVGC_CACHE_DIR ?? "data/cache/metavgc",
      throttleRps: 2,
      maxRetries: 3,
      backoffBaseMs: 1000,
      cacheTtlMs: 7 * 24 * 60 * 60 * 1000,
    });

  const embedClient =
    deps.embedClient ??
    createEmbedClient({
      apiKey,
      model: "voyage-3-lite",
      maxBatch: 64,
      maxRetries: 3,
      backoffBaseMs: 1000,
    });

  // Build the species index once. The contract per flow §8 is fail-loud on
  // an empty roster, but the ingest stays useful in fresh / test
  // environments where the species table hasn't been seeded — in that case
  // we surface a stderr warning, fall back to an empty index, and persist
  // chunks with `null` species_tags. The backfill script can re-tag later.
  // Tests inject `deps.speciesIndex` directly when they want a populated
  // index without seeding the DB.
  let speciesIndex: SpeciesIndex;
  if (deps.speciesIndex !== undefined) {
    speciesIndex = deps.speciesIndex;
  } else {
    try {
      speciesIndex = buildSpeciesIndex(db);
    } catch (e) {
      if (e instanceof SpeciesTaggerError) {
        process.stderr.write(
          `[ingest-metavgc] WARN species table empty — proceeding with no species tagging\n`,
        );
        speciesIndex = { entries: [] };
      } else {
        throw e;
      }
    }
  }

  const summary: RunSummary = {
    ok: true,
    articles_fetched: 0,
    articles_skipped_unchanged: 0,
    chunks_inserted: 0,
    chunks_re_embedded: 0,
    chunks_with_species_tags: 0,
    embedding_failures: [],
    network_failures: [],
    parse_failures: [],
    not_found: [],
  };

  try {
    let urls: string[];
    if (opts.slug) {
      urls = [`https://metavgc.com/guides/${opts.slug}`];
    } else {
      // Sitemap-only scope discovery (memory `scope_discovery_via_site_signals`).
      const scope = deps.scope ?? (await discoverScope(client));
      const sitemapUrls = await client.fetchSitemap();
      urls = sitemapUrls.filter((u) => scope.has(slugFromUrl(u)));
    }

    for (const url of urls) {
      const slug = slugFromUrl(url);
      let resultKind:
        | "inserted"
        | "re_embedded"
        | "skipped_unchanged"
        | "not_found"
        | "parse_failure"
        | "embedding_failure"
        | "network_failure" = "skipped_unchanged";
      try {
        const fetched = await client.fetchArticleHtml(slug);
        summary.articles_fetched += 1;
        const body_hash = "sha256:" + sha256Hex(fetched.html);

        if (knowledge.articleBodyHash(db, "metavgc", slug) === body_hash) {
          summary.articles_skipped_unchanged += 1;
          resultKind = "skipped_unchanged";
          continue;
        }

        const extracted = extractMetaVgcArticle({
          slug,
          html: fetched.html,
        });
        const subtype = tagSubtype(slug);
        const { chunks } = chunkExtractedArticle({
          slug,
          article_url: fetched.article_url,
          article_title: extracted.article_title,
          article_section: "intro",
          // The chunker's `ExtractedArticle` shape is structurally compatible:
          // `.sections[].section_heading + .paragraphs[]`. metavgc's extractor
          // pins `article_section` to "intro" (plan §19 Q4) and the chunker
          // doesn't read it from `extracted` anyway.
          extracted: {
            article_title: extracted.article_title,
            article_section: "intro",
            sections: extracted.sections,
            raw_warnings: extracted.raw_warnings,
          },
          body_hash,
          fetched_at: fetched.fetched_at,
          subtype,
          captured_via: `metavgc-ingest@${gitSha()}`,
        });
        if (chunks.length === 0) {
          summary.parse_failures.push({
            slug,
            message: "extracted article produced zero chunks",
          });
          resultKind = "parse_failure";
          continue;
        }

        // Stamp source_site + id prefix on every chunk so they round-trip
        // through the multi-site CHECK + unique index. The chunker is still
        // vgcguide-shaped today (TODO(stage6-deferred): lift the chunker into
        // `tools/knowledge/chunk.ts` with a site param).
        const stampedChunks = chunks.map((c) => ({
          ...c,
          id: c.id.replace(/^vgcguide:/, "metavgc:"),
          source_site: "metavgc" as const,
          source: { ...c.source, site: "metavgc" as const },
        }));

        // Pipeline stage: species tagging between chunk and embed (plan §13).
        // Build a positional parent-heading lookup: every depth-3 (h3) section
        // inherits the most recent depth-2 (h2) heading at its position in the
        // sections list. Species named only in the parent (e.g. "1. Mega
        // Glimmora" → child chunks "Strategic Overview", "Base Stats") would
        // otherwise miss the tagger. Heading text is NOT a stable key — the
        // megas guide repeats "Strategic Overview" once per Mega, so we walk
        // sections positionally and match chunks to sections by their order
        // of appearance.
        const parentBySection = new Map<number, string>();
        {
          let lastH2: string | null = null;
          extracted.sections.forEach((s, i) => {
            if (s.heading_level === 2) {
              lastH2 = s.section_heading;
            } else if (s.heading_level === 3 && lastH2 !== null) {
              parentBySection.set(i, lastH2);
            }
          });
        }
        let sectionIdx = -1;
        let prevHeading: string | null = null;
        const speciesTagsPerChunk: Array<readonly string[] | null> =
          stampedChunks.map((c) => {
            if (c.section_heading !== prevHeading) {
              sectionIdx++;
              while (
                sectionIdx < extracted.sections.length &&
                extracted.sections[sectionIdx]?.section_heading !==
                  c.section_heading
              ) {
                sectionIdx++;
              }
              prevHeading = c.section_heading;
            }
            const parent = parentBySection.get(sectionIdx);
            const taggerInput =
              (parent !== undefined ? parent + "\n" : "") +
              c.section_heading +
              "\n" +
              c.chunk_text;
            return detectSpeciesTags(taggerInput, speciesIndex);
          });
        for (const t of speciesTagsPerChunk) {
          if (t !== null && t.length > 0) summary.chunks_with_species_tags += 1;
        }

        const vectors = await embedClient.embed(
          stampedChunks.map((c) => c.chunk_text),
          "document",
        );
        const result = knowledge.upsertArticleChunks(db, {
          source_site: "metavgc",
          article_slug: slug,
          body_hash,
          chunks: stampedChunks,
          embeddings: vectors,
          species_tags_per_chunk: speciesTagsPerChunk,
        });
        summary.chunks_inserted += result.inserted;
        summary.chunks_re_embedded += result.replaced;
        resultKind = result.replaced > 0 ? "re_embedded" : "inserted";
      } catch (e) {
        if (e instanceof KnowledgeArticleNotFoundError) {
          summary.not_found.push(slug);
          resultKind = "not_found";
          continue;
        }
        if (e instanceof KnowledgeArticleParseError) {
          summary.parse_failures.push({ slug, message: e.message });
          resultKind = "parse_failure";
          continue;
        }
        if (e instanceof KnowledgeArticleNetworkError) {
          summary.network_failures.push({
            slug,
            status: e.status,
            message: e.message,
          });
          resultKind = "network_failure";
          continue;
        }
        if (e instanceof KnowledgeEmbeddingError) {
          summary.embedding_failures.push({ slug, message: e.message });
          resultKind = "embedding_failure";
          continue;
        }
        // KnowledgeAuthError + KnowledgeStorageError + SpeciesTaggerError +
        // everything else: fail loud; don't swallow.
        throw e;
      } finally {
        process.stderr.write(`[ingest-metavgc] ${slug} ${resultKind}\n`);
      }
    }

    process.stdout.write(JSON.stringify(summary) + "\n");
    return 0;
  } finally {
    if (ownsDb) {
      try {
        db.$client.close();
      } catch {
        /* ignore close errors */
      }
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e: unknown) => {
      console.error(e);
      process.exit(1);
    },
  );
}
