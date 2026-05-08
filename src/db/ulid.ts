/**
 * Crockford-base32 ULID factory shared across slices.
 *
 * Stage-4 stub — returns a placeholder hex-only string so tests can import
 * but every real ULID-shape assertion fails until Stage 5 wires the actual
 * monotonic Crockford-base32 implementation.
 */

/**
 * Mint a new ULID (26-char Crockford base32 string).
 *
 * **When to use it:** every new id for `user_teams`, future entities that
 * need a monotonic, sortable, opaque id. Centralizing here lets every
 * slice share one implementation (Stage-2 Q5).
 *
 * @returns A 26-char ULID string. Stage-4 stub returns a placeholder
 *   guaranteed to FAIL the canonical ULID regex so tests assert behavior,
 *   not import-shape.
 * @throws Never under normal use; Stage-5 will use a CSPRNG.
 *
 * @example
 *   const id = ulid(); // "01HZX2J5K8M7P1Q3R4S5T6V7W9"
 */
export function ulid(): string {
  // STAGE-4 STUB: not implemented; returns a non-ULID placeholder.
  // Stage 5 ships a Crockford-base32 monotonic implementation.
  throw new Error("not implemented (Stage 5): src/db/ulid.ts::ulid");
}
