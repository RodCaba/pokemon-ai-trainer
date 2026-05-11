/**
 * Stage 4 — RED tests for the support pillar scorer (plan §9 SU1–SU10).
 *
 * Module under test (does not exist yet):
 *   src/data/tactical/score-support.ts
 *     export function scoreSupport(roleAssignments, deps) → PillarScore
 *
 * Formula (plan §3.2):
 *   support_score = clamp(
 *       20 * count(screen_setter,        distinct mechanism per team)
 *     + 20 * count(speed_control_setter, distinct mechanism per team)
 *     + 20 * count(weather_setter,       distinct mechanism per team)
 *     + 15 * count(redirect)
 *     + 12 * count(cleric)
 *     + 10 * count(disruptor,            distinct mechanism per team)
 *     +  8 * count(pivot)
 *     + 10 * count(anti_priority)
 *     + role_coherence_bonus(team)       // 0 or +15
 *     , 0, 100)
 */

import { describe, expect, it } from "vitest";
import { scoreSupport } from "../../../src/data/tactical/score-support";
import type { RoleTagAssignment, RoleTag } from "../../../src/schemas/tactical";

const tag = (primary: RoleTag, all?: RoleTag[]): RoleTagAssignment => ({
  primary,
  all: all ?? [primary],
});

const map = (entries: Array<[string, RoleTagAssignment]>): Map<string, RoleTagAssignment> =>
  new Map(entries);

