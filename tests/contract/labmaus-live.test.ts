/**
 * Test T40 — contract test against live labmaus.
 *
 * Gated by `RUN_CONTRACT_TESTS=1` per plan §10 / CLAUDE.md §3 ("contract tests
 * skipped in CI by default, run via `pnpm test:contract`"). Hits a known stable
 * tournament id and asserts our raw schema still parses the response.
 */

import { describe, expect, it } from "vitest";
import { LabmausRawTournamentSchema } from "../../src/schemas/tournament";

const RUN = process.env.RUN_CONTRACT_TESTS === "1";

describe.runIf(RUN)("labmaus-live contract", () => {
  it("T40. live labmaus.getTournament(56757) matches our raw schema", async () => {
    const res = await fetch(
      "https://labmaus.net/api/tournament?tournament=56757&language=en",
      {
        headers: {
          "User-Agent": "pokemon-ai-trainer-contract-test/0.1",
          Origin: "https://labmaus.net",
          Referer: "https://labmaus.net/",
        },
      },
    );
    expect(res.ok).toBe(true);
    const body = await res.json();
    const parsed = LabmausRawTournamentSchema.safeParse(body);
    if (!parsed.success) {
      throw new Error(`schema drift: ${parsed.error.message}`);
    }
  });
});
