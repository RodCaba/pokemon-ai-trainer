/**
 * VGC-T51, VGC-T52 — knowledge_search tool registration.
 * Preempts the pokepaste-sets Stage 6 BLOCKER per flow §6 Q9.
 */

import { describe, expect, it } from "vitest";
import { ROSTER_TOOL_DEFINITIONS } from "../../src/db/tool-definitions";

describe("knowledge_search tool registration (VGC-T51, VGC-T52)", () => {
  it("VGC-T51. knowledge_search is registered in ROSTER_TOOL_DEFINITIONS", () => {
    const names = ROSTER_TOOL_DEFINITIONS.map((t) => t.name);
    expect(names).toContain("knowledge_search");
  });

  it("VGC-T52. knowledge_search tool has stable JSON schema (no $ref)", () => {
    const t = ROSTER_TOOL_DEFINITIONS.find((x) => x.name === "knowledge_search");
    expect(t).toBeDefined();
    const json = JSON.stringify(t!.input_schema);
    expect(json).not.toContain("$ref");
  });
});
