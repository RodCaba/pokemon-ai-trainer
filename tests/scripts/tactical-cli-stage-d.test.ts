/**
 * Stage 4 — RED tests for Stage D tactical CLI output additions
 * (T1..T3 — plan §10).
 */

import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const CLI = join(process.cwd(), "scripts/data/tactical.ts");

function runCli(args: string[]): { stdout: string; code: number } {
  const r = spawnSync("pnpm", ["tsx", CLI, ...args], { encoding: "utf8" });
  return { stdout: r.stdout ?? "", code: r.status ?? -1 };
}

describe("tactical CLI Stage D (T1..T3)", () => {
  it("T1. `plan` output has phases[*].state populated on every phase", () => {
    const r = runCli(["plan", "--db", ":memory:", "01H000000000000000000000T0"]);
    expect(r.code).toBe(0);
    const j = JSON.parse(r.stdout) as {
      scenarios: Array<{ phases: Array<{ state?: unknown }> }>;
    };
    for (const sc of j.scenarios) {
      for (const p of sc.phases) {
        expect(p.state).toBeDefined();
      }
    }
  });

  it("T2. schema_version in emitted overview JSON is 5", () => {
    const r = runCli(["overview", "--db", ":memory:", "01H000000000000000000000T0"]);
    expect(r.code).toBe(0);
    const j = JSON.parse(r.stdout) as { schema_version: number };
    expect(j.schema_version).toBe(5);
  });

  it("T3. Stage B/C regression — late phase still carries cleaner + field", () => {
    const r = runCli(["plan", "--db", ":memory:", "01H000000000000000000000T0"]);
    expect(r.code).toBe(0);
    const j = JSON.parse(r.stdout) as {
      scenarios: Array<{ phases: Array<{ phase: string; cleaner?: string; field?: { weather: string } }> }>;
    };
    for (const sc of j.scenarios) {
      const late = sc.phases[2]!;
      expect(late.phase).toBe("late");
      expect(typeof late.cleaner).toBe("string");
      expect(late.field).toBeDefined();
    }
  });
});
