/**
 * PIKA-T14, PIKA-T15 — Tera-strip discipline.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { transformPikalyticsMarkdown } from "../../../src/tools/pikalytics/transform";
import * as roster from "../../../src/db/roster";
import { seedLabmausDb, closeIfOpen } from "../../db/labmaus-fixtures";
import { PikalyticsTeraLeakError } from "../../../src/schemas/errors";

const FIX = join(process.cwd(), "fixtures", "pikalytics");

describe("pikalytics transform — Tera strip (PIKA-T14, PIKA-T15)", () => {
  it("PIKA-T14. throws PikalyticsTeraLeakError if a tera_* shaped key surfaces in the parsed struct", () => {
    // Stage 5 implementation must expose a hook that lets us inject a parsed
    // RawSnapshot with an injected `tera_*` key. For Stage 4 we encode the
    // assertion via a fixture variant: the synthetic-tera-leak fixture has
    // explicit `Tera Type:` lines + a `## Common Tera Types` section. If the
    // parser ever forwards them into the parsed struct (regression), the
    // transform must throw. Today (parser is a stub) the call throws "not
    // implemented" — fails for the wrong reason at first; will tighten in
    // Stage 5 once the parser is real and the property scan is added.
    const db = seedLabmausDb();
    try {
      const raw = readFileSync(join(FIX, "2026-05-07__synthetic-tera-leak.md"), "utf8");
      // We assert on the error class. Until the parser is real (Stage 5), the
      // stub throws Error not PikalyticsTeraLeakError — this is the failing
      // assertion that drives the Stage 5 implementation.
      let thrown: unknown;
      try {
        transformPikalyticsMarkdown(
          {
            species_roster_id: "garchomp",
            raw_markdown: raw,
            source_url: "https://example.invalid/x",
            ai_url: "https://example.invalid/x",
            fetched_at: "2026-05-07T12:00:00Z",
          },
          { db, rosterRepo: { has: roster.has, get: roster.get } },
        );
      } catch (e) {
        thrown = e;
      }
      // For the deliberately-malformed tera-leak fixture, the transform must
      // either succeed cleanly (parser ignored the lines) or fail with
      // PikalyticsTeraLeakError. It must NEVER succeed-with-tera-data.
      if (thrown !== undefined) {
        expect(thrown).toBeInstanceOf(PikalyticsTeraLeakError);
      } else {
        // Will be exercised by PIKA-T15.
      }
    } finally {
      closeIfOpen(db);
    }
  });

  it("PIKA-T15. transform on synthetic-tera-leak fixture succeeds with no tera-shaped data surfaced", () => {
    const db = seedLabmausDb();
    try {
      const raw = readFileSync(join(FIX, "2026-05-07__synthetic-tera-leak.md"), "utf8");
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
      // Property check: no key in the snapshot or any nested object matches /tera/i.
      const json = JSON.stringify(out.snapshot);
      // Only key names matter — test for a /"tera[^"]*":/ shape (key followed by colon).
      expect(json).not.toMatch(/"[^"]*tera[^"]*"\s*:/i);
    } finally {
      closeIfOpen(db);
    }
  });
});
