import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../src/cli/tool-roster";
import { open } from "../../src/db/open";

const REAL_DB = "data/reg-m-a/db.sqlite";

describe("pnpm tool:roster CLI", () => {
  it("1. `tool:roster Garchomp` exits 0 and prints display name + base stats", async () => {
    const r = await main(["Garchomp"], { dbPath: REAL_DB });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/Species:\s+Garchomp \(garchomp\)/);
    expect(r.stdout).toMatch(/Stats:\s+HP 108/);
    expect(r.stdout).toMatch(/Atk 130/);
    expect(r.stdout).toMatch(/BST 600/);
    expect(r.stdout).toMatch(/Types:\s+Dragon \/ Ground/);
  });

  it("2. `--json` flag emits a JSON-parseable Pokemon", async () => {
    const r = await main(["Garchomp", "--json"], { dbPath: REAL_DB });
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout) as { id: string; display_name: string; base_stats: { hp: number } };
    expect(parsed.id).toBe("garchomp");
    expect(parsed.display_name).toBe("Garchomp");
    expect(parsed.base_stats.hp).toBe(108);
  });

  it("3. exits 1 with RosterDataError message when the repo throws (mocked corruption)", async () => {
    // Mock roster.get to throw a RosterDataError, simulating a corrupt row in the DB.
    const rosterModule = await import("../../src/db/roster");
    const { RosterDataError } = await import("../../src/schemas/errors");
    const spy = vi.spyOn(rosterModule, "get").mockImplementation(() => {
      throw new RosterDataError("species_stats missing for garchomp", { query: "garchomp" });
    });
    try {
      const r = await main(["Garchomp"], { dbPath: REAL_DB });
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toMatch(/RosterDataError/);
      expect(r.stderr).toMatch(/species_stats missing/);
    } finally {
      spy.mockRestore();
    }
  });

  it("4. exits 2 when species is unknown", async () => {
    const r = await main(["DefinitelyNotAPokemonName"], { dbPath: REAL_DB });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/not found/);
  });

  it("5. case-insensitive: `tool:roster garchomp` works (matches `Garchomp`)", async () => {
    const r = await main(["garchomp"], { dbPath: REAL_DB });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/Species:\s+Garchomp \(garchomp\)/);
  });

  it("6. `--help` exits 0 and prints usage on stdout", async () => {
    const r = await main(["--help"], { dbPath: REAL_DB });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/Usage:/);
    expect(r.stderr).toBe("");
  });

  it("7. no positional and no --help exits 64 with usage on stderr", async () => {
    const r = await main([], { dbPath: REAL_DB });
    expect(r.exitCode).toBe(64);
    expect(r.stderr).toMatch(/Usage:/);
    expect(r.stdout).toBe("");
  });

  it("8. empty DB (migrations only, no data) → species-not-found exit 2", async () => {
    // Open a tmp file once to apply migrations, then close — leaves an empty DB
    // on disk that the CLI can re-open readonly.
    const workDir = mkdtempSync(join(tmpdir(), "tool-roster-"));
    const emptyPath = join(workDir, "empty.sqlite");
    try {
      const seedDb = open(emptyPath);
      seedDb.$client.close();
      const r = await main(["Garchomp"], { dbPath: emptyPath });
      expect(r.exitCode).toBe(2);
      expect(r.stderr).toMatch(/not found/);
    } finally {
      try { unlinkSync(emptyPath); } catch { /* ignore */ }
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});
