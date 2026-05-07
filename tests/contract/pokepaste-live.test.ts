/**
 * Test T42 — contract test: live pokepaste `/raw` for a known stable
 * paste id parses without throwing. Gated by `RUN_CONTRACT_TESTS=1`
 * per labmaus precedent.
 */

import { describe, expect, it } from "vitest";
import { Teams } from "@pkmn/sets";

const GATED = process.env.RUN_CONTRACT_TESTS === "1";

describe.skipIf(!GATED)("pokepaste live contract", () => {
  it("T42. /raw returns a parseable Showdown export for a stable paste id", async () => {
    const res = await fetch("https://pokepast.es/7205bf28f85d1e79/raw");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body.length).toBeGreaterThan(0);
    const team = Teams.importTeam(body);
    expect(team).not.toBeUndefined();
    expect((team?.team.length ?? 0) >= 1).toBe(true);
  });
});
