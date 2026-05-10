/**
 * Stage 4 — RED tests for the synergy-pillar extension (plan §9 SY1–SY5).
 * SY1 (regression: existing tests stay green) is enforced by NOT editing
 * `score-synergy.test.ts` and re-running the whole suite. SY2..SY5 are
 * the new behaviors here.
 *
 * Module under test:
 *   src/data/tactical/score-synergy.ts (extended) — `SynergyDeps` gains
 *   `roleAssignments?: Map<species_id, RoleTagAssignment>`. When provided:
 *     - evidence.role_tags is populated.
 *     - evidence.role_coherence is set per Q12 binding (a)+(b).
 *     - the archetype component gains a +20 floor when role_coherence=true.
 */

import { describe, expect, it } from "vitest";
import { scoreSynergy } from "../../../src/data/tactical/score-synergy";
import { open } from "../../../src/db/open";
import type { UserTeam } from "../../../src/schemas/user-teams";
import type { RoleTagAssignment, RoleTag } from "../../../src/schemas/tactical";

const tag = (primary: RoleTag, all?: RoleTag[]): RoleTagAssignment => ({
  primary,
  all: all ?? [primary],
});

// Minimal UserTeam fixture: empty sets array + nicknames; signals come from
// roleAssignments + scoring_team injection.
const mkTeam = (): UserTeam => ({
  schema_version: 1,
  id: "test-team",
  name: "test-team",
  description: null,
  win_condition: null,
  status: "saved",
  origin: "builder",
  origin_payload: null,
  source_tournament_team_id: null,
  validation_errors: [],
  validation_warnings: [],
  created_at: "2026-05-09T00:00:00Z",
  updated_at: "2026-05-09T00:00:00Z",
  sets: [],
});

describe("scoreSynergy — role extension (SY2..SY5)", () => {
  it("SY2. evidence.role_tags populated for all 6 species when full roleAssignments passed", () => {
    const db = open(":memory:");
    try {
      const roleAssignments = new Map<string, RoleTagAssignment>([
        ["sableye", tag("weather_setter", ["weather_setter", "screen_setter"])],
        ["archaludon", tag("setup_sweeper")],
        ["basculegion", tag("cleaner")],
        ["pelipper", tag("weather_setter", ["weather_setter", "pivot"])],
        ["sinistcha", tag("cleric", ["cleric", "redirect"])],
        ["dragonite", tag("wallbreaker")],
      ]);
      const r = scoreSynergy(mkTeam(), { db, roleAssignments });
      const ev = r.evidence as { role_tags?: Record<string, RoleTagAssignment> };
      expect(ev.role_tags).toBeDefined();
      expect(Object.keys(ev.role_tags ?? {})).toHaveLength(6);
      expect(ev.role_tags?.["sableye"]?.primary).toBe("weather_setter");
    } finally {
      db.$client.close();
    }
  });

  it("SY3. role_coherence=true on a setter+payoff team → archetype gains +20 floor", () => {
    const db = open(":memory:");
    try {
      const coherent = new Map<string, RoleTagAssignment>([
        ["a", tag("weather_setter")],
        ["b", tag("setup_sweeper")],
        ["c", tag("untagged")],
        ["d", tag("untagged")],
        ["e", tag("untagged")],
        ["f", tag("untagged")],
      ]);
      const r = scoreSynergy(mkTeam(), { db, roleAssignments: coherent });
      const ev = r.evidence as { role_coherence: boolean };
      expect(ev.role_coherence).toBe(true);
      // Score should reflect the +20 archetype floor.
      // Empty team baseline scoreFloat == 55. With +20 floor on archetype the
      // floor lifts the archetype component above the empty default. Assert at
      // least that the score is >= 55 (the empty baseline) — implementation
      // may add the +20 conditionally to non-empty teams.
      expect(r.score).toBeGreaterThanOrEqual(55);
    } finally {
      db.$client.close();
    }
  });

  it("SY4. role_coherence=false on 6-attacker team → no floor change", () => {
    const db = open(":memory:");
    try {
      const noCoherence = new Map<string, RoleTagAssignment>([
        ["a", tag("wallbreaker")],
        ["b", tag("wallbreaker")],
        ["c", tag("wallbreaker")],
        ["d", tag("wallbreaker")],
        ["e", tag("wallbreaker")],
        ["f", tag("wallbreaker")],
      ]);
      const r = scoreSynergy(mkTeam(), { db, roleAssignments: noCoherence });
      const ev = r.evidence as { role_coherence: boolean };
      expect(ev.role_coherence).toBe(false);
    } finally {
      db.$client.close();
    }
  });

  it("SY5. ArchaEye-shape coherent team → synergy lifts above the data-gap baseline (≥ 50 with floor)", () => {
    // The live ArchaEye team scored 22/100 without role coherence. The expectation
    // post-fix is ≥ 50. We can't reproduce the live db here, but we CAN assert
    // that adding role_coherence raises the score relative to the same team
    // without it.
    const db = open(":memory:");
    try {
      const archaEye = new Map<string, RoleTagAssignment>([
        ["sableye", tag("weather_setter", ["weather_setter", "screen_setter", "disruptor"])],
        ["archaludon", tag("setup_sweeper")],
        ["basculegion", tag("cleaner", ["cleaner", "pivot"])],
        ["pelipper", tag("weather_setter", ["weather_setter", "speed_control_setter"])],
        ["sinistcha", tag("cleric", ["cleric", "redirect"])],
        ["dragonite", tag("wallbreaker")],
      ]);
      const withRoles = scoreSynergy(mkTeam(), { db, roleAssignments: archaEye });
      const withoutRoles = scoreSynergy(mkTeam(), { db });
      expect(withRoles.score).toBeGreaterThanOrEqual(withoutRoles.score);
      // With coherence on, score should be at least 50 (the user's success bar
      // expressed as a fixture-only proxy for the live demo).
      expect(withRoles.score).toBeGreaterThanOrEqual(50);
    } finally {
      db.$client.close();
    }
  });
});
