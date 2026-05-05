/**
 * Test T28 for the four tournament tool definitions.
 */

import { describe, expect, it } from "vitest";
import {
  tournamentsListTool,
  tournamentsGetTool,
  tournamentsTeamsWithTool,
  tournamentsUsageTool,
} from "../../../src/db/tool-definitions";

describe("tool-definitions (tournaments)", () => {
  it("T28. four labmaus tools have stable JSON schemas with no $ref", () => {
    const tools = [
      tournamentsListTool,
      tournamentsGetTool,
      tournamentsTeamsWithTool,
      tournamentsUsageTool,
    ];
    for (const t of tools) {
      expect(t.name.startsWith("tournaments_")).toBe(true);
      expect(typeof t.description).toBe("string");
      const schema = t.input_schema;
      const json = JSON.stringify(schema);
      expect(json).not.toContain("$ref");
    }
    expect(tools.map((t) => t.name)).toEqual([
      "tournaments_list",
      "tournaments_get",
      "tournaments_teams_with",
      "tournaments_usage",
    ]);
  });
});
