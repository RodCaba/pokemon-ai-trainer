/**
 * Base class for every error thrown by the damage-calc tool family.
 *
 * Carries `.cause` (the underlying error if there was one) and `.input` (the offending
 * payload, copied verbatim) so callers and tests can reproduce, log, and report failures
 * without `.message` string-sniffing.
 *
 * **When to use it:** as a `try { ... } catch (e) { if (e instanceof CalcError) ... }`
 * type guard when you want to handle "any calc failure" without distinguishing input
 * vs. engine. For specific cases, catch `CalcInputError` or `CalcEngineError` directly.
 */
export class CalcError extends Error {
  override readonly cause?: unknown;
  readonly input?: unknown;
  constructor(message: string, opts?: { cause?: unknown; input?: unknown }) {
    super(message);
    this.name = this.constructor.name;
    this.cause = opts?.cause;
    this.input = opts?.input;
  }
}

/**
 * Thrown by `damage_calc` when the input is invalid — schema rejection, Reg M-A bans,
 * SPS cap violations, unknown species/move/ability/item, or status (non-damaging) move.
 *
 * **When to use it:** never construct directly outside the calc tool. Catch in callers
 * to surface "user input was wrong" diagnostics with `.input` and `.cause` for context.
 */
export class CalcInputError extends CalcError {}

/**
 * Thrown by `damage_calc` when the `@smogon/calc` engine itself throws, or when a
 * post-condition on engine output fails (e.g., description leaked "Tera" text).
 *
 * **When to use it:** never construct directly outside the calc tool. Catch in callers
 * to surface "the engine blew up" — distinct from `CalcInputError` so callers can decide
 * whether to retry, fall back, or alert.
 */
export class CalcEngineError extends CalcError {}

/**
 * Base class for every error thrown by the roster DB / repos / build pipeline.
 *
 * Carries `.cause` (the underlying error, if any) and `.query` (the offending input —
 * species name, search query, etc.) so callers can reproduce and report failures.
 */
export class RosterError extends Error {
  override readonly cause?: unknown;
  readonly query?: unknown;
  constructor(msg: string, opts?: { cause?: unknown; query?: unknown }) {
    super(msg);
    this.name = this.constructor.name;
    this.cause = opts?.cause;
    this.query = opts?.query;
  }
}

/**
 * Thrown when a species/item/ability/move is requested but doesn't exist in the DB.
 *
 * **When to use it:** never construct directly outside the roster repos. The default
 * `roster.get(...)` returns `null` on miss; this class is reserved for the opt-in
 * `getOrThrow()` helper and for build-time integrity checks.
 */
export class RosterNotFoundError extends RosterError {}

/**
 * Thrown by the build pipeline when an integrity invariant is violated (e.g., a
 * `species_abilities` row references an unknown ability).
 *
 * **When to use it:** never construct directly outside the build pipeline. Callers
 * see this when something is wrong with the committed `db.sqlite` itself, which
 * should never happen if Stage 5's tests are green.
 */
export class RosterDataError extends RosterError {}

/**
 * Thrown by repos when SQLite I/O fails (closed handle, locked file, corrupt page,
 * etc.) — wraps the underlying `better-sqlite3` error.
 */
export class RosterDbError extends RosterError {}

/**
 * Thrown by stub implementations whose behavior isn't wired in v1.
 *
 * **When to use it:** the v1 vector tier (`InsightStore`) is interface-only — `add` and
 * `search` throw this to signal "this method exists for shape compatibility but won't
 * do anything until the real backing store lands." Catch in any code path that needs
 * to gracefully degrade when the vector tier isn't ready yet.
 *
 * `message` always starts with `"v1 stub:"` so callers and reviewers can grep for it.
 */
/**
 * Base class for every error thrown by the labmaus tool family
 * (`labmaus.listTournaments`, `labmaus.getTournament`, species-map, transform).
 *
 * Carries `.cause` and `.query` like {@link RosterError}; storage-layer issues
 * inside the labmaus repos still throw {@link RosterDbError}/{@link RosterDataError}.
 *
 * **When to use it:** as a `try { ... } catch (e) { if (e instanceof LabmausError) ... }`
 * type guard for "anything went wrong with labmaus ingest." For specific cases catch the
 * concrete subclass.
 */
export class LabmausError extends Error {
  override readonly cause?: unknown;
  readonly query?: unknown;
  constructor(msg: string, opts?: { cause?: unknown; query?: unknown }) {
    super(msg);
    this.name = this.constructor.name;
    this.cause = opts?.cause;
    this.query = opts?.query;
  }
}

