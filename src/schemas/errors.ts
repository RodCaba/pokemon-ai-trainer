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

export class NotImplementedError extends Error {
  constructor(method: string) {
    super(`v1 stub: ${method} is not yet implemented; vector tier lands in a later milestone`);
    this.name = "NotImplementedError";
  }
}
