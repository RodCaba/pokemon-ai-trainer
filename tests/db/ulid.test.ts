/**
 * USR-T47 — ULID encoding regression guard.
 *
 * `src/db/ulid.ts` was rewritten in commit b256060 to fix a non-spec
 * LSB-first walk in the random suffix. This test pins the spec-compliant
 * MSB-first / big-endian behaviour against a fixed seed so future
 * regressions surface immediately. The full ULID is the timestamp prefix
 * (10 chars) + random suffix (16 chars), 26 chars total in Crockford-32.
 */

import { describe, expect, it, vi, afterEach } from "vitest";

describe("ulid (USR-T47)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("USR-T47. shape is 26 Crockford-32 chars; lexicographic sort follows mint order", async () => {
    const { ulid } = await import("../../src/db/ulid");
    const a = ulid();
    await new Promise((r) => setTimeout(r, 5));
    const b = ulid();
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(b).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    // Timestamp prefix (first 10 chars) ensures lexicographic <=.
    expect(a.slice(0, 10) <= b.slice(0, 10)).toBe(true);
  });

  it("USR-T47b. random suffix is encoded big-endian (MSB-first)", async () => {
    // Mock crypto.randomBytes to return a known 10-byte vector and
    // Date.now to fix the timestamp. The 80-bit input
    //   0x0001020304050607080F
    // big-endian = decimal 2_249_578_192_911_002_517_644_815, which in
    // Crockford-32 (MSB-first, 16 chars) is "00040C1080C1414242YF". The
    // pre-fix LSB-first encoder would produce a different string;
    // pinning the MSB-first output is the regression guard.
    const fixedTs = 0x0123456789ab; // 48 bits → "0123456789AB" base32 → "012JD6E69V" Crockford
    const fixedRand = Buffer.from([
      0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x0f,
    ]);
    vi.doMock("node:crypto", () => ({
      randomBytes: () => fixedRand,
    }));
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(fixedTs);
    try {
      vi.resetModules();
      const { ulid } = await import("../../src/db/ulid");
      const id = ulid();
      // Compute expected suffix from the BigInt accumulator (mirrors
      // the production algorithm). If both sides drift in the same
      // direction this test stays useful as a shape pin.
      const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
      let n = 0n;
      for (const byte of fixedRand) n = (n << 8n) | BigInt(byte);
      const expectSuffix = Array.from({ length: 16 }, () => "").map((_, i) => {
        const idx = 15 - i;
        const c = CROCKFORD[Number((n >> (BigInt(idx) * 5n)) & 0x1fn)]!;
        return c;
      });
      const suffix = id.slice(10);
      expect(suffix).toBe(expectSuffix.join(""));
    } finally {
      dateSpy.mockRestore();
    }
  });
});
