/**
 * PIKA-T31, PIKA-T32 — agent tool registration.
 * Preempts the pokepaste-sets Stage 6 BLOCKER per flow §6 Q3 / plan §17 Q3.
 */

import { describe, expect, it } from "vitest";
import { ROSTER_TOOL_DEFINITIONS } from "../../../src/db/tool-definitions";

describe("pikalytics tool registration (PIKA-T31, PIKA-T32)", () => {
  it("PIKA-T31. all three pikalytics tools are registered in ROSTER_TOOL_DEFINITIONS", () => {
    const names = ROSTER_TOOL_DEFINITIONS.map((t) => t.name);
    expect(names).toContain("pikalytics_fetch_species");
    expect(names).toContain("pikalytics_teammates");
    expect(names).toContain("pikalytics_usage");
  });

  it("PIKA-T32. pikalytics tools have stable JSON schemas (no $ref)", () => {
    const tools = ROSTER_TOOL_DEFINITIONS.filter((t) => t.name.startsWith("pikalytics_"));
    expect(tools.length).toBe(3);
    for (const t of tools) {
      const json = JSON.stringify(t.input_schema);
      expect(json).not.toContain("$ref");
    }
  });
});
