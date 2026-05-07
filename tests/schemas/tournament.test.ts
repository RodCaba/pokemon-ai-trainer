/**
 * Schema tests T1–T6 for the labmaus tournament domain.
 *
 * Per CLAUDE.md §3 the pure-data exemption applies: schemas are written alongside
 * these tests rather than red-first per zod field. Each test still asserts a
 * single behavior so the suite locks in correctness.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LabmausListArgsSchema,
  LabmausRawTournamentSchema,
  TournamentResultSchema,
  TournamentSummarySchema,
} from "../../src/schemas/tournament";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "..", "..", "fixtures", "labmaus");

function readJson<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

describe("schemas/tournament", () => {
  it("T1. TournamentSummarySchema parses fixture listing", () => {
    const listing = readJson<unknown[]>(
      join(FIX, "2026-05-04__completed_tournaments_regm-a_30d.json"),
    );
    expect(Array.isArray(listing)).toBe(true);
    expect(listing.length).toBeGreaterThan(0);
    for (const row of listing) {
      const parsed = TournamentSummarySchema.safeParse(row);
      if (!parsed.success) {
        throw new Error(
          `summary failed for row=${JSON.stringify(row).slice(0, 200)}: ${parsed.error.message}`,
        );
      }
    }
  });

  it("T2. LabmausRawTournamentSchema strips tera_types", () => {
    const raw = readJson<{ tera_types?: unknown }>(
      join(FIX, "2026-05-04__tournament_56757.json"),
    );
    // Sanity: input has tera_types
    expect(raw.tera_types).toBeDefined();
    const parsed = LabmausRawTournamentSchema.parse(raw);
    // Output must NOT have any top-level tera-named key
    for (const k of Object.keys(parsed)) {
      expect(/tera/i.test(k)).toBe(false);
    }
  });

  it("T3. LabmausRawTournamentSchema preserves placement: null", () => {
    // 56588 has 51/77 placement-null rows
    const raw = readJson<unknown>(join(FIX, "2026-05-04__tournament_56588.json"));
    const parsed = LabmausRawTournamentSchema.parse(raw);
    const nullPlacements = parsed.teams.filter((t) => t.placement === null).length;
    expect(nullPlacements).toBeGreaterThan(0);
  });

  it("T4. LabmausRawTournamentSchema preserves num_phase_2: null", () => {
    const raw = readJson<unknown>(join(FIX, "2026-05-04__tournament_56757.json"));
    const parsed = LabmausRawTournamentSchema.parse(raw);
    expect(parsed.overview.num_phase_2).toBeNull();
  });

  it("T5. TournamentResultSchema rejects unknown fields (.strict)", () => {
    const baseValid = {
      schema_version: 1 as const,
      id: "labmaus:56757",
      external_id: 56757,
      tournament_code: "abc123",
      name: "Sketch",
      organizer: "Sketch Academy",
      format: "RegM-A" as const,
      division: "Masters" as const,
      status: "unofficial" as const,
      date: "2026-05-04",
      num_players: 42,
      num_phase_2: null,
      source: {
        schema_version: 1 as const,
        site: "labmaus" as const,
        site_source: "limitless",
        source_url: "https://labmaus.net/tournaments/56757",
        fetched_at: "2026-05-04T19:32:11Z",
      },
    };
    expect(TournamentResultSchema.safeParse(baseValid).success).toBe(true);
    const withExtra = { ...baseValid, surprise: 1 };
    expect(TournamentResultSchema.safeParse(withExtra).success).toBe(false);
  });

  it("T6. LabmausListArgsSchema rejects from > to via superRefine", () => {
    const ok = LabmausListArgsSchema.safeParse({
      regulation: "RegM-A",
      date_range: { from: "2026-04-06", to: "2026-05-04" },
    });
    expect(ok.success).toBe(true);
    const bad = LabmausListArgsSchema.safeParse({
      regulation: "RegM-A",
      date_range: { from: "2026-05-04", to: "2026-04-06" },
    });
    expect(bad.success).toBe(false);
  });
});
