/**
 * USR-T31..T36 — `userTeams` repo CRUD. Stage-4 red.
 *
 * USR-T31: create + get round-trip.
 * USR-T32: list filters by status and origin.
 * USR-T33: setStatus tolerates warnings (saves) and rejects errors (throws
 *          UserTeamValidationError with .result.errors[0].code).
 * USR-T34: upsertSet auto-persists with no revision.
 * USR-T35: deleteTeam cascades sets and revisions.
 * USR-T36: get returns null on miss (does not throw).
 */

import { describe, expect, it, afterEach } from "vitest";
import * as userTeams from "../../src/db/user-teams";
import { open, type Db } from "../../src/db/open";
import { UserTeamValidationError } from "../../src/schemas/errors";
import type { ValidateDeps } from "../../src/data/team-validate";

let opened: Db | null = null;
afterEach(() => {
  if (opened) { try { opened.$client.close(); } catch { /* noop */ } opened = null; }
});

function fakeValidateDeps(opts: {
  errors?: Array<{ code: string; message: string; slot?: number | null }>;
  warnings?: Array<{ code: string; message: string; slot?: number | null }>;
} = {}): ValidateDeps {
  // Stage 5 will inject real ref-table repos; the tests below override
  // the validator path via the repo's `setStatus(deps)` argument so we
  // can assert behavior independent of the validator implementation.
  void opts;
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

describe("userTeams repo (USR-T31..T36)", () => {
  it("USR-T31. create + get round-trip with auto-name", () => {
    const db = open(":memory:"); opened = db;
    const t = userTeams.create(db, { origin: "builder" });
    expect(t.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(t.status).toBe("draft");
    expect(t.sets).toHaveLength(6);
    const got = userTeams.get(db, t.id);
    expect(got).not.toBeNull();
    expect(got?.id).toBe(t.id);
  });

  it("USR-T32. list filters by status and origin; orders updated_at DESC", () => {
    const db = open(":memory:"); opened = db;
    userTeams.create(db, { origin: "builder", name: "B-1" });
    userTeams.create(db, { origin: "paste", name: "P-1" });
    userTeams.create(db, { origin: "paste", name: "P-2" });

    const all = userTeams.list(db, {});
    expect(all.length).toBe(3);

    const onlyPaste = userTeams.list(db, { origin: "paste" });
    expect(onlyPaste.length).toBe(2);
    expect(onlyPaste.every((t) => t.origin === "paste")).toBe(true);

    const onlyDraft = userTeams.list(db, { status: "draft" });
    expect(onlyDraft.length).toBe(3);
  });

  it("USR-T33. setStatus('saved') tolerates warnings; rejects on errors with UserTeamValidationError", () => {
    const db = open(":memory:"); opened = db;
    const t = userTeams.create(db, { origin: "builder", name: "T-saved" });
    // Warnings-only: must succeed and return a saved team. Stage 5 will
    // wire the validator via deps; for now we pass the fake deps and
    // expect the repo's behavior to honor the contract (no errors → save).
    const saved = userTeams.setStatus(db, t.id, "saved", fakeValidateDeps({ warnings: [{ code: "species_not_legal_warning", message: "soft" }] }));
    expect(saved.status).toBe("saved");

    // With errors: throws.
    let thrown: unknown;
    try {
      userTeams.setStatus(
        db,
        t.id,
        "saved",
        fakeValidateDeps({ errors: [{ code: "item_unknown", message: "no such item" }] }),
      );
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(UserTeamValidationError);
    if (thrown instanceof UserTeamValidationError) {
      const codes = (thrown.result.errors as Array<{ code: string }>).map((e) => e.code);
      expect(codes).toContain("item_unknown");
    }
  });

  it("USR-T34. upsertSet auto-persists with no revision created (Q4)", () => {
    const db = open(":memory:"); opened = db;
    const t = userTeams.create(db, { origin: "builder", name: "T-upsert" });
    for (let i = 0; i < 12; i++) {
      userTeams.upsertSet(db, t.id, i % 6, { hp_sps: i % 30 });
    }
    const revs = userTeams.listRevisions(db, t.id);
    expect(revs).toHaveLength(0);
  });

  it("USR-T35. deleteTeam cascades user_team_sets and user_team_revisions", () => {
    const db = open(":memory:"); opened = db;
    const t = userTeams.create(db, { origin: "builder", name: "T-del" });
    userTeams.checkpoint(db, t.id, "before delete");

    const setsBefore = db.$client
      .prepare("SELECT COUNT(*) AS c FROM user_team_sets WHERE user_team_id = ?")
      .get(t.id) as { c: number };
    expect(setsBefore.c).toBe(6);
    const revsBefore = db.$client
      .prepare("SELECT COUNT(*) AS c FROM user_team_revisions WHERE user_team_id = ?")
      .get(t.id) as { c: number };
    expect(revsBefore.c).toBe(1);

    userTeams.deleteTeam(db, t.id);

    const setsAfter = db.$client
      .prepare("SELECT COUNT(*) AS c FROM user_team_sets WHERE user_team_id = ?")
      .get(t.id) as { c: number };
    expect(setsAfter.c).toBe(0);
    const revsAfter = db.$client
      .prepare("SELECT COUNT(*) AS c FROM user_team_revisions WHERE user_team_id = ?")
      .get(t.id) as { c: number };
    expect(revsAfter.c).toBe(0);
  });

  it("USR-T36. get returns null on missing id (does not throw)", () => {
    const db = open(":memory:"); opened = db;
    const r = userTeams.get(db, "01HUSER000000000000000099");
    expect(r).toBeNull();
  });
});
