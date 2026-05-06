/**
 * Tests T1–T5 for the `team-set` schemas. Per CLAUDE.md §3 pure-data
 * exemption, these are written as a single batch alongside a complete
 * schema implementation. Each `it()` still asserts a single behavior.
 */

import { describe, expect, it } from "vitest";
import {
  CompletenessSchema,
  PasteFetchResultSchema,
  SpsSchema,
  TeamSetSchema,
  type TeamSet,
} from "../../src/schemas/team-set";

const SOURCE = {
  schema_version: 1 as const,
  site: "pokepaste" as const,
  paste_id: "7205bf28f85d1e79",
  source_url: "https://pokepast.es/7205bf28f85d1e79",
  fetched_at: "2026-05-04T19:32:11.000Z",
};

function minimalSet(overrides: Partial<TeamSet> = {}): unknown {
  return {
    schema_version: 1,
    id: "labmaus:56757:244471:0",
    tournament_team_id: "labmaus:56757:244471",
    slot: 0,
    species_roster_id: "charizard",
    item: "Charizardite Y",
    ability: "Blaze",
    level: 50,
    moves: ["Heat Wave", "Weather Ball", "Solar Beam", "Protect"],
    sps: null,
    ivs: null,
    nature: null,
    completeness: "minimal",
    source: SOURCE,
    ...overrides,
  };
}

describe("team-set schemas", () => {
  it("T1. TeamSetSchema parses a minimal-completeness set (sps/ivs/nature null)", () => {
    const parsed = TeamSetSchema.parse(minimalSet());
    expect(parsed.sps).toBeNull();
    expect(parsed.ivs).toBeNull();
    expect(parsed.nature).toBeNull();
    expect(parsed.completeness).toBe("minimal");
    expect(parsed.species_roster_id).toBe("charizard");
  });

  it("T2. TeamSetSchema parses a full-completeness set (sps + ivs + nature populated)", () => {
    const parsed = TeamSetSchema.parse(
      minimalSet({
        sps: { hp: 4, atk: 32, def: 0, spa: 0, spd: 0, spe: 30 },
        ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
        nature: "Jolly",
        completeness: "full",
      }),
    );
    expect(parsed.sps?.atk).toBe(32);
    expect(parsed.ivs?.spe).toBe(31);
    expect(parsed.nature).toBe("Jolly");
    expect(parsed.completeness).toBe("full");
  });

  it("T3. TeamSetSchema rejects any tera_* field via .strict()", () => {
    const obj = minimalSet() as Record<string, unknown>;
    obj.tera_type = "Fire";
    const result = TeamSetSchema.safeParse(obj);
    expect(result.success).toBe(false);
  });

  it("T4. SpsSchema rejects total > 66", () => {
    const result = SpsSchema.safeParse({ hp: 32, atk: 32, def: 32, spa: 0, spd: 0, spe: 0 });
    expect(result.success).toBe(false);
  });

  it("T5. SpsSchema rejects per-stat > 32", () => {
    const result = SpsSchema.safeParse({ hp: 33, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 });
    expect(result.success).toBe(false);
  });

  it("T5b. CompletenessSchema accepts only 'minimal' | 'partial' | 'full'", () => {
    expect(CompletenessSchema.safeParse("minimal").success).toBe(true);
    expect(CompletenessSchema.safeParse("partial").success).toBe(true);
    expect(CompletenessSchema.safeParse("full").success).toBe(true);
    expect(CompletenessSchema.safeParse("none").success).toBe(false);
  });

  it("T5c. PasteFetchResultSchema requires sets.length ≥ 1", () => {
    const r = PasteFetchResultSchema.safeParse({
      paste_id: "7205bf28f85d1e79",
      raw_text: "x",
      sets: [],
      warnings: [],
      fetched_at: "2026-05-04T19:32:11.000Z",
    });
    expect(r.success).toBe(false);
  });
});
