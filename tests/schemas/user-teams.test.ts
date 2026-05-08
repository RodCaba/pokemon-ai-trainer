/**
 * USR-T1..T6 — zod schemas for the user-teams slice.
 *
 * Stage-4 red. PURE-DATA EXEMPTION (CLAUDE.md §3 / plan §17 Q9): batched
 * in a single commit; disclosed in commit message. Vacuous-green flag on
 * USR-T2 — the Tera assertion holds via `.strict()` and the absence of
 * tera fields in the schema body.
 */

import { describe, expect, it } from "vitest";
import {
  UserTeamSchema,
  UserSetSchema,
  UserTeamRowSchema,
  ValidationErrorSchema,
  ValidationResultSchema,
  UserTeamRevisionSchema,
} from "../../src/schemas/user-teams";

function emptyUserSet(slot: number): unknown {
  return {
    slot,
    species_id: null,
    nickname: null,
    item_id: null,
    ability_id: null,
    nature: null,
    hp_sps: 0,
    atk_sps: 0,
    def_sps: 0,
    spa_sps: 0,
    spd_sps: 0,
    spe_sps: 0,
    move_1_id: null,
    move_2_id: null,
    move_3_id: null,
    move_4_id: null,
    notes: null,
  };
}

function fullTeam(): unknown {
  return {
    schema_version: 1,
    id: "01HZX2J5K8M7P1Q3R4S5T6V7W9",
    name: "Untitled team",
    description: null,
    win_condition: null,
    status: "draft",
    origin: "builder",
    origin_payload: null,
    source_tournament_team_id: null,
    validation_errors: [],
    validation_warnings: [],
    sets: [0, 1, 2, 3, 4, 5].map(emptyUserSet),
    created_at: "2026-05-08T00:00:00Z",
    updated_at: "2026-05-08T00:00:00Z",
  };
}

describe("user-teams schemas (USR-T1..T6)", () => {
  it("USR-T1. UserTeamSchema round-trips a minimal valid team via safeParse", () => {
    const r = UserTeamSchema.safeParse(fullTeam());
    expect(r.success).toBe(true);
    if (r.success) {
      // Confirm fields preserve their values.
      expect(r.data.id).toBe("01HZX2J5K8M7P1Q3R4S5T6V7W9");
      expect(r.data.sets).toHaveLength(6);
      expect(r.data.sets[0]?.slot).toBe(0);
    }
  });

  it("USR-T2. UserTeamSchema and UserSetSchema reject any tera_* leakage (defense-in-depth)", () => {
    // Inject tera_type onto the team — .strict() must reject.
    const teamWithTera = { ...(fullTeam() as object), tera_type: "Fire" };
    const r1 = UserTeamSchema.safeParse(teamWithTera);
    expect(r1.success).toBe(false);

    // Inject tera_type onto a set as well.
    const setWithTera = { ...(emptyUserSet(0) as object), teraType: "Water" };
    const r2 = UserSetSchema.safeParse(setWithTera);
    expect(r2.success).toBe(false);

    // The schemas must NOT contain a tera_* field by name. We grep the
    // shape's keys (zod exposes `_def.shape` for ZodObject).
    const keys = Object.keys(
      (UserTeamSchema as unknown as { _def: { shape: () => Record<string, unknown> } })
        ._def.shape(),
    );
    for (const k of keys) {
      expect(k.toLowerCase()).not.toMatch(/tera/);
    }
    const setKeys = Object.keys(
      (UserSetSchema as unknown as { _def: { shape: () => Record<string, unknown> } })
        ._def.shape(),
    );
    for (const k of setKeys) {
      expect(k.toLowerCase()).not.toMatch(/tera/);
    }
  });

  it("USR-T3. UserSetSchema enforces per-stat 0..32 (cap is hard at this layer)", () => {
    const ok = UserSetSchema.safeParse({ ...(emptyUserSet(0) as object), hp_sps: 32 });
    expect(ok.success).toBe(true);
    const tooHigh = UserSetSchema.safeParse({ ...(emptyUserSet(0) as object), hp_sps: 33 });
    expect(tooHigh.success).toBe(false);
    const negative = UserSetSchema.safeParse({ ...(emptyUserSet(0) as object), atk_sps: -1 });
    expect(negative.success).toBe(false);
  });

  it("USR-T4. ValidationResultSchema separates errors[] and warnings[] as distinct arrays", () => {
    const r = ValidationResultSchema.safeParse({
      errors: [{ code: "item_unknown", message: "unknown item" }],
      warnings: [{ code: "species_not_legal_warning", message: "soft" }],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.errors).toHaveLength(1);
      expect(r.data.warnings).toHaveLength(1);
      expect(r.data.errors[0]?.code).toBe("item_unknown");
      expect(r.data.warnings[0]?.code).toBe("species_not_legal_warning");
    }

    // Cross-pollution is rejected: a warning code on the errors array fails.
    const bad = ValidationResultSchema.safeParse({
      errors: [{ code: "species_not_legal_warning", message: "..." }],
      warnings: [],
    });
    expect(bad.success).toBe(false);

    // Validate the standalone error schema as well.
    const err = ValidationErrorSchema.safeParse({
      code: "tera_present",
      message: "Reg M-A has no Tera",
    });
    expect(err.success).toBe(true);
  });

  it("USR-T5. UserTeamRowSchema mirrors the DB row shape (JSON columns are strings, not arrays)", () => {
    const row = {
      id: "01HZX2J5K8M7P1Q3R4S5T6V7W9",
      name: "team-1",
      description: null,
      win_condition: null,
      status: "draft" as const,
      origin: "paste" as const,
      origin_payload: "raw text",
      source_tournament_team_id: null,
      validation_errors: "[]", // stored as JSON string
      validation_warnings: "[]",
      schema_version: 1 as const,
      created_at: "2026-05-08T00:00:00Z",
      updated_at: "2026-05-08T00:00:00Z",
    };
    const r = UserTeamRowSchema.safeParse(row);
    expect(r.success).toBe(true);
    // Distinct from the entity schema: an array (instead of a string) on
    // the JSON columns must FAIL row validation.
    const broken = { ...row, validation_errors: [] as unknown };
    const bad = UserTeamRowSchema.safeParse(broken);
    expect(bad.success).toBe(false);
  });

  it("USR-T6. UserTeamRevisionSchema validates the nested UserTeam snapshot", () => {
    const rev = {
      user_team_id: "01HZX2J5K8M7P1Q3R4S5T6V7W9",
      revision_number: 1,
      created_at: "2026-05-08T00:00:00Z",
      label: null,
      snapshot: fullTeam(),
    };
    const r = UserTeamRevisionSchema.safeParse(rev);
    expect(r.success).toBe(true);

    // A revision with a corrupt snapshot (missing schema_version) fails.
    const bad = UserTeamRevisionSchema.safeParse({
      ...rev,
      snapshot: { ...(fullTeam() as object), schema_version: undefined },
    });
    expect(bad.success).toBe(false);

    // revision_number must be 1..5.
    const six = UserTeamRevisionSchema.safeParse({ ...rev, revision_number: 6 });
    expect(six.success).toBe(false);
  });
});
