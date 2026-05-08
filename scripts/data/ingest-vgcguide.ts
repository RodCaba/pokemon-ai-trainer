/**
 * CLI entry point for `pnpm data:ingest:vgcguide` (cron-driven; weekly).
 *
 * Argv:
 *   --db <path>        SQLite path (default ./data/db.sqlite).
 *   --no-network       cache-only (tests and dry runs).
 *   --slug <slug>      debug single-article mode; bypasses sitemap.
 *
 * Env vars:
 *   VOYAGE_API_KEY     required unless --no-network.
 *   VGCGUIDE_CACHE_DIR override cache directory (default data/cache/vgcguide).
 *
 * Exit codes:
 *   0  success (including bounded 404s / parse / network / embedding failures).
 *   1  KnowledgeAuthError, KnowledgeStorageError, DB error, uncaught exception.
 */

import { createHash } from "node:crypto";
import { open, type Db } from "../../src/db/open";
import * as knowledge from "../../src/db/knowledge";
import {
  createVgcGuideClient,
  type VgcGuideClient,
} from "../../src/tools/vgcguide/client";
import {
  createEmbedClient,
  type EmbedClient,
} from "../../src/tools/knowledge/embed";
import { extractVgcGuideArticle } from "../../src/tools/vgcguide/extract-article";
import { chunkExtractedArticle } from "../../src/tools/vgcguide/chunk";
import { tagSubtype } from "../../src/tools/vgcguide/tag-subtype";
import { inferSectionFromSlug } from "../../src/tools/vgcguide/section";
import { discoverScope } from "../../src/tools/vgcguide/discover-scope";
import {
  KnowledgeArticleNetworkError,
  KnowledgeArticleNotFoundError,
  KnowledgeArticleParseError,
  KnowledgeAuthError,
  KnowledgeEmbeddingError,
  KnowledgeStorageError,
} from "../../src/schemas/errors";

/** Injection slots for {@link main} — overridable in tests. */
export interface MainDeps {
  client?: VgcGuideClient;
  embedClient?: EmbedClient;
  /** Optional explicit DB handle override (not used by tests). */
  db?: Db;
  /**
   * Optional pre-computed scope, bypassing the nav∩sitemap discovery via
   * `discoverScope(client)`. Tests inject a synthetic small set so the
   * mock client doesn't have to serve the 3 section landing pages.
   * Production callers omit this — discovery runs against the live site.
   */
  scope?: Set<string>;
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
    } else if (a === "--slug") {
      out.slug = argv[++i] ?? null;
    }
  }
  return out;
}

function slugFromUrl(url: string): string {
  const m = url.match(/^https?:\/\/(?:www\.)?vgcguide\.com\/([^/?#]+)/i);
  return m?.[1] ?? url;
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function gitSha(): string {
  return process.env.GIT_SHA ?? "dev";
}

/**
 * Run the vgcguide ingest. Accepts argv (without `node script.js` prefix);
 * returns the exit code.
 *
 * **When to use it:** the cron / CLI entry point. Tests inject `client` +
 * `embedClient` to avoid real network and Voyage calls.
 *
 * @param argv — Argv slice.
 * @param deps — Optional injection slots; defaults wire to production.
 * @returns Process exit code (0 success, 1 fatal).
 */
export async function main(argv: string[], deps: MainDeps = {}): Promise<number> {
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
    createVgcGuideClient({
      cacheDir: process.env.VGCGUIDE_CACHE_DIR ?? "data/cache/vgcguide",
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

  const summary: RunSummary = {
    ok: true,
    articles_fetched: 0,
    articles_skipped_unchanged: 0,
    chunks_inserted: 0,
    chunks_re_embedded: 0,
    embedding_failures: [],
    network_failures: [],
    parse_failures: [],
    not_found: [],
  };

  try {
    let urls: string[];
    if (opts.slug) {
      urls = [`https://www.vgcguide.com/${opts.slug}`];
    } else {
      // Site-author-driven scope: nav∩sitemap intersection. The 3 section
      // landing pages declare what's in scope (their <main> content links);
      // the sitemap intersection eliminates broken/cart/UUID links. New
      // articles auto-include; new Spanish translations or event-logistics
      // pages auto-exclude. See `src/tools/vgcguide/discover-scope.ts`.
      // Tests inject `deps.scope` so the mock client doesn't need to serve
      // the 3 section landing pages.
      const scope = deps.scope ?? (await discoverScope(client));
      const sitemapUrls = await client.fetchSitemap();
      urls = sitemapUrls.filter((u) => scope.has(slugFromUrl(u)));
    }

    for (const url of urls) {
      const slug = slugFromUrl(url);
      const section = inferSectionFromSlug(slug);
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

        const dbHash = knowledge.articleBodyHash(db, slug);
        if (dbHash === body_hash) {
          summary.articles_skipped_unchanged += 1;
          resultKind = "skipped_unchanged";
          continue;
        }

        const extracted = extractVgcGuideArticle({
          slug,
          html: fetched.html,
          article_section: section,
        });
        const subtype = tagSubtype(slug);
        const { chunks } = chunkExtractedArticle({
          slug,
          article_url: fetched.article_url,
          article_title: extracted.article_title,
          article_section: section,
          extracted,
          body_hash,
          fetched_at: fetched.fetched_at,
          subtype,
          captured_via: `vgcguide-ingest@${gitSha()}`,
        });
        if (chunks.length === 0) {
          summary.parse_failures.push({
            slug,
            message: "extracted article produced zero chunks",
          });
          resultKind = "parse_failure";
          continue;
        }

        const vectors = await embedClient.embed(
          chunks.map((c) => c.chunk_text),
          "document",
        );
        const result = knowledge.upsertArticleChunks(db, {
          article_slug: slug,
          body_hash,
          chunks,
          embeddings: vectors,
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
        // KnowledgeAuthError + KnowledgeStorageError + everything else:
        // fail loud; don't swallow.
        throw e;
      } finally {
        process.stderr.write(`[ingest-vgcguide] ${slug} ${resultKind}\n`);
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
