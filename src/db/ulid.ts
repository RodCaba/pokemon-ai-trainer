/**
 * Crockford-base32 ULID factory shared across slices (Stage-2 Q5).
 *
 * 26-character ULID per the spec (https://github.com/ulid/spec):
 *   10 chars  — 48-bit timestamp (ms since Unix epoch), big-endian
 *   16 chars  — 80-bit randomness from `crypto.randomBytes`
 *
 * Considered the `ulid` npm package; rejected per CLAUDE.md "no new deps
 * without justification" and plan §9 ("ulid generation already exists in
 * the labmaus / vgcguide ingest scripts; factor into a tiny `src/db/ulid.ts`").
 * The implementation below is ~40 LOC, dep-free, and matches the spec.
 */

import { randomBytes } from "node:crypto";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Encode a non-negative integer as Crockford base32, left-padded to `len`.
 *
 * @param value — Non-negative integer.
 * @param len — Output length in characters.
 * @returns Crockford-base32 string of length `len`.
 */
function encodeInt(value: number, len: number): string {
  let n = value;
  let s = "";
  for (let i = 0; i < len; i++) {
    const mod = n % 32;
    s = CROCKFORD[mod] + s;
    n = Math.floor(n / 32);
  }
  return s;
}

/**
 * Encode raw bytes as Crockford base32 with big-endian, MSB-first walk
 * per the ULID spec. `bytes` are treated as one big-endian integer, then
 * encoded into `len` 5-bit groups left-to-right (most-significant first).
 *
 * @param bytes — Buffer of arbitrary length. `bytes.length * 8` should be
 *   `≤ len * 5`; extra high bits are discarded by the BigInt mask.
 * @param len — Output length in characters.
 * @returns Crockford-base32 string of length `len`.
 */
function encodeBytes(bytes: Buffer, len: number): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  const out: string[] = new Array(len);
  for (let i = len - 1; i >= 0; i--) {
    out[i] = CROCKFORD[Number(n & 0x1fn)]!;
    n >>= 5n;
  }
  return out.join("");
}

/**
 * Mint a fresh ULID (26-char Crockford-base32).
 *
 * **When to use it:** every new id for `user_teams` and any future entity
 * that needs a monotonic, sortable, opaque id. Centralised here so every
 * slice shares one implementation (Stage-2 Q5).
 *
 * @returns A 26-character ULID string. The first 10 chars encode the
 *   current time in ms since Unix epoch (so ulids sort lexicographically
 *   in mint order); the remaining 16 chars are cryptographically random.
 * @throws Never under normal use. The underlying `crypto.randomBytes` may
 *   throw if the OS RNG is unavailable, in which case the error bubbles.
 *
 * @example
 *   ulid(); // "01HZX2J5K8M7P1Q3R4S5T6V7W9"
 */
export function ulid(): string {
  const ts = Date.now();
  // 48-bit timestamp -> 10 base32 chars. JS `number` safely covers 48 bits.
  const tsPart = encodeInt(ts, 10);
  const rand = randomBytes(10);
  const randPart = encodeBytes(rand, 16);
  return tsPart + randPart;
}
