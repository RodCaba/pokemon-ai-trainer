/**
 * USR-T10..T22 — `validateTeam` per-code matrix. Stage-4 red.
 *
 * Per `docs/plans/user-teams.md` §4. Each test mints a near-valid team
 * and triggers exactly one violation. T10–T12 cover species coverage,
 * T13–T16 ref-table lookups, T17–T18 SPS caps, T19 slot_empty gating
 * (target_status='saved' only), T20 duplicate, T21 tera defense-in-depth,
 * T22 the errors/warnings split + setStatus('saved') tolerance.
 *
 * Stage 5 wires the deps to real ref-table repos. Stage 4 uses fake repo
 * objects so the test doesn't need a populated SQLite.
 */

import { describe, expect, it } from "vitest";
import { validateTeam, type ValidateDeps } from "../../src/data/team-validate";
import type { UserSet, UserTeam } from "../../src/schemas/user-teams";

function emptySet(slot: number): UserSet {
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

function legalSet(slot: number, speciesId: string): UserSet {
  return {
    ...emptySet(slot),
    species_id: speciesId,
    item_id: "Choice Scarf",
    ability_id: "Rough Skin",
    nature: "Adamant",
    move_1_id: "Earthquake",
    move_2_id: "Protect",
    hp_sps: 4,
    atk_sps: 12,
    def_sps: 0,
    spa_sps: 0,
    spd_sps: 0,
    spe_sps: 0,
  };
}

function team(sets: UserSet[]): UserTeam {
  // Pad to length 6.
  const padded = [...sets];
  for (let s = sets.length; s < 6; s++) padded.push(emptySet(s));
  return {
    schema_version: 1,
    id: "01HZX2J5K8M7P1Q3R4S5T6V7W9",
    name: "T",
    description: null,
    win_condition: null,
    status: "draft",
    origin: "builder",
    origin_payload: null,
    source_tournament_team_id: null,
    validation_errors: [],
    validation_warnings: [],
    sets: padded.slice(0, 6) as UserTeam["sets"],
    created_at: "2026-05-08T00:00:00Z",
    updated_at: "2026-05-08T00:00:00Z",
  };
}

function fakeDeps(opts: {
  knownSpecies?: Set<string>;
  legalSpecies?: Set<string>;
  knownItems?: Set<string>;
  knownAbilities?: Set<string>;
  knownMoves?: Set<string>;
  legalAbilitiesPerSpecies?: Record<string, string[]>;
  legalMovesPerSpecies?: Record<string, string[]>;
}): ValidateDeps {
  const knownSpecies =
    opts.knownSpecies ?? new Set(["garchomp", "incineroar", "clefable", "sneasler"]);
  const legalSpecies = opts.legalSpecies ?? knownSpecies;
  const knownItems =
    opts.knownItems ?? new Set(["Choice Scarf", "Sitrus Berry", "Black Glasses"]);
  const knownAbilities =
    opts.knownAbilities ?? new Set(["Rough Skin", "Intimidate", "Unaware", "Defiant", "Unburden"]);
  const knownMoves =
    opts.knownMoves ??
    new Set([
      "Earthquake",
      "Protect",
      "Heat Wave",
      "Moonblast",
      "Sucker Punch",
      "Fake Out",
      "Close Combat",
    ]);
  const legalAbilities =
    opts.legalAbilitiesPerSpecies ?? {
      garchomp: ["Rough Skin", "Sand Veil"],
      incineroar: ["Intimidate", "Blaze"],
      clefable: ["Unaware", "Magic Guard"],
      sneasler: ["Unburden", "Poison Touch"],
    };
  const legalMoves =
    opts.legalMovesPerSpecies ?? {
      garchomp: ["Earthquake", "Protect", "Outrage"],
      incineroar: ["Fake Out", "Flare Blitz", "Protect"],
      clefable: ["Moonblast", "Protect", "Follow Me"],
      sneasler: ["Close Combat", "Fake Out", "Gunk Shot", "Protect"],
    };
  // The fake `db` is unused by the fakes (every `has` is a Set lookup).
  const db = {} as ValidateDeps["db"];
  return {
    db,
    speciesRepo: {
      has: (_d, n) => knownSpecies.has(n),
      get: (_d, n) => (knownSpecies.has(n) ? { id: n } : null),
    },
    itemsRepo: { has: (_d, n) => knownItems.has(n) },
    abilitiesRepo: { has: (_d, n) => knownAbilities.has(n) },
    movesRepo: { has: (_d, n) => knownMoves.has(n) },
    rosterRepo: {
      isLegalForFormat: (_d, id) => ({
        in_membership: knownSpecies.has(id),
        is_legal: legalSpecies.has(id),
      }),
    },
    speciesAbilities: {
      legalFor: (_d, id) => legalAbilities[id] ?? [],
    },
    speciesMovepool: {
      legalFor: (_d, id) => legalMoves[id] ?? [],
    },
  };
}

describe("validateTeam (USR-T10..T22)", () => {
  it("USR-T10. emits species_unknown for an unknown roster id", () => {
    const t = team([{ ...legalSet(0, "garchomp"), species_id: "not-a-pokemon" }]);
    const r = validateTeam(t, fakeDeps({}));
    const codes = r.errors.map((e) => e.code);
    expect(codes).toContain("species_unknown");
  });

  it("USR-T11. species_not_legal_warning stays a warning at target_status='saved' (flow §11 Q5: 'allow without blocking')", () => {
    const t = team([legalSet(0, "incineroar")]);
    const r = validateTeam(
      t,
      fakeDeps({
        knownSpecies: new Set(["incineroar"]),
        legalSpecies: new Set([]), // in roster, not legal
      }),
      { target_status: "saved" },
    );
    const errCodes = r.errors.map((e) => e.code);
    const warnCodes = r.warnings.map((w) => w.code);
    // Must NOT promote to error — flow's Q5 binding ("allow without blocking").
    expect(errCodes).not.toContain("species_not_legal");
    // Must remain a warning regardless of target_status.
    expect(warnCodes).toContain("species_not_legal_warning");
  });

  it("USR-T12. species not in roster_membership at all → species_unknown error (Q8)", () => {
    // Stage-2 Q8 binding: species absent from roster_membership is
    // species_unknown (error), not species_not_legal_warning.
    const t = team([legalSet(0, "missingmon")]);
    const r = validateTeam(
      t,
      fakeDeps({ knownSpecies: new Set([]), legalSpecies: new Set([]) }),
    );
    const codes = r.errors.map((e) => e.code);
    expect(codes).toContain("species_unknown");
    const warns = r.warnings.map((w) => w.code);
    expect(warns).not.toContain("species_not_legal_warning");
  });

  it("USR-T13. emits ability_not_legal when ability is not on species_abilities for that species", () => {
    const t = team([{ ...legalSet(0, "garchomp"), ability_id: "Levitate" }]);
    const r = validateTeam(t, fakeDeps({ knownAbilities: new Set(["Rough Skin", "Levitate"]) }));
    const codes = r.errors.map((e) => e.code);
    expect(codes).toContain("ability_not_legal");
  });

  it("USR-T14. emits move_not_legal once per offending move", () => {
    const t = team([
      {
        ...legalSet(0, "garchomp"),
        move_1_id: "Earthquake",
        move_2_id: "Heat Wave",  // not in garchomp's movepool
        move_3_id: "Moonblast", // also not legal
        move_4_id: null,
      },
    ]);
    const r = validateTeam(t, fakeDeps({}));
    const moveErrors = r.errors.filter((e) => e.code === "move_not_legal");
    expect(moveErrors.length).toBeGreaterThanOrEqual(2);
  });

  it("USR-T15. emits item_unknown for an item not in the items table", () => {
    const t = team([{ ...legalSet(0, "garchomp"), item_id: "Life Orb" }]);
    const r = validateTeam(t, fakeDeps({}));
    const codes = r.errors.map((e) => e.code);
    expect(codes).toContain("item_unknown");
  });

  it("USR-T16. emits nature_unknown for a non-canonical nature string", () => {
    const t = team([{ ...legalSet(0, "garchomp"), nature: "Bashful Plus" }]);
    const r = validateTeam(t, fakeDeps({}));
    const codes = r.errors.map((e) => e.code);
    expect(codes).toContain("nature_unknown");
  });

  it("USR-T17. emits sps_total_exceeded per-set (memory regulation_m_a_stat_rules: 66 budget is per Pokémon, not whole team)", () => {
    const t = team([
      { ...legalSet(0, "garchomp"), hp_sps: 32, atk_sps: 32, def_sps: 4 },
    ]);
    const r = validateTeam(t, fakeDeps({}));
    const matched = r.errors.filter((e) => e.code === "sps_total_exceeded");
    expect(matched).toHaveLength(1);
    expect(matched[0]?.slot).toBe(0);
    expect(matched[0]?.message).toMatch(/68/);
  });

  it("USR-T18. emits sps_per_stat_exceeded with a per-slot annotation", () => {
    // Construct via casting: schema would normally reject 33, but the
    // validator must defensively catch this.
    const set = { ...legalSet(0, "garchomp"), hp_sps: 33 } as unknown as UserSet;
    const t = team([set]);
    const r = validateTeam(t, fakeDeps({}));
    const matched = r.errors.filter((e) => e.code === "sps_per_stat_exceeded");
    expect(matched.length).toBeGreaterThanOrEqual(1);
    expect(matched[0]?.slot).toBe(0);
  });

  it("USR-T19. emits slot_empty only when target_status='saved'", () => {
    // Empty sets, target=draft → no slot_empty.
    const draftResult = validateTeam(team([]), fakeDeps({}), { target_status: "draft" });
    expect(draftResult.errors.filter((e) => e.code === "slot_empty")).toHaveLength(0);

    // Same team, target=saved → 6 slot_empty errors.
    const savedResult = validateTeam(team([]), fakeDeps({}), { target_status: "saved" });
    expect(savedResult.errors.filter((e) => e.code === "slot_empty").length).toBeGreaterThanOrEqual(1);
  });

  it("USR-T20. emits duplicate_species when two slots share a species_id", () => {
    const t = team([legalSet(0, "garchomp"), legalSet(1, "garchomp")]);
    const r = validateTeam(t, fakeDeps({}));
    const dups = r.errors.filter((e) => e.code === "duplicate_species");
    expect(dups.length).toBeGreaterThanOrEqual(1);
  });

  it("USR-T21. emits tera_present (defensive) when a tera_* key leaks onto the input", () => {
    // Inject via cast — the schema would reject this, but the validator
    // is the second-line defense.
    const t = team([legalSet(0, "garchomp")]);
    const corrupted = { ...t, tera_type: "Fire" } as unknown as UserTeam;
    const r = validateTeam(corrupted, fakeDeps({}));
    const codes = r.errors.map((e) => e.code);
    expect(codes).toContain("tera_present");
  });

  it("USR-T22. errors and warnings live on separate arrays; warnings do not block 'saved'", () => {
    // species in roster, is_legal=0 → warning at draft, error at saved.
    const t = team([legalSet(0, "incineroar")]);
    const draft = validateTeam(
      t,
      fakeDeps({
        knownSpecies: new Set(["incineroar"]),
        legalSpecies: new Set([]),
      }),
      { target_status: "draft" },
    );
    expect(draft.warnings.map((w) => w.code)).toContain("species_not_legal_warning");
    expect(draft.errors.map((e) => e.code)).not.toContain("species_not_legal");

    // At saved, the warning stays a warning — flow §11 Q5 binding allows
    // unreleased species through without blocking. The only target-status-
    // specific error is `slot_empty` (covered by USR-T19).
    const saved = validateTeam(
      t,
      fakeDeps({
        knownSpecies: new Set(["incineroar"]),
        legalSpecies: new Set([]),
      }),
      { target_status: "saved" },
    );
    expect(saved.errors.map((e) => e.code)).not.toContain("species_not_legal");
    expect(saved.warnings.map((w) => w.code)).toContain("species_not_legal_warning");
  });
});