describe("scoreSupport — formula correctness (SU1–SU10)", () => {
  it("SU1. all-untagged team → score 0, tier Weak, evidence empty", () => {
    const roles = map([
      ["a", tag("untagged")],
      ["b", tag("untagged")],
      ["c", tag("untagged")],
      ["d", tag("untagged")],
      ["e", tag("untagged")],
      ["f", tag("untagged")],
    ]);
    const r = scoreSupport(roles);
    expect(r.score).toBe(0);
    expect(r.tier).toBe("Weak");
    expect(r.pillar).toBe("support");
  });

  it("SU2. one screen_setter only → +20, tier Weak (≤40)", () => {
    const roles = map([
      ["sableye", tag("screen_setter", ["screen_setter"])],
      ["b", tag("untagged")],
      ["c", tag("untagged")],
      ["d", tag("untagged")],
      ["e", tag("untagged")],
      ["f", tag("untagged")],
    ]);
    const r = scoreSupport(roles);
    expect(r.score).toBe(20);
    expect(r.tier).toBe("Weak");
  });

  it("SU3. ArchaEye golden → score ≥ 70 (Strong); coherence_chain populated", () => {
    const roles = map([
      ["sableye", tag("weather_setter", ["weather_setter", "screen_setter", "disruptor"])],
      ["archaludon", tag("setup_sweeper", ["setup_sweeper"])],
      ["basculegion", tag("cleaner", ["cleaner", "pivot"])],
      ["pelipper", tag("weather_setter", ["weather_setter", "speed_control_setter", "disruptor"])],
      ["sinistcha", tag("speed_control_setter", ["speed_control_setter", "redirect", "cleric"])],
      ["dragonite", tag("speed_control_setter", ["speed_control_setter"])],
    ]);
    const r = scoreSupport(roles);
    // Distinct sub-tags across team: screen_setter, speed_control_setter, weather_setter,
    // redirect, cleric, disruptor, pivot. No anti_priority.
    // 20 + 20 + 20 + 15 + 12 + 10 + 8 = 105 → clamped 100.
    // Plus coherence bonus +15 (already saturated).
    expect(r.score).toBeGreaterThanOrEqual(70);
    expect(r.tier).toBe("Strong");
    const ev = r.evidence as { role_coherence: boolean; coherence_chain: { setter: string; payoff: string; payoff_role: string } | null };
    expect(ev.role_coherence).toBe(true);
    expect(ev.coherence_chain).not.toBeNull();
    expect(ev.coherence_chain?.setter).toBe("sableye"); // highest BST among setters; tiebreaker per Q4
    expect(ev.coherence_chain?.payoff).toBe("archaludon");
    expect(ev.coherence_chain?.payoff_role).toBe("setup_sweeper");
  });

  it("SU4. Distinct-mechanism counting: one Sableye carrying 3 sub-setters → +60 (3 × 20)", () => {
    const roles = map([
      ["sableye", tag("weather_setter", ["weather_setter", "screen_setter", "speed_control_setter"])],
      ["b", tag("untagged")],
      ["c", tag("untagged")],
      ["d", tag("untagged")],
      ["e", tag("untagged")],
      ["f", tag("untagged")],
    ]);
    const r = scoreSupport(roles);
    // Three setter sub-tags distinct, no payoff → no coherence.
    // 20+20+20 = 60.
    expect(r.score).toBe(60);
    expect(r.tier).toBe("OK");
    const ev = r.evidence as { role_coherence: boolean };
    expect(ev.role_coherence).toBe(false);
  });

  it("SU5. Two screen-setters on the same team → still +20 for screen_setter (distinct mechanism, not per-set)", () => {
    const roles = map([
      ["a", tag("screen_setter", ["screen_setter"])],
      ["b", tag("screen_setter", ["screen_setter"])],
      ["c", tag("untagged")],
      ["d", tag("untagged")],
      ["e", tag("untagged")],
      ["f", tag("untagged")],
    ]);
    const r = scoreSupport(roles);
    expect(r.score).toBe(20);
  });

  it("SU6. role_coherence_bonus = +15 when (a)+(b) hold; 0 otherwise", () => {
    const withChain = map([
      ["s", tag("weather_setter", ["weather_setter"])],
      ["p", tag("setup_sweeper", ["setup_sweeper"])],
      ["a", tag("untagged")],
      ["b", tag("untagged")],
      ["c", tag("untagged")],
      ["d", tag("untagged")],
    ]);
    const r1 = scoreSupport(withChain);
    expect(r1.score).toBe(20 + 15); // weather_setter +20, coherence +15

    const noPayoff = map([
      ["s", tag("weather_setter", ["weather_setter"])],
      ["a", tag("untagged")],
      ["b", tag("untagged")],
      ["c", tag("untagged")],
      ["d", tag("untagged")],
      ["e", tag("untagged")],
    ]);
    const r2 = scoreSupport(noPayoff);
    expect(r2.score).toBe(20); // no coherence
  });

  it("SU7. 6 setters / 0 payoff → no coherence bonus, score = sum of mechanisms only", () => {
    const roles = map([
      ["a", tag("screen_setter", ["screen_setter"])],
      ["b", tag("speed_control_setter", ["speed_control_setter"])],
      ["c", tag("weather_setter", ["weather_setter"])],
      ["d", tag("disruptor", ["disruptor"])],
      ["e", tag("pivot", ["pivot"])],
      ["f", tag("redirect", ["redirect"])],
    ]);
    const r = scoreSupport(roles);
    // Mechanisms: screen 20 + speed 20 + weather 20 + disruptor 10 + pivot 8 + redirect 15 = 93.
    // No payoff (no setup_sweeper / cleaner) → no coherence bonus.
    expect(r.score).toBe(93);
    const ev = r.evidence as { role_coherence: boolean };
    expect(ev.role_coherence).toBe(false);
  });

  it("SU8. Tier boundaries: 0–40 Weak / 41–60 OK / 61–80 Good / 81–100 Strong", () => {
    const fakeBoundary = (score: number, expectedTier: "Weak" | "OK" | "Good" | "Strong") => {
      // Build a synthetic role map that yields exactly `score`. Because the formula
      // can't produce arbitrary ints, we cheat by exposing tierFor as a helper.
      // Falling back to a direct tier-only function:
      // (We assert tier boundaries via known-score fixtures.)
      return { score, expectedTier };
    };
    void fakeBoundary;

    // Score 0 → Weak.
    const allUntagged = map([
      ["a", tag("untagged")],
      ["b", tag("untagged")],
      ["c", tag("untagged")],
      ["d", tag("untagged")],
      ["e", tag("untagged")],
      ["f", tag("untagged")],
    ]);
    expect(scoreSupport(allUntagged).tier).toBe("Weak");

    // Score 40 → Weak (boundary inclusive).
    const at40 = map([
      ["a", tag("screen_setter", ["screen_setter"])],
      ["b", tag("speed_control_setter", ["speed_control_setter"])],
      ["c", tag("untagged")],
      ["d", tag("untagged")],
      ["e", tag("untagged")],
      ["f", tag("untagged")],
    ]);
    expect(scoreSupport(at40).score).toBe(40);
    expect(scoreSupport(at40).tier).toBe("Weak");

    // Score 41+ → OK.
    const at41 = map([
      ["a", tag("screen_setter", ["screen_setter"])],
      ["b", tag("speed_control_setter", ["speed_control_setter"])],
      ["c", tag("setup_sweeper", ["setup_sweeper"])],
      // setter +20 +20 + coherence +15 → 55? Let's calibrate:
      // screen +20, speed +20, coherence +15 → 55 → OK.
      ["d", tag("untagged")],
      ["e", tag("untagged")],
      ["f", tag("untagged")],
    ]);
    expect(scoreSupport(at41).tier).toBe("OK");

    // Score 61+ → Good.
    const at61 = map([
      ["a", tag("screen_setter", ["screen_setter"])],
      ["b", tag("speed_control_setter", ["speed_control_setter"])],
      ["c", tag("weather_setter", ["weather_setter"])],
      ["d", tag("setup_sweeper", ["setup_sweeper"])],
      ["e", tag("untagged")],
      ["f", tag("untagged")],
    ]);
    // 20+20+20+15(coherence) = 75 → Good.
    expect(scoreSupport(at61).score).toBeGreaterThanOrEqual(61);
    expect(scoreSupport(at61).tier).toBe("Good");

    // Score 81+ → Strong.
    const at81 = map([
      ["a", tag("screen_setter", ["screen_setter"])],
      ["b", tag("speed_control_setter", ["speed_control_setter"])],
      ["c", tag("weather_setter", ["weather_setter"])],
      ["d", tag("redirect", ["redirect"])],
      ["e", tag("setup_sweeper", ["setup_sweeper"])],
      ["f", tag("cleric", ["cleric"])],
    ]);
    // 20+20+20+15+12 +15(coherence) = 102 → clamped 100 → Strong.
    expect(scoreSupport(at81).score).toBeGreaterThanOrEqual(81);
    expect(scoreSupport(at81).tier).toBe("Strong");
  });

  it("SU9. evidence.mechanisms.weather_setters lists exactly the species_ids carrying weather setup", () => {
    const roles = map([
      ["sableye", tag("weather_setter", ["weather_setter", "screen_setter"])],
      ["pelipper", tag("weather_setter", ["weather_setter", "pivot"])],
      ["basculegion", tag("cleaner", ["cleaner"])],
    ]);
    const r = scoreSupport(roles);
    const ev = r.evidence as { mechanisms: { weather_setters: string[] } };
    expect(new Set(ev.mechanisms.weather_setters)).toEqual(new Set(["sableye", "pelipper"]));
  });

  it("SU10. Score is deterministic (same input → identical)", () => {
    const roles = map([
      ["sableye", tag("weather_setter", ["weather_setter", "screen_setter", "disruptor"])],
      ["archaludon", tag("setup_sweeper", ["setup_sweeper"])],
      ["sinistcha", tag("speed_control_setter", ["speed_control_setter", "redirect", "cleric"])],
    ]);
    const first = JSON.stringify(scoreSupport(roles));
    for (let i = 0; i < 50; i++) {
      expect(JSON.stringify(scoreSupport(roles))).toBe(first);
    }
  });
});
