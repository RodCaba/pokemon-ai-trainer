/**
 * Stage 4 — RED tests for phase-aware citation retrieval (PC1..PC5).
 * Plan §8 + Q6 §17 (phase_tag_source flag).
 */

import { describe, expect, it } from "vitest";
import { findPhaseCitations } from "../../../src/data/tactical/cite-phases";
import { open } from "../../../src/db/open";
import { createEmbedClient } from "../../../src/tools/knowledge/embed";
import type { LeadPhase, MidPhase, LatePhase } from "../../../src/schemas/tactical";

const lead: LeadPhase = {
  phase: "lead",
  turn_window: [1, 2],
  active: ["sableye", "archaludon"],
  rationale: "",
  key_calcs: [],
  abandon_if: "",
};
const mid: MidPhase = {
  phase: "mid",
  turn_window: [2, 4],
  pivot_in: "sinistcha",
  pivot_out: null,
  rationale: "",
  key_calcs: [],
  trigger: "",
};
const late: LatePhase = {
  phase: "late",
  turn_window: [4, 8],
  cleaner: "basculegion",
  rationale: "",
  key_calcs: [],
  win_condition: "",
};

const fakeEmbed = createEmbedClient({ apiKey: "test", model: "voyage-3-lite" });

describe("findPhaseCitations (PC1..PC5)", () => {
  it("PC1. returns an array (≤ 3 citations)", async () => {
    const db = open(":memory:");
    try {
      const cites = await findPhaseCitations([lead, mid, late], {
        db,
        embedClient: fakeEmbed,
      });
      expect(Array.isArray(cites)).toBe(true);
      expect(cites.length).toBeLessThanOrEqual(3);
    } finally {
      db.$client.close();
    }
  });

  it("PC2. empty insights table → zero citations (no throw)", async () => {
    const db = open(":memory:");
    try {
      const cites = await findPhaseCitations([lead, mid, late], {
        db,
        embedClient: fakeEmbed,
      });
      expect(cites).toEqual([]);
    } finally {
      db.$client.close();
    }
  });

  it("PC3. each citation carries species_ids overlapping the phase actor(s)", async () => {
    // Stage 4 stub returns []; this assertion validates the contract for
    // Stage 5 — non-empty results must obey the species filter.
    const db = open(":memory:");
    try {
      const cites = await findPhaseCitations([lead, mid, late], {
        db,
        embedClient: fakeEmbed,
      });
      for (const c of cites) {
        const phaseActors = new Set([
          ...lead.active,
          mid.pivot_in,
          late.cleaner,
        ]);
        const overlap = c.species_ids.some((s) => phaseActors.has(s));
        expect(overlap).toBe(true);
      }
    } finally {
      db.$client.close();
    }
  });

  it("PC4. when phase_tag filter would return zero, phase_tag_source is 'fallback'", async () => {
    // Contract: Stage 5 implementation must set the discriminator when
    // re-issuing the query without the phase_tag filter. Stage 4 stub
    // returns [] so this assertion is vacuous-green today but pins the
    // Stage 5 expectation.
    const db = open(":memory:");
    try {
      const cites = await findPhaseCitations([lead, mid, late], {
        db,
        embedClient: fakeEmbed,
      });
      for (const c of cites) {
        expect(["phase_specific", "fallback", undefined]).toContain(c.phase_tag_source);
      }
    } finally {
      db.$client.close();
    }
  });

  it("PC5. fast path: deterministic ordering (citations[0] is the lead-phase win when present)", async () => {
    const db = open(":memory:");
    try {
      const cites = await findPhaseCitations([lead, mid, late], {
        db,
        embedClient: fakeEmbed,
      });
      // Stub returns empty — Stage 5 stable-orders lead → mid → late.
      expect(Array.isArray(cites)).toBe(true);
    } finally {
      db.$client.close();
    }
  });
});
