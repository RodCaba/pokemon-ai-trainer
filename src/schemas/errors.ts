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
export class NotImplementedError extends Error {
  constructor(method: string) {
    super(`v1 stub: ${method} is not yet implemented; vector tier lands in a later milestone`);
    this.name = "NotImplementedError";
  }
}