/** Tool-input zod failure (bad date range, wrong regulation, etc.). */
export class LabmausInputError extends LabmausError {}
/** HTTP non-2xx after retries exhausted, DNS, timeout. */
export class LabmausNetworkError extends LabmausError {}
/** Raw labmaus response failed `LabmausRawTournamentSchema` (upstream drift). */
export class LabmausSchemaError extends LabmausError {}
/** A labmaus species id has no roster mapping. Carries the offending id in `.query`. */
export class LabmausUnknownSpeciesError extends LabmausError {}

/**
 * Base class for every error thrown by the pokepaste tool family
 * (`pokepaste.fetchPaste`, transform, client). Carries `.cause` and
 * optional `.paste_id` so callers and tests can grep for the offending
 * paste without `.message` string-sniffing.
 */
export class PokepasteError extends Error {
  override readonly cause?: unknown;
  readonly paste_id?: string;
  constructor(msg: string, opts?: { cause?: unknown; paste_id?: string }) {
    super(msg);
    this.name = this.constructor.name;
    this.cause = opts?.cause;
    this.paste_id = opts?.paste_id;
  }
}

/** Tool-input zod failure (malformed paste id, etc.). */
export class PokepasteInputError extends PokepasteError {}

/** HTTP non-2xx (other than 404) after retries; DNS / timeout. */
export class PokepasteNetworkError extends PokepasteError {
  readonly status?: number;
  constructor(msg: string, opts?: { cause?: unknown; paste_id?: string; status?: number }) {
    super(msg, opts);
    this.status = opts?.status;
  }
}

/** HTTP 404 — paste not found / deleted. */
export class PokepasteNotFoundError extends PokepasteError {}

/**
 * The Showdown export was unparseable (`@pkmn/sets` returned `undefined`,
 * `.team.length === 0`, or completeness fell below `"minimal"`).
 */
export class PokepasteParseError extends PokepasteError {}

/**
 * An unknown item / ability / move encountered while validating against the
 * Champions ref tables. Reject-and-fail per `docs/plans/pokepaste-sets.md`
 * §8.1 — the transform throws and refuses to produce partial output. The
 * ingest hook catches this per-team and continues.
 */
export class PokepasteRefValidationError extends PokepasteError {
  readonly kind: "item" | "ability" | "move";
  readonly value: string;
  readonly slot: number;
  constructor(
    msg: string,
    opts: {
      cause?: unknown;
      paste_id?: string;
      kind: "item" | "ability" | "move";
      value: string;
      slot: number;
    },
  ) {
    super(msg, opts);
    this.kind = opts.kind;
    this.value = opts.value;
    this.slot = opts.slot;
  }
}

/** A species name parsed out of the paste isn't in the Champions roster. */
export class PokepasteUnknownSpeciesError extends PokepasteError {
  readonly species: string;
  constructor(msg: string, opts: { cause?: unknown; paste_id?: string; species: string }) {
    super(msg, opts);
    this.species = opts.species;
  }
}

/**
 * Base class for every error thrown by the pikalytics tool family
 * (`pikalytics.fetchSpecies`, `pikalytics.{get,teammates,usage}`, parse,
 * transform, client). Carries `.cause` and optional `.species_roster_id`.
 *
 * **When to use it:** as a `try { ... } catch (e) { if (e instanceof PikalyticsError) ... }`
 * type guard for "anything went wrong with pikalytics ingest." For specific cases
 * catch the concrete subclass.
 */
export class PikalyticsError extends Error {
  override readonly cause?: unknown;
  readonly species_roster_id?: string;
  constructor(msg: string, opts?: { cause?: unknown; species_roster_id?: string }) {
    super(msg);
    this.name = this.constructor.name;
    this.cause = opts?.cause;
    this.species_roster_id = opts?.species_roster_id;
  }
}

/** Tool-input zod failure (unknown roster id, bad limit, etc.). */
export class PikalyticsInputError extends PikalyticsError {}

/** HTTP non-2xx (other than 404) after retries; DNS / timeout. */
export class PikalyticsNetworkError extends PikalyticsError {
  readonly status?: number;
  constructor(
    msg: string,
    opts?: { cause?: unknown; species_roster_id?: string; status?: number },
  ) {
    super(msg, opts);
    this.status = opts?.status;
  }
}

/** HTTP 404 — species not in pikalytics's coverage for this format. */
export class PikalyticsNotFoundError extends PikalyticsError {}

/**
 * Markdown parser couldn't extract the required `as_of` (or other strict
 * sections). Optional sections missing are NOT errors.
 */
export class PikalyticsParseError extends PikalyticsError {}

/**
 * Defense-in-depth: a `tera_*`-named key surfaced in the parsed structure or
 * assembled snapshot. **Programmer-bug class — fail loud.**
 */
export class PikalyticsTeraLeakError extends PikalyticsError {}

