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
 * Encode raw bytes as Crockford base32. The bytes are treated as a
 * big-endian unsigned integer; the output is left-padded to `len` chars.
 *
 * @param bytes — Buffer of arbitrary length.
 * @param len — Output length in characters.
 * @returns Crockford-base32 string of length `len`.
 */
function encodeBytes(bytes: Buffer, len: number): string {
  // Build the 32-bit-aligned bitstream by chunking; we use 5-bit chunks
  // walking right-to-left for stable padding behaviour.
  const totalBits = len * 5;
  const out: string[] = new Array(len);
  let bitsConsumed = 0;
  for (let i = len - 1; i >= 0; i--) {
    let bits = 0;
    let needed = 5;
    while (needed > 0 && bitsConsumed < bytes.length * 8) {
      const byteIdx = bytes.length - 1 - Math.floor(bitsConsumed / 8);
      const bitOffset = bitsConsumed % 8;
      const remaining = 8 - bitOffset;
      const take = Math.min(needed, remaining);
      const mask = (1 << take) - 1;
      const value = (bytes[byteIdx]! >> bitOffset) & mask;
      bits |= value << (5 - needed);
      needed -= take;
      bitsConsumed += take;
    }
    out[i] = CROCKFORD[bits & 0x1f]!;
  }
  void totalBits;
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
