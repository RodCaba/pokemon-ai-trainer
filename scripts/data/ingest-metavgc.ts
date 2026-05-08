/**
 * Stage 4 scaffold — signatures only. Stage 5 implements per
 * `docs/plans/metavgc-guides.md` §2.4.
 */

import type { Db } from "../../src/db/open";
import type { KnowledgeArticleClient } from "../../src/tools/knowledge/article-client";
import type { EmbedClient } from "../../src/tools/knowledge/embed";

export interface MainDeps {
  client?: KnowledgeArticleClient;
  embedClient?: EmbedClient;
  db?: Db;
  scope?: Set<string>;
}

export async function main(_argv: string[], _deps: MainDeps = {}): Promise<number> {
  void _argv;
  void _deps;
  throw new Error("not implemented (Stage 5)");
}
