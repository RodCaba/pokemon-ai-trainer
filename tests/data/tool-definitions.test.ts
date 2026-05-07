import { describe, expect, it } from "vitest";
import { ROSTER_TOOL_DEFINITIONS, rosterGetTool, rosterSearchTool } from "../../src/db/tool-definitions";

const NAME_PATTERN = /^(roster|items|abilities|moves|tournaments|sets|pokepaste|pikalytics)_(list|get|search|has|sets|teams_with|usage|fetch_paste|fetch_species|teammates)$/;

describe("repo tool definitions (Anthropic SDK)", () => {
  it("1. each accessor exports a tool definition with name matching <repo>_<verb>", () => {
    expect(ROSTER_TOOL_DEFINITIONS.length).toBeGreaterThan(0);
    for (const t of ROSTER_TOOL_DEFINITIONS) {
      expect(t.name).toMatch(NAME_PATTERN);
    }
    const names = ROSTER_TOOL_DEFINITIONS.map((t) => t.name);
    // Spot-check the canonical accessors are present.
    for (const expected of [
      "roster_list", "roster_get", "roster_search", "roster_has", "roster_sets",
      "items_list", "items_get", "items_has",
      "abilities_list", "abilities_get", "abilities_has",
      "moves_list", "moves_get", "moves_has",
      "pokepaste_fetch_paste",
      "sets_list", "sets_get", "sets_usage",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("2. each description is non-empty and ≥ 60 chars", () => {
    for (const t of ROSTER_TOOL_DEFINITIONS) {
      expect(t.description).toBeDefined();
      expect((t.description ?? "").length).toBeGreaterThanOrEqual(60);
    }
  });

  it("3. each input_schema is JSON-serializable", () => {
    for (const t of ROSTER_TOOL_DEFINITIONS) {
      // JSON.stringify throws on circular refs / undefined-only objects.
      const json = JSON.stringify(t.input_schema);
      expect(typeof json).toBe("string");
      // Round-trip parse-equal — pure JSON, no class instances or symbols.
      expect(JSON.parse(json)).toEqual(t.input_schema);
    }
  });

  it("4. each input_schema requires `format`", () => {
    for (const t of ROSTER_TOOL_DEFINITIONS) {
      const schema = t.input_schema as { properties?: Record<string, unknown>; required?: string[] };
      expect(schema.properties?.format).toBeDefined();
      expect(schema.required ?? []).toContain("format");
    }
  });

  it("5. sibling tools' descriptions disambiguate each other (roster_get exact, roster_search fuzzy)", () => {
    expect(rosterGetTool.description ?? "").toMatch(/exact|canonical/i);
    expect(rosterSearchTool.description ?? "").toMatch(/fuzzy|did-you-mean/i);
    // Cross-reference: each should mention the other so the model knows when to switch.
    expect(rosterGetTool.description ?? "").toMatch(/roster_search/);
    expect(rosterSearchTool.description ?? "").toMatch(/roster_get/);
  });

  it("6. roster_get's input_schema rejects extra keys (matches .strict())", () => {
    const schema = rosterGetTool.input_schema as { additionalProperties?: false | unknown };
    // zod-to-json-schema with .strict() produces additionalProperties: false.
    expect(schema.additionalProperties).toBe(false);
  });
});
