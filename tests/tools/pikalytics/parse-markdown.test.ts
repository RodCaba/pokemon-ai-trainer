/**
 * PIKA-T7–PIKA-T12 — pikalytics markdown parser.
 * Stage 4: every test fails because `parsePikalyticsMarkdown` throws "not
 * implemented (Stage 5)".
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePikalyticsMarkdown } from "../../../src/tools/pikalytics/parse-markdown";
import { PikalyticsParseError } from "../../../src/schemas/errors";

const FIX = join(process.cwd(), "fixtures", "pikalytics");

function load(name: string): string {
  return readFileSync(join(FIX, name), "utf8");
}

describe("parsePikalyticsMarkdown (PIKA-T7–PIKA-T12)", () => {
  it("PIKA-T7. extracts as_of from the Data Date row of the Garchomp fixture", () => {
    const out = parsePikalyticsMarkdown(load("2026-05-07__garchomp.md"));
    // Live endpoint emits YYYY-MM; parser maps to ISO date YYYY-MM-01.
    expect(out.as_of).toBe("2026-04-01");
  });

  it("PIKA-T8. throws PikalyticsParseError on missing as_of", () => {
    const stripped = load("2026-05-07__garchomp.md").replace(
      /\|\s*\*\*Data Date\*\*\s*\|[^\n]*\n/,
      "",
    );
    expect(() => parsePikalyticsMarkdown(stripped)).toThrow(PikalyticsParseError);
  });

  it("PIKA-T9. usage_percent is null when no overall usage section is present (live shape)", () => {
    // Live AI-markdown endpoint doesn't expose an overall species usage %;
    // parser returns null. Documented in fixtures/pikalytics/README.md.
    const out = parsePikalyticsMarkdown(load("2026-05-07__garchomp.md"));
    expect(out.usage_percent).toBeNull();
  });

  it("PIKA-T10. returns empty arrays + warnings on missing optional sections", () => {
    const out = parsePikalyticsMarkdown(load("2026-05-07__synthetic-empty-sections.md"));
    expect(out.teammates).toEqual([]);
    expect(out.items).toEqual([]);
    expect(out.abilities).toEqual([]);
    expect(out.moves).toEqual([]);
    expect(out.raw_warnings.length).toBeGreaterThan(0);
  });

  it("PIKA-T11. extracts hyphenated species names verbatim from teammates", () => {
    const out = parsePikalyticsMarkdown(load("2026-05-07__garchomp.md"));
    const names = out.teammates.map((t) => t.display_name);
    expect(names).toContain("Charizard-Mega-Y");
    expect(names).toContain("Floette-Mega");
  });

  it("PIKA-T12. handles 1- to 3-decimal percentages", () => {
    const out = parsePikalyticsMarkdown(load("2026-05-07__garchomp.md"));
    const earthquake = out.moves.find((m) => m.name === "Earthquake");
    expect(earthquake?.percent).toBeCloseTo(91.473, 3);
    const sneasler = out.teammates.find((t) => t.display_name === "Sneasler");
    expect(sneasler?.percent).toBeCloseTo(46.767, 3);
  });

  it("PIKA-T12b. extractSection stops at the next `##` (regression: non-last section)", () => {
    // Stage 6 review item 8: the previous regex used `\Z` (unsupported in JS)
    // and was masked by every fixture having `## Common Moves` last. If a
    // future fixture trails `## Random Notes` after `## Common Moves`, the
    // bullets in the trailing section must NOT be sucked into `moves`.
    const synth = [
      "| **Data Date** | 2026-04 |",
      "",
      "## Common Moves",
      "- **Earthquake**: 91.473%",
      "- **Protect**: 71.0%",
      "",
      "## Random Notes",
      "- **NotAMove**: 99.9%",
      "- **AnotherNote**: 50.0%",
      "",
    ].join("\n");
    const out = parsePikalyticsMarkdown(synth);
    const moveNames = out.moves.map((m) => m.name);
    expect(moveNames).toContain("Earthquake");
    expect(moveNames).toContain("Protect");
    expect(moveNames).not.toContain("NotAMove");
    expect(moveNames).not.toContain("AnotherNote");
  });
});
