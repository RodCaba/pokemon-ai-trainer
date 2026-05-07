/**
 * PIKA-T16, PIKA-T17, PIKA-T18, PIKA-T19 — teammate name → roster id
 * resolution policy (flow §6 Q7 / plan §6.3).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { transformPikalyticsMarkdown } from "../../../src/tools/pikalytics/transform";
import * as roster from "../../../src/db/roster";
import { seedLabmausDb, closeIfOpen } from "../../db/labmaus-fixtures";

const FIX = join(process.cwd(), "fixtures", "pikalytics");

describe("pikalytics transform — roster resolution (PIKA-T16–PIKA-T19)", () => {
  it("PIKA-T16. resolves every teammate name in a real fixture; no unknowns reported", () => {
    const db = seedLabmausDb();
    try {
      const raw = readFileSync(join(FIX, "2026-05-07__garchomp.md"), "utf8");
      const out = transformPikalyticsMarkdown(
        {
          species_roster_id: "garchomp",
          raw_markdown: raw,
          source_url: "https://example.invalid/x",
          ai_url: "https://example.invalid/x",
          fetched_at: "2026-05-07T12:00:00Z",
        },
        { db, rosterRepo: { has: roster.has, get: roster.get } },
      );
      // Per flow §6 Q7: unresolved teammates are dropped + accumulated; a
      // fully-known fixture should produce zero unknowns. (The seed roster
      // covers every teammate observed in the committed Garchomp fixture.)
      expect(out.unknown_teammate_names).toEqual([]);
    } finally {
      closeIfOpen(db);
    }
  });

  it("PIKA-T17. drops an injected unresolvable teammate name + accumulates it", () => {
    const db = seedLabmausDb();
    try {
      const raw = readFileSync(join(FIX, "2026-05-07__garchomp.md"), "utf8");
      // Inject a fake teammate at the top of the section so the parser sees it.
      const polluted = raw.replace(
        /## Common Teammates\n/,
        "## Common Teammates\n- **Definitely-Not-Pokemon**: 99.999%\n",
      );
      const out = transformPikalyticsMarkdown(
        {
          species_roster_id: "garchomp",
          raw_markdown: polluted,
          source_url: "https://example.invalid/x",
          ai_url: "https://example.invalid/x",
          fetched_at: "2026-05-07T12:00:00Z",
        },
        { db, rosterRepo: { has: roster.has, get: roster.get } },
      );
      expect(out.unknown_teammate_names).toContain("Definitely-Not-Pokemon");
      const persistedNames = out.snapshot.teammates.map((t) => t.roster_id);
      expect(persistedNames).not.toContain("definitelynotpokemon");
    } finally {
      closeIfOpen(db);
    }
  });

  it("PIKA-T18. handles the Charizard-Mega-Y display name correctly", () => {
    const db = seedLabmausDb();
    try {
      // Ensure the seed has charizardmegay; if it doesn't, we'd see it in
      // unknown_teammate_names. The labmaus seed currently does NOT include
      // charizardmegay, so this test asserts the graceful drop+report path
      // for the hyphenated display-name case (PIKA-T17 already covers the
      // generic drop; this one pins the specific Mega case the flow doc
      // calls out as the canonical example).
      const raw = readFileSync(join(FIX, "2026-05-07__garchomp.md"), "utf8");
      const out = transformPikalyticsMarkdown(
        {
          species_roster_id: "garchomp",
          raw_markdown: raw,
          source_url: "https://example.invalid/x",
          ai_url: "https://example.invalid/x",
          fetched_at: "2026-05-07T12:00:00Z",
        },
        { db, rosterRepo: { has: roster.has, get: roster.get } },
      );
      // Either the seed contains the species and resolution succeeds (entry
      // present in teammates with a roster id), OR the seed lacks it and the
      // display name lands in unknown_teammate_names. EITHER outcome is
      // acceptable; what we forbid is the hyphenated display-name leaking
      // into snapshot.teammates[*].roster_id verbatim.
      const ids = out.snapshot.teammates.map((t) => t.roster_id);
      expect(ids).not.toContain("Charizard-Mega-Y");
      const resolved = ids.includes("charizardmegay");
      const unresolved = out.unknown_teammate_names.includes("Charizard-Mega-Y");
      expect(resolved || unresolved).toBe(true);
    } finally {
      closeIfOpen(db);
    }
  });

  it("PIKA-T19. persists exactly the source.source_url and source.ai_url provided by the client", () => {
    const db = seedLabmausDb();
    try {
      const raw = readFileSync(join(FIX, "2026-05-07__garchomp.md"), "utf8");
      const HUMAN = "https://www.pikalytics.com/pokedex/gen9championsvgc2026regma/Garchomp";
      const AI = "https://www.pikalytics.com/ai/pokedex/gen9championsvgc2026regma/Garchomp";
      const out = transformPikalyticsMarkdown(
        {
          species_roster_id: "garchomp",
          raw_markdown: raw,
          source_url: HUMAN,
          ai_url: AI,
          fetched_at: "2026-05-07T12:00:00Z",
        },
        { db, rosterRepo: { has: roster.has, get: roster.get } },
      );
      expect(out.snapshot.source.source_url).toBe(HUMAN);
      expect(out.snapshot.source.ai_url).toBe(AI);
    } finally {
      closeIfOpen(db);
    }
  });
});
