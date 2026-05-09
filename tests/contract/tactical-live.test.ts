/**
 * TAC-T47 — gated end-to-end against the prod DB on a real labmaus team.
 * Skipped unless `TACTICAL_LIVE=1` is set in the environment. Stage-4 red.
 */

import { describe, expect, it } from "vitest";
import { buildOverview } from "../../src/data/tactical/overview";
import { open } from "../../src/db/open";
import { join } from "node:path";

const RUN = process.env["TACTICAL_LIVE"] === "1";
const d = RUN ? describe : describe.skip;

d("tactical contract — live (TAC-T47)", () => {
  it("end-to-end on a real labmaus team duplicated into user_teams", () => {
    const db = open(join(process.cwd(), "db.sqlite"));
    const overview = buildOverview(process.env["TACTICAL_LIVE_TEAM_ID"] ?? "", {
      db,
      calc: { calc: () => ({}) },
      speed: {},
      synergy: { db },
    });
    expect(overview.scenarios.length).toBeGreaterThanOrEqual(5);
  });
});
