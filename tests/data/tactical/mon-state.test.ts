/**
 * Stage 6 — review followup: direct coverage of mon-state.ts helpers.
 *
 * The Stage-D RED suite (`derive-turn-states.test.ts`) exercises these
 * indirectly via `deriveTurnStates`; this file pins each helper in
 * isolation so future refactors that move helpers around have a
 * narrow-scope failure signal.
 */

import { describe, expect, it } from "vitest";
import {
  clampHpPct,
  isSandImmune,
  isDbConfirmedMove,
} from "../../../src/data/tactical/mon-state";

describe("clampHpPct", () => {
  it("clamps below 1 → 1", () => {
    expect(clampHpPct(-5)).toBe(1);
    expect(clampHpPct(0)).toBe(1);
    expect(clampHpPct(0.4)).toBe(1);
  });

  it("preserves in-range integers", () => {
    expect(clampHpPct(1)).toBe(1);
    expect(clampHpPct(50)).toBe(50);
    expect(clampHpPct(100)).toBe(100);
  });

  it("rounds half-up before clamping", () => {
    expect(clampHpPct(50.7)).toBe(51);
    expect(clampHpPct(50.4)).toBe(50);
  });

  it("clamps above 100 → 100", () => {
    expect(clampHpPct(101)).toBe(100);
    expect(clampHpPct(999)).toBe(100);
  });

  it("non-finite inputs collapse to 100", () => {
    expect(clampHpPct(Number.NaN)).toBe(100);
    expect(clampHpPct(Number.POSITIVE_INFINITY)).toBe(100);
    expect(clampHpPct(Number.NEGATIVE_INFINITY)).toBe(100);
  });
});

describe("isSandImmune", () => {
  it("Rock / Ground / Steel types → immune (via speciesTypes lookup)", () => {
    const t = new Map<string, ReadonlyArray<string>>([
      ["tyranitar", ["Rock", "Dark"]],
      ["garchomp", ["Dragon", "Ground"]],
      ["scizor", ["Bug", "Steel"]],
    ]);
    expect(isSandImmune("tyranitar", null, t)).toBe(true);
    expect(isSandImmune("garchomp", null, t)).toBe(true);
    expect(isSandImmune("scizor", null, t)).toBe(true);
  });

  it("Fire / Flying species → vulnerable", () => {
    const t = new Map<string, ReadonlyArray<string>>([
      ["dragonite", ["Dragon", "Flying"]],
      ["arcanine", ["Fire"]],
    ]);
    expect(isSandImmune("dragonite", null, t)).toBe(false);
    expect(isSandImmune("arcanine", null, t)).toBe(false);
  });

  it("immune abilities short-circuit type check", () => {
    const t = new Map<string, ReadonlyArray<string>>([
      ["clefable", ["Fairy"]], // Fairy is not in {Rock,Ground,Steel}.
    ]);
    for (const ab of [
      "magicguard", "Magic Guard", "magic-guard",
      "overcoat", "Overcoat",
      "sandforce", "sand force",
      "sandrush", "sand-rush",
      "sandveil", "sand veil",
    ]) {
      expect(isSandImmune("clefable", ab, t)).toBe(true);
    }
  });

  it("combined: vulnerable type + immune ability → immune", () => {
    const t = new Map<string, ReadonlyArray<string>>([
      ["clefable", ["Fairy"]],
    ]);
    expect(isSandImmune("clefable", "magicguard", t)).toBe(true);
  });

  it("no map + non-fallback species → vulnerable (conservative)", () => {
    // `pikachu` not in the curated fallback set; lookup absent ⇒ false.
    expect(isSandImmune("pikachu", null)).toBe(false);
  });

  it("no map + fallback species → immune (test-only path)", () => {
    expect(isSandImmune("archaludon", null)).toBe(true);
  });

  it("ability lookup is case-insensitive", () => {
    expect(isSandImmune("pikachu", "OVERCOAT")).toBe(true);
  });
});

describe("isDbConfirmedMove", () => {
  it("undefined panel → false", () => {
    expect(isDbConfirmedMove("amoonguss", "spore", undefined)).toBe(false);
  });

  it("empty entries → false", () => {
    expect(
      isDbConfirmedMove("amoonguss", "spore", { entries: [] }),
    ).toBe(false);
  });

  it("species miss → false", () => {
    const panel = {
      entries: [
        { species_roster_id: "tinkaton", set: { moves: ["spore"] } },
      ],
    };
    expect(isDbConfirmedMove("amoonguss", "spore", panel)).toBe(false);
  });

  it("move miss on present species → false", () => {
    const panel = {
      entries: [
        { species_roster_id: "amoonguss", set: { moves: ["rage powder", "protect"] } },
      ],
    };
    expect(isDbConfirmedMove("amoonguss", "spore", panel)).toBe(false);
  });

  it("hit on set.moves → true", () => {
    const panel = {
      entries: [
        { species_roster_id: "amoonguss", set: { moves: ["spore", "protect"] } },
      ],
    };
    expect(isDbConfirmedMove("amoonguss", "spore", panel)).toBe(true);
  });

  it("case-insensitive canonical match (display name + canonical id)", () => {
    const panel = {
      entries: [
        { species_roster_id: "AMOONGUSS", set: { moves: ["Will-O-Wisp"] } },
      ],
    };
    expect(isDbConfirmedMove("amoonguss", "willowisp", panel)).toBe(true);
  });

  it("spec.moves is no longer consulted (single-key contract)", () => {
    const panel = {
      entries: [
        // legacy `spec.moves` location — must be ignored under the
        // Stage 6 single-key contract.
        { species_roster_id: "amoonguss", spec: { moves: ["spore"] } },
      ],
    } as unknown as { entries: Array<unknown> };
    expect(isDbConfirmedMove("amoonguss", "spore", panel)).toBe(false);
  });
});
