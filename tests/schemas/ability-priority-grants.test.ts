/**
 * Stage 4 — RED tests for ability.priority_grants (S6..S8).
 * Pure-data exemption: batched.
 */

import { describe, expect, it } from "vitest";
import { AbilitySchema, PriorityGrantsSchema } from "../../src/schemas/ability";

const baseAbility = {
  schema_version: 1 as const,
  id: "prankster",
  display_name: "Prankster",
  source: {
    origin: "@smogon/calc" as const,
    engine_sha: "c1f6bc0fa2e0ee068b9e3061fa68b7db307e6c55",
    source_url: "https://github.com/RodCaba/damage-calc",
    fetched_at: "2026-05-04T00:00:00Z",
  },
};

describe("PriorityGrantsSchema (S6)", () => {
  it("S6a. accepts Prankster shape: { kind: 'status', bonus: 1 }", () => {
    const r = PriorityGrantsSchema.parse({ kind: "status", bonus: 1 });
    expect(r.kind).toBe("status");
    expect(r.bonus).toBe(1);
    expect(r.condition).toBeUndefined();
  });

  it("S6b. rejects bonus: 0 (must be ≥ 1)", () => {
    expect(PriorityGrantsSchema.safeParse({ kind: "status", bonus: 0 }).success).toBe(false);
  });

  it("S6c. AbilitySchema.priority_grants is optional", () => {
    expect(AbilitySchema.safeParse(baseAbility).success).toBe(true);
  });

  it("S6d. AbilitySchema accepts Prankster with priority_grants populated", () => {
    const r = AbilitySchema.parse({
      ...baseAbility,
      priority_grants: { kind: "status", bonus: 1 },
    });
    expect(r.priority_grants?.kind).toBe("status");
  });
});

describe("Gale Wings full-HP condition (S7)", () => {
  it("S7a. accepts condition: 'full_hp' on a Gale Wings shape", () => {
    const r = AbilitySchema.parse({
      ...baseAbility,
      id: "galewings",
      display_name: "Gale Wings",
      priority_grants: { kind: "flying", bonus: 1, condition: "full_hp" },
    });
    expect(r.priority_grants?.condition).toBe("full_hp");
  });

  it("S7b. condition is optional — Prankster without condition parses", () => {
    expect(
      AbilitySchema.safeParse({
        ...baseAbility,
        priority_grants: { kind: "status", bonus: 1 },
      }).success,
    ).toBe(true);
  });

  it("S7c. rejects unknown condition value", () => {
    expect(
      AbilitySchema.safeParse({
        ...baseAbility,
        priority_grants: { kind: "status", bonus: 1, condition: "half_hp" },
      }).success,
    ).toBe(false);
  });
});

describe("Triage healing shape (S8)", () => {
  it("S8a. accepts Triage { kind: 'healing', bonus: 3 }", () => {
    const r = AbilitySchema.parse({
      ...baseAbility,
      id: "triage",
      display_name: "Triage",
      priority_grants: { kind: "healing", bonus: 3 },
    });
    expect(r.priority_grants?.kind).toBe("healing");
    expect(r.priority_grants?.bonus).toBe(3);
  });

  it("S8b. rejects unknown kind value", () => {
    expect(
      AbilitySchema.safeParse({
        ...baseAbility,
        priority_grants: { kind: "dragon", bonus: 1 },
      }).success,
    ).toBe(false);
  });
});
