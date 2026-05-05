/**
 * Test T25 for `listTournaments`.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { listTournaments } from "../../../src/tools/labmaus/list-tournaments";
import type { LabmausClient } from "../../../src/tools/labmaus/client";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "..", "..", "..", "fixtures", "labmaus");

describe("listTournaments", () => {
  it("T25. returns parsed summaries from injected client fixture", async () => {
    const fixture = JSON.parse(
      readFileSync(join(FIX, "2026-05-04__completed_tournaments_regm-a_30d.json"), "utf8"),
    );
    const client: LabmausClient = {
      async listCompletedTournaments(): Promise<unknown> {
        return fixture;
      },
      async getTournament(): Promise<unknown> {
        throw new Error("unused");
      },
    };
    const out = await listTournaments(
      {
        regulation: "RegM-A",
        date_range: { from: "2026-04-06", to: "2026-05-04" },
      },
      { client },
    );
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.id).toBeTypeOf("number");
    expect(out[0]?.regulation).toBe("Regulation Set M-A");
  });
});
