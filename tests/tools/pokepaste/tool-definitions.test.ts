/**
 * Test T28 — pokepaste + sets tools have stable JSON schemas with no $ref.
 */

import { describe, expect, it } from "vitest";
import { fetchPasteToolDefinition } from "../../../src/tools/pokepaste/fetch-paste";

describe("pokepaste tool definitions (T28)", () => {
  it("T28. fetchPasteToolDefinition has a stable JSON schema with no $ref", () => {
    expect(fetchPasteToolDefinition.name).toBe("pokepaste_fetch_paste");
    expect(typeof fetchPasteToolDefinition.description).toBe("string");
    const json = JSON.stringify(fetchPasteToolDefinition.input_schema);
    expect(json).not.toContain("$ref");
  });
});
