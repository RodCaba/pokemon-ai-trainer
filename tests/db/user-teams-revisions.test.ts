/**
 * USR-T37..T41 — revision retention. Stage-4 red.
 *
 * USR-T37: setStatus('saved') from draft creates revision #1.
 * USR-T38: 5 saves keep all 5 (numbers 1..5).
 * USR-T39: 6th save evicts oldest; numbers become 2..6.
 * USR-T40: restoreRevision overwrites state and drops status to draft.
 * USR-T41: drafts don't create revisions; upsertSet doesn't either;
 *          checkpoint(teamId) creates a revision in any status (Q4).
 */

import { describe, expect, it, afterEach } from "vitest";
import * as userTeams from "../../src/db/user-teams";
import { open, type Db } from "../../src/db/open";
import { UserTeamRevisionNotFoundError } from "../../src/schemas/errors";
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

describe("userTeams revisions (USR-T37..T41)", () => {
  it("USR-T37. setStatus('saved') from draft creates revision #1", () => {
    const db = open(":memory:"); opened = db;
    const t = userTeams.create(db, { origin: "builder", name: "rev-1" });
    expect(userTeams.listRevisions(db, t.id)).toHaveLength(0);
    userTeams.setStatus(db, t.id, "saved", deps());
    const after = userTeams.listRevisions(db, t.id);
    expect(after).toHaveLength(1);
    expect(after[0]?.revision_number).toBe(1);
  });

  it("USR-T38. 5 saved-team updates keep all 5 revisions (numbers 1..5)", () => {
    const db = open(":memory:"); opened = db;
    const t = userTeams.create(db, { origin: "builder", name: "rev-5" });
    userTeams.setStatus(db, t.id, "saved", deps()); // rev 1
    for (let i = 0; i < 4; i++) {
      userTeams.update(db, t.id, { description: `edit ${i}` }); // rev 2..5
    }
    const revs = userTeams.listRevisions(db, t.id);
    expect(revs).toHaveLength(5);
    const nums = revs.map((r) => r.revision_number).sort((a, b) => a - b);
    expect(nums).toEqual([1, 2, 3, 4, 5]);
  });

  it("USR-T39. 6th save evicts the oldest (numbers become 2..6)", () => {
    const db = open(":memory:"); opened = db;
    const t = userTeams.create(db, { origin: "builder", name: "rev-6" });
    userTeams.setStatus(db, t.id, "saved", deps()); // rev 1
    for (let i = 0; i < 5; i++) {
      userTeams.update(db, t.id, { description: `edit ${i}` }); // rev 2..6
    }
    const revs = userTeams.listRevisions(db, t.id);
    expect(revs).toHaveLength(5);
    const nums = revs.map((r) => r.revision_number).sort((a, b) => a - b);
    expect(nums).toEqual([2, 3, 4, 5, 6]);
  });

  it("USR-T40. restoreRevision overwrites current state and drops status to draft (does NOT create a revision)", () => {
    const db = open(":memory:"); opened = db;
    const t = userTeams.create(db, { origin: "builder", name: "rev-restore" });
    userTeams.setStatus(db, t.id, "saved", deps()); // rev 1
    userTeams.update(db, t.id, { description: "later" });
    const revsBefore = userTeams.listRevisions(db, t.id);
    expect(revsBefore.length).toBeGreaterThanOrEqual(2);
    const restored = userTeams.restoreRevision(db, t.id, 1);
    expect(restored.status).toBe("draft");
    expect(restored.description).toBeNull(); // matches initial creation snapshot
    const revsAfter = userTeams.listRevisions(db, t.id);
    expect(revsAfter.length).toBe(revsBefore.length); // no new revision

    // Bad number → UserTeamRevisionNotFoundError.
    expect(() => userTeams.restoreRevision(db, t.id, 99)).toThrow(
      UserTeamRevisionNotFoundError,
    );
  });

  it("USR-T41. drafts don't create revisions on update/upsertSet; checkpoint() does on demand (Q4)", () => {
    const db = open(":memory:"); opened = db;
    const t = userTeams.create(db, { origin: "builder", name: "rev-checkpoint" });
    // Draft updates and upsertSets must not create revisions.
    userTeams.update(db, t.id, { description: "draft edit" });
    userTeams.upsertSet(db, t.id, 0, { hp_sps: 4 });
    expect(userTeams.listRevisions(db, t.id)).toHaveLength(0);

    // Explicit checkpoint creates one.
    const meta = userTeams.checkpoint(db, t.id, "manual save");
    expect(meta.revision_number).toBe(1);
    const revs = userTeams.listRevisions(db, t.id);
    expect(revs).toHaveLength(1);

    // Checkpoint also works while saved (Q4: callable in any status).
    userTeams.setStatus(db, t.id, "saved", deps()); // creates rev 2
    const meta2 = userTeams.checkpoint(db, t.id);
    expect(meta2.revision_number).toBeGreaterThan(meta.revision_number);
    expect(userTeams.listRevisions(db, t.id).length).toBeGreaterThanOrEqual(3);
  });
});