/**
 * Base class for every error thrown by the knowledge article-fetch family
 * (`vgcguide.client`, `metavgc.client`, `extract-article`, etc.).
 *
 * **When to use it:** as a `try { ... } catch (e) { if (e instanceof KnowledgeArticleError) ... }`
 * type guard for "anything went wrong fetching/parsing an article from one of
 * our knowledge-base sources." For specific cases catch the concrete subclass.
 *
 * Carries `.cause`, `.article_slug`, and `.source_site` so the per-site
 * adapter that throws can surface its identity to the catch ladder.
 */
export class KnowledgeArticleError extends Error {
  override readonly cause?: unknown;
  readonly article_slug?: string;
  readonly source_site?: "vgcguide" | "metavgc";
  constructor(
    msg: string,
    opts?: {
      cause?: unknown;
      article_slug?: string;
      source_site?: "vgcguide" | "metavgc";
    },
  ) {
    super(msg);
    this.name = this.constructor.name;
    this.cause = opts?.cause;
    this.article_slug = opts?.article_slug;
    this.source_site = opts?.source_site;
  }
}

/**
 * HTTP non-2xx (other than 404) after retry exhaustion, DNS, timeout — thrown
 * by any knowledge-article HTTP client (vgcguide, metavgc).
 *
 * **When to use it:** catch in ingest scripts to log per-article network
 * failures into the run summary's `network_failures[]` and continue.
 */
export class KnowledgeArticleNetworkError extends KnowledgeArticleError {
  readonly status?: number;
  constructor(
    msg: string,
    opts?: {
      cause?: unknown;
      article_slug?: string;
      source_site?: "vgcguide" | "metavgc";
      status?: number;
    },
  ) {
    super(msg, opts);
    this.status = opts?.status;
  }
}

/**
 * HTTP 404 from sitemap or article fetch — article-class miss.
 *
 * **When to use it:** catch in ingest scripts to log into `not_found[]` and
 * continue without re-tagging the whole run as failed.
 */
export class KnowledgeArticleNotFoundError extends KnowledgeArticleError {}

/**
 * Extractor returned empty body — missing per-site body container
 * (`.sqs-html-content` for vgcguide, `<article>` / `<main>` for metavgc).
 *
 * **When to use it:** catch in ingest scripts to log into `parse_failures[]`
 * and continue.
 */
export class KnowledgeArticleParseError extends KnowledgeArticleError {}

/** Programmer-class: empty species index at ingest start. */
export class SpeciesTaggerError extends Error {
  override readonly cause?: unknown;
  constructor(msg: string, opts?: { cause?: unknown }) {
    super(msg);
    this.name = "SpeciesTaggerError";
    this.cause = opts?.cause;
  }
}

/**
 * Base class for every error thrown by the knowledge embedding / storage path
 * (`knowledge.embed`, `knowledge.search`, `knowledge.upsertArticleChunks`,
 * `loadSqliteVec`). Carries `.cause` and optional `.article_slug`.
 */
export class KnowledgeError extends Error {
  override readonly cause?: unknown;
  readonly article_slug?: string;
  constructor(msg: string, opts?: { cause?: unknown; article_slug?: string }) {
    super(msg);
    this.name = this.constructor.name;
    this.cause = opts?.cause;
    this.article_slug = opts?.article_slug;
  }
}

/**
 * Voyage 4xx/5xx after retry exhaustion — article-level. Aborts the article,
 * logged into `embedding_failures[]` by ingest.
 */
export class KnowledgeEmbeddingError extends KnowledgeError {}

/**
 * Voyage 401/403 or `VOYAGE_API_KEY` env var missing/empty. Operator class —
 * fail loud at startup or on first call.
 */
export class KnowledgeAuthError extends KnowledgeError {}

/**
 * sqlite-vec extension not loadable, vector dimension mismatch on insert,
 * virtual-table corruption. Programmer/operator class — fail loud.
 */
export class KnowledgeStorageError extends KnowledgeError {}

/**
 * Base class for every error thrown by the user-teams slice
 * (`src/db/user-teams.ts`, `src/data/user-teams/*`, `src/data/team-validate.ts`).
 *
 * Carries `.cause` and optional `.team_id` so callers and tests can grep
 * for the offending team without `.message` string-sniffing. Storage-layer
 * issues inside the user-teams repo still throw `RosterDbError` /
 * `RosterDataError` per the labmaus precedent.
 */
export class UserTeamError extends Error {
  override readonly cause?: unknown;
  readonly team_id?: string;
  constructor(msg: string, opts?: { cause?: unknown; team_id?: string }) {
    super(msg);
    this.name = this.constructor.name;
    this.cause = opts?.cause;
    this.team_id = opts?.team_id;
  }
}

/**
 * Thrown by `setStatus('saved')` when the team has any `errors` on
 * `validateTeam`. Warnings do NOT block save (per Stage-2 Q5).
 *
 * Carries the full `ValidationResult` on `.result` so callers and tests
 * can inspect codes rather than parsing prose.
 */
