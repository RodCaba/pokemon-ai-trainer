/**
 * Stage 4 — RED tests for the tactical CLI replacement (CLI1..CLI3).
 *
 * Q4 / Q7 §17: `recommend` / `recommend-leads` subcommand is REMOVED;
 * `plan` is the replacement.
 */

import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const CLI = join(process.cwd(), "scripts/data/tactical.ts");

function runCli(args: string[]): { stdout: string; stderr: string; code: number } {
  const r = spawnSync("pnpm", ["tsx", CLI, ...args], { encoding: "utf8" });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", code: r.status ?? -1 };
}

describe("tactical CLI Stage B (CLI1..CLI3)", () => {
  it("CLI1. `plan <team-id>` subcommand exists and accepts a saved team id", () => {
    const r = runCli(["plan", "--db", ":memory:", "01H000000000000000000000T0"]);
    // The synthetic test team is recognized; output must be valid JSON.
    expect(r.code).toBe(0);
    expect(() => JSON.parse(r.stdout)).not.toThrow();
  });

  it("CLI2. `plan` output JSON contains phases on each scenario", () => {
    const r = runCli(["plan", "--db", ":memory:", "01H000000000000000000000T0"]);
    const j = JSON.parse(r.stdout) as { scenarios?: Array<{ phases?: Array<{ phase: string }> }> };
    expect(Array.isArray(j.scenarios)).toBe(true);
    for (const sc of j.scenarios ?? []) {
      expect(sc.phases).toBeDefined();
      expect(sc.phases).toHaveLength(3);
    }
  });

  it("CLI3. legacy `recommend` / `recommend-leads` subcommand prints unknown-subcommand error", () => {
    const r1 = runCli(["recommend", "--db", ":memory:", "01H000000000000000000000T0"]);
    const r2 = runCli(["recommend-leads", "--db", ":memory:", "01H000000000000000000000T0"]);
    expect(r1.code).not.toBe(0);
    expect(r2.code).not.toBe(0);
    expect((r1.stderr + r2.stderr).toLowerCase()).toMatch(/unknown|invalid|removed/);
  });
});
