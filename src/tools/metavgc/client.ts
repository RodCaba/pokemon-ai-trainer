/**
 * Stage 4 scaffold — signatures only. Stage 5 implements per
 * `docs/plans/metavgc-guides.md` §2.2.
 */

import type {
  KnowledgeArticleClient,
  KnowledgeArticleFetch,
} from "../knowledge/article-client";

/** Configuration for {@link createMetaVgcClient}. */
export interface MetaVgcClientOptions {
  cacheDir: string;
  throttleRps?: number;
  maxRetries?: number;
  backoffBaseMs?: number;
  cacheTtlMs?: number;
  fetchImpl?: typeof fetch;
  clock?: () => number;
}

export type MetaVgcArticleFetch = KnowledgeArticleFetch;

export type MetaVgcClient = KnowledgeArticleClient;

/**
 * Build a {@link MetaVgcClient}. Stage 4 stub — every method throws.
 */
export function createMetaVgcClient(_opts: MetaVgcClientOptions): MetaVgcClient {
  void _opts;
  return {
    async fetchSitemap(): Promise<string[]> {
      throw new Error("not implemented (Stage 5)");
    },
    async fetchArticleHtml(_slug: string): Promise<MetaVgcArticleFetch> {
      void _slug;
      throw new Error("not implemented (Stage 5)");
    },
  };
}