export class UserTeamValidationError extends UserTeamError {
  readonly result: { errors: unknown[]; warnings: unknown[] };
  constructor(
    msg: string,
    opts: {
      cause?: unknown;
      team_id?: string;
      result: { errors: unknown[]; warnings: unknown[] };
    },
  ) {
    super(msg, opts);
    this.result = opts.result;
  }
}

/** Thrown by `update`/`upsertSet`/`setStatus`/`delete`/`restoreRevision` against an unknown team id. */
export class UserTeamNotFoundError extends UserTeamError {}

/** Thrown by `restoreRevision` when `(team_id, revision_number)` doesn't exist. */
export class UserTeamRevisionNotFoundError extends UserTeamError {
  readonly revision_number?: number;
  constructor(
    msg: string,
    opts?: { cause?: unknown; team_id?: string; revision_number?: number },
  ) {
    super(msg, opts);
    this.revision_number = opts?.revision_number;
  }
}

/**
 * Thrown by repository / data-layer code paths in user-teams when a
 * persisted blob can't be assembled (e.g. a corrupt JSON column). Surfaces
 * the storage-error class for parity with the other user-team families.
 */
export class UserTeamStorageError extends UserTeamError {}

/**
 * Base class for every error thrown by the team-tactical-overview slice
 * (`src/data/tactical/*`, `src/agents/tactical-tools.ts`).
 *
 * Carries `.cause` and optional `.team_id` so callers and tests can grep
 * for the offending team without `.message` string-sniffing.
 */
export class TacticalError extends Error {
  override readonly cause?: unknown;
  readonly team_id?: string;
  constructor(msg: string, opts?: { cause?: unknown; team_id?: string }) {
    super(msg);
    this.name = this.constructor.name;
    this.cause = opts?.cause;
    this.team_id = opts?.team_id;
  }
}

/**
 * Thrown by `buildOverview` / `score_pillars` / `recommend_leads` when the
 * team isn't in a scoreable state — `status='draft'`, has any
 * `validation_errors`, or is unknown.
 */
export class TacticalOverviewError extends TacticalError {}

/**
 * Thrown by `buildThreatPanel` when both pikalytics_snapshots and
 * labmaus team_sets are empty for the format. Not recoverable in-process
 * — needs ingest.
 */
export class TacticalThreatPanelError extends TacticalError {}

/**
 * Thrown by `generateScenarios` when fewer than 3 scenarios can be
 * produced (insufficient labmaus / pikalytics data).
 */
export class TacticalScenarioError extends TacticalError {}

/**
 * Thrown when the `damage_calc` engine fails systemically (> 50% of
 * pairs throw). Distinct from per-pair skip-and-continue.
 */
export class TacticalCalcEngineError extends TacticalError {}

/**
 * Base class for failures raised by the `youtube-transcript` wrapper +
 * watch-page metadata fetch. `kind` discriminates the article-class buckets
 * used by the ingest catch ladder. See `docs/plans/youtube-insights.md` §8.
 */
export class YoutubeFetchError extends Error {
  override readonly cause?: unknown;
  readonly video_id: string;
  readonly kind:
    | "no_captions"
    | "disabled"
    | "private"
    | "network"
    | "non_english";
  constructor(opts: {
    message?: string;
    cause?: unknown;
    video_id: string;
    kind: YoutubeFetchError["kind"];
  }) {
    super(opts.message ?? `youtube fetch failed (${opts.kind}) for ${opts.video_id}`);
    this.name = "YoutubeFetchError";
    this.cause = opts.cause;
    this.video_id = opts.video_id;
    this.kind = opts.kind;
  }
}

/**
 * Base class for failures raised by `extractInsights`. `kind` discriminates
 * article-class (`rate_limit`, `schema_violation` — recoverable, log + skip)
 * from operator-class (`anthropic_error` — fail loud) per plan §8.
 */
export class InsightExtractionError extends Error {
  override readonly cause?: unknown;
  readonly chunk_id: string;
  readonly kind: "rate_limit" | "schema_violation" | "anthropic_error";
  constructor(opts: {
    message?: string;
    cause?: unknown;
    chunk_id: string;
    kind: InsightExtractionError["kind"];
  }) {
    super(opts.message ?? `insight extraction failed (${opts.kind}) for ${opts.chunk_id}`);
    this.name = "InsightExtractionError";
    this.cause = opts.cause;
    this.chunk_id = opts.chunk_id;
    this.kind = opts.kind;
  }
}

export class NotImplementedError extends Error {
  constructor(method: string) {
    super(`v1 stub: ${method} is not yet implemented; vector tier lands in a later milestone`);
    this.name = "NotImplementedError";
  }
}
