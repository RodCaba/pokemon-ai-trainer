/**
 * TAC-T44..T45 — `pnpm data:tactical` CLI smoke tests. Stage-4 red.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../../scripts/data/tactical";

let tmp: string;
let dbPath: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "tactical-cli-"));
  dbPath = join(tmp, "db.sqlite");
});
afterEach(() => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* noop */
  }
});

describe("tactical CLI (TAC-T44..T45)", () => {
  it("TAC-T44. `overview <team-id>` prints valid JSON to stdout, exit 0", async () => {
    const exit = await main([
      "overview",
      "--db",
      dbPath,
      "01H000000000000000000000T0",
    ]);
    expect(exit).toBe(0);
  });

  it("TAC-T45. pillars + plan subcommands dispatch (Stage B replaces recommend with plan)", async () => {
    const pillarsExit = await main([
      "pillars",
      "--db",
      dbPath,
      "01H000000000000000000000T0",
    ]);
    expect(pillarsExit).toBe(0);

    const planExit = await main([
      "plan",
      "--db",
      dbPath,
      "01H000000000000000000000T0",
    ]);
    expect(planExit).toBe(0);
  });
});
