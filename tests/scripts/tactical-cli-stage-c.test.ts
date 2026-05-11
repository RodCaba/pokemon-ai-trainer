/**
 * Stage 4 — RED tests for the Stage C CLI output additions (T1..T3).
 */

import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const CLI = join(process.cwd(), "scripts/data/tactical.ts");

function runCli(args: string[]): { stdout: string; code: number } {
  const r = spawnSync("pnpm", ["tsx", CLI, ...args], { encoding: "utf8" });
  return { stdout: r.stdout ?? "", code: r.status ?? -1 };
}

describe("tactical CLI Stage C (T1..T3)", () => {
  it("T1. `plan` output has phases[*].field on every phase", () => {
    const r = runCli(["plan", "--db", ":memory:", "01H000000000000000000000T0"]);
    expect(r.code).toBe(0);
    const j = JSON.parse(r.stdout) as {
      scenarios: Array<{ phases: Array<{ field?: { weather: string } }> }>;
    };
    for (const sc of j.scenarios) {
      for (const p of sc.phases) {
        expect(p.field).toBeDefined();
      }
    }
  });

  it("T2. schema_version in emitted overview JSON is 4", () => {
    const r = runCli(["overview", "--db", ":memory:", "01H000000000000000000000T0"]);
    expect(r.code).toBe(0);
    const j = JSON.parse(r.stdout) as { schema_version: number };
    expect(j.schema_version).toBe(4);
  });

  it("T3. Stage B regression — late phase carries cleaner role mon (smoke)", () => {
    const r = runCli(["plan", "--db", ":memory:", "01H000000000000000000000T0"]);
    expect(r.code).toBe(0);
    const j = JSON.parse(r.stdout) as {
      scenarios: Array<{ phases: Array<{ phase: string; cleaner?: string }> }>;
    };
    for (const sc of j.scenarios) {
      const late = sc.phases[2]!;
      expect(late.phase).toBe("late");
      expect(typeof late.cleaner).toBe("string");
    }
  });
});
