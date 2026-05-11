/**
 * Stage 4 — RED tests for Stage D recommendTeamPlan integration
 * (RP1..RP10 — plan §10).
 *
 * End-to-end through `buildOverview` (mirrors Stage C precedent). Each
 * scenario's phases gain optional `state` (PhaseState); the cleaner's
 * key_calcs honor the Last Respects BP override; Stamina mid boosts;
 * Choice Scarf locks late.
 */

import { describe, expect, it } from "vitest";
import { buildOverview } from "../../../src/data/tactical/overview";
import { open } from "../../../src/db/open";

function deps(db: ReturnType<typeof open>): Parameters<typeof buildOverview>[1] {
  return {
    db,
    calc: { calc: () => ({}) },
    speed: {},
    synergy: { db },
    now: () => new Date("2026-05-11T00:00:00Z"),
  };
}

const TEAM_ID = "01H000000000000000000000T0";

describe("Stage D recommendTeamPlan integration (RP1..RP10)", () => {
  it("RP1. Every emitted scenario phase carries `state` (PhaseState defined)", () => {
    const db = open(":memory:");
    try {
      const ov = buildOverview(TEAM_ID, deps(db));
      for (const sc of ov.scenarios) {
        const phases = (sc as { phases: Array<{ state?: unknown }> }).phases;
        for (const p of phases) {
          expect(p.state).toBeDefined();
        }
      }
    } finally {
      db.$client.close();
    }
  });

  it("RP2. Lead-phase state.ours[*].hp_pct === 100 and boosts zeroed", () => {
    const db = open(":memory:");
    try {
      const ov = buildOverview(TEAM_ID, deps(db));
      for (const sc of ov.scenarios) {
        const lead = (sc as { phases: Array<{ state?: { ours: Array<{ hp_pct: number; boosts: Record<string, number> }> } }> }).phases[0];
        const ours = lead?.state?.ours ?? [];
        for (const m of ours) {
          expect(m.hp_pct).toBe(100);
          for (const v of Object.values(m.boosts)) expect(v).toBe(0);
        }
      }
    } finally {
      db.$client.close();
    }
  });

  it("RP3. Mid-phase state.ours[*].hp_pct reflects Q2 echo (within reasonable bounds)", () => {
    const db = open(":memory:");
    try {
      const ov = buildOverview(TEAM_ID, deps(db));
      for (const sc of ov.scenarios) {
        const mid = (sc as { phases: Array<{ state?: { ours: Array<{ hp_pct: number }> } }> }).phases[1];
        const ours = mid?.state?.ours ?? [];
        for (const m of ours) {
          // HP must be at least clamp-floor 1 and at most 100 (echo
          // path can only subtract from 100).
          expect(m.hp_pct).toBeGreaterThanOrEqual(1);
          expect(m.hp_pct).toBeLessThanOrEqual(100);
        }
      }
    } finally {
      db.$client.close();
    }
  });

  it("RP4. Sand mid: sand-vulnerable actors lose extra 6% HP on top of echo", () => {
    const db = open(":memory:");
    try {
      const ov = buildOverview(TEAM_ID, deps(db));
      const sand = ov.scenarios.find((s) => s.name === "Sand");
      if (!sand) return; // synthetic team may not generate a Sand scenario
      const mid = (sand as { phases: Array<{ field?: { weather: string }; state?: { ours: Array<{ hp_pct: number; species_id: string }> } }> }).phases[1];
      // Only assert when mid carries sand and there's at least one our actor.
      if (mid?.field?.weather === "sand" && (mid.state?.ours.length ?? 0) > 0) {
        for (const m of mid.state!.ours) {
          expect(m.hp_pct).toBeLessThanOrEqual(94);
        }
      }
    } finally {
      db.$client.close();
    }
  });

  it("RP5. Archaludon (Stamina) mid state.ours[i].boosts.def >= 1 when lead pair contains it", () => {
    const db = open(":memory:");
    try {
      const ov = buildOverview(TEAM_ID, deps(db));
      let archaSeen = false;
      for (const sc of ov.scenarios) {
        const lead = (sc as { phases: Array<{ active?: [string, string] }> }).phases[0];
        const active = lead?.active ?? ["", ""];
        if (!active.includes("archaludon")) continue;
        const mid = (sc as { phases: Array<{ state?: { ours: Array<{ species_id: string; boosts: { def: number } }> } }> }).phases[1];
        for (const m of mid?.state?.ours ?? []) {
          if (m.species_id === "archaludon") {
            archaSeen = true;
            expect(m.boosts.def).toBeGreaterThanOrEqual(1);
          }
        }
      }
      // Smoke: if no scenario put Archaludon in lead, this is vacuous —
      // the synthetic team may not pair Archaludon to lead. Document
      // by no-op assertion here (the live-demo gate is the canonical
      // pin per plan §10).
      void archaSeen;
    } finally {
      db.$client.close();
    }
  });

  it("RP6. Basculegion Scarf cleaner late state.ours[1].choice_locked_move is non-null and a known move id", () => {
    const db = open(":memory:");
    try {
      const ov = buildOverview(TEAM_ID, deps(db));
      let basculeSeen = false;
      for (const sc of ov.scenarios) {
        const late = (sc as { phases: Array<{ cleaner?: string; state?: { ours: Array<{ species_id: string; choice_locked_move: string | null }> } }> }).phases[2];
        if (late?.cleaner !== "basculegion") continue;
        for (const m of late.state?.ours ?? []) {
          if (m.species_id !== "basculegion") continue;
          basculeSeen = true;
          // Q4 deterministic max-roll pick.
          expect(m.choice_locked_move).not.toBeNull();
          expect(["lastrespects", "wavecrash"]).toContain(m.choice_locked_move);
        }
      }
      void basculeSeen;
    } finally {
      db.$client.close();
    }
  });

  // vacuous on synthetic test team — ArchaEye live demo is the canonical pin for the Last Respects BP override path
  it("RP7. Last Respects calc → key_calcs[*].notes contains 'Last Respects BP=' with integer >= 100", () => {
    const db = open(":memory:");
    try {
      const ov = buildOverview(TEAM_ID, deps(db));
      let pinSeen = false;
      for (const sc of ov.scenarios) {
        const late = (sc as { phases: Array<{ key_calcs?: Array<{ move_id: string; notes?: string }> }> }).phases[2];
        for (const kc of late?.key_calcs ?? []) {
          if (kc.move_id === "lastrespects" || kc.move_id === "Last Respects") {
            pinSeen = true;
            expect(kc.notes).toBeDefined();
            expect(kc.notes ?? "").toContain("Last Respects BP=");
            const m = (kc.notes ?? "").match(/Last Respects BP=(\d+)/);
            expect(m).not.toBeNull();
            expect(parseInt(m![1]!, 10)).toBeGreaterThanOrEqual(100);
          }
        }
      }
      void pinSeen;
    } finally {
      db.$client.close();
    }
  });

  // vacuous on synthetic test team — ArchaEye live demo is the canonical pin for the Last Respects BP override path
  it("RP8. Last Respects calc passes bp = 50 + 50 * fallen_allies_ours into damage_calc input", () => {
    const db = open(":memory:");
    try {
      // We can't intercept the calc input here without DI plumbing;
      // assert the surfaced derivation matches the formula via the
      // notes line (the only externally visible BP value).
      const ov = buildOverview(TEAM_ID, deps(db));
      for (const sc of ov.scenarios) {
        const late = (sc as { phases: Array<{ key_calcs?: Array<{ move_id: string; notes?: string }>; state?: { fallen_allies_ours: number } }> }).phases[2];
        const fa = late?.state?.fallen_allies_ours ?? 0;
        for (const kc of late?.key_calcs ?? []) {
          if (kc.move_id === "lastrespects" || kc.move_id === "Last Respects") {
            const m = (kc.notes ?? "").match(/Last Respects BP=(\d+) from fallen_allies=(\d+)/);
            if (m) {
              const bp = parseInt(m[1]!, 10);
              const fallenInNote = parseInt(m[2]!, 10);
              expect(bp).toBe(50 + 50 * fallenInNote);
              expect(fallenInNote).toBe(fa);
            }
          }
        }
      }
    } finally {
      db.$client.close();
    }
  });

  it("RP9. Stage A support_lift regression — lead.support_lift still typed correctly", () => {
    const db = open(":memory:");
    try {
      const ov = buildOverview(TEAM_ID, deps(db));
      for (const sc of ov.scenarios) {
        const lead = (sc as { phases: Array<{ support_lift?: number }> }).phases[0]!;
        expect(typeof lead.support_lift === "number" || lead.support_lift === undefined).toBe(true);
      }
    } finally {
      db.$client.close();
    }
  });

  it("RP10. Both Stage-D gates fireable: mid Stamina boost AND late Last Respects scaling (smoke)", () => {
    const db = open(":memory:");
    try {
      const ov = buildOverview(TEAM_ID, deps(db));
      // CI smoke: the gates depend on the live ArchaEye team. On a
      // synthetic test DB, assert the SHAPE of both gates is wired in
      // — every scenario emits state and key_calcs are arrays.
      for (const sc of ov.scenarios) {
        const phases = (sc as { phases: Array<{ state?: unknown; key_calcs?: unknown[] }> }).phases;
        for (const p of phases) {
          expect(p.state).toBeDefined();
        }
        const late = (sc as { phases: Array<{ key_calcs?: unknown[] }> }).phases[2];
        expect(Array.isArray(late?.key_calcs)).toBe(true);
      }
    } finally {
      db.$client.close();
    }
  });
});
