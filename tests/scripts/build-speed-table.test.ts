/**
 * TAC-T46 — `scripts/data/build-speed-table.ts` regenerator. Stage-4 red.
 *
 * Per Stage-3 §16.2 (Q5 binding amendment): each entry carries
 * `nature_variants` so Jolly vs Adamant Garchomp are tracked distinctly.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../../scripts/data/build-speed-table";
import {
  SpeedTableSchema,
} from "../../src/data/tactical/speed-table";

let tmp: string;
let outPath: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "speed-table-"));
  outPath = join(tmp, "top50.json");
});
afterEach(() => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* noop */
  }
});

describe("build-speed-table (TAC-T46)", () => {
  it("TAC-T46. produces 50 entries with nature_variants summing to share=1.0; idempotent", async () => {
    const exit1 = await main(["--out", outPath]);
    expect(exit1).toBe(0);
    const first = readFileSync(outPath, "utf8");
    const parsed = SpeedTableSchema.parse(JSON.parse(first));
    expect(parsed.entries.length).toBe(50);

    // At least one entry has ≥ 2 nature variants, summing to 1.0
    const split = parsed.entries.find((e) => e.nature_variants.length >= 2);
    expect(split).toBeDefined();
    const total = split!.nature_variants.reduce((s, v) => s + v.share, 0);
    expect(Math.abs(total - 1.0)).toBeLessThan(1e-6);

    // Idempotent re-run
    const exit2 = await main(["--out", outPath]);
    expect(exit2).toBe(0);
    const second = readFileSync(outPath, "utf8");
    expect(second).toBe(first);
  });
});
