/**
 * USR-T46 — agent-callable user-teams tool surface (Stage-2 Q3 binding).
 *
 * `create`, `setStatus`, `validateTeam` ship as Anthropic-SDK Tool
 * definitions in this slice. We assert names + input schemas + that
 * the handlers are invokable (Stage 5) end-to-end against a fixture DB.
 *
 * Stage-4 red.
 */

import { describe, expect, it, afterEach } from "vitest";
import {
  USER_TEAMS_TOOL_DEFINITIONS,
  userTeamsToolHandlers,
  userTeamsCreateTool,
  userTeamsSetStatusTool,
  userTeamsValidateTool,
} from "../../src/agents/user-teams-tools";
import { open, type Db } from "../../src/db/open";
import type { ValidateDeps } from "../../src/data/team-validate";

let opened: Db | null = null;
afterEach(() => {
  if (opened) { try { opened.$client.close(); } catch { /* noop */ } opened = null; }
});

function deps(): ValidateDeps {
  const db = {} as ValidateDeps["db"];
  return {
    db,
    speciesRepo: { has: () => true, get: () => ({ id: "x" }) },
    itemsRepo: { has: () => true },
    abilitiesRepo: { has: () => true },
    movesRepo: { has: () => true },
    rosterRepo: { isLegalForFormat: () => ({ in_membership: true, is_legal: true }) },
    speciesAbilities: { legalFor: () => [] },
    speciesMovepool: { legalFor: () => [] },
  };
}

describe("user-teams agent tool surface (USR-T46)", () => {
  it("USR-T46. create / setStatus / validateTeam ship as Anthropic Tool definitions and the in-process handlers are invokable", () => {
    // Tool catalog contains exactly the three tools (per Stage-2 Q3).
    const names = USER_TEAMS_TOOL_DEFINITIONS.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "user_teams_create",
        "user_teams_set_status",
        "user_teams_validate",
      ].sort(),
    );

    // Each tool has a JSON-Schema input_schema.
    for (const t of [userTeamsCreateTool, userTeamsSetStatusTool, userTeamsValidateTool]) {
      expect(t.input_schema).toBeDefined();
      expect(typeof t.input_schema).toBe("object");
      // Required fields include `format` (the forward-compat seam).
      expect((t.input_schema as { required?: string[] }).required).toContain("format");
    }

    // Invokable end-to-end against a fixture DB.
    const db = open(":memory:"); opened = db;
    const created = userTeamsToolHandlers.create(db, {
      format: "RegM-A",
      origin: "builder",
      name: "agent-test",
    });
    expect(created.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(created.status).toBe("draft");

    const validateResult = userTeamsToolHandlers.validate(
      db,
      { format: "RegM-A", id: created.id },
      deps(),
    );
    expect(validateResult.errors).toBeDefined();
    expect(validateResult.warnings).toBeDefined();

    const saved = userTeamsToolHandlers.setStatus(
      db,
      { format: "RegM-A", id: created.id, status: "saved" },
      deps(),
    );
    expect(saved.status).toBe("saved");
  });
});
