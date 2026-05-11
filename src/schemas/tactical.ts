/**
 * Zod schemas + inferred types for the `team-tactical-overview` slice domain.
 *
 * Pure-data module per CLAUDE.md §3 — landed as a single batch under the
 * pure-data exemption (disclosed in the Stage-4 commit). Tests in
 * `tests/schemas/tactical.test.ts` lock externally visible behavior:
 * round-trip, bounds, discriminator, ISO-date format, Tera defense-in-depth,
 * LeadPlan parallel relationship.
 *
 * Reg M-A invariants (memory `regulation_m_a_no_tera.md`): no `tera_*`
 * field exists on any schema; `.strict()` rejects anything that leaks
 * through. `ScenarioFieldSchema` enumerates only Reg M-A field state.
 */

import { z } from "zod";
import { TeamSetSchema } from "./team-set";

const RosterId = z.string().regex(/^[a-z0-9-]+$/);
const ISODate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ISODateTime = z.string().datetime({ offset: false });

/** Coarse per-pillar tier label. */
export const TierLabelSchema = z.enum(["Weak", "OK", "Good", "Strong"]);

/**
 * Reg M-A field state for a scenario. No `tera_*` field by design
 * (memory `regulation_m_a_no_tera.md`); `.strict()` rejects extras.
 */
export const ScenarioFieldSchema = z
  .object({
    weather: z.enum(["none", "sun", "rain", "sand", "snow"]).default("none"),
    terrain: z
      .enum(["none", "electric", "grassy", "misty", "psychic"])
      .default("none"),
    trick_room: z.boolean().default(false),
    tailwind_ours: z.boolean().default(false),
    tailwind_theirs: z.boolean().default(false),
    light_screen: z.boolean().default(false),
    reflect: z.boolean().default(false),
    gravity: z.boolean().default(false),
  })
  .strict();

/** A single threat-panel entry: species + canonical set + usage weight. */
export const ThreatEntrySchema = z
  .object({
    species_id: RosterId,
    weight: z.number().min(0).max(1),
    set: TeamSetSchema,
    source: z
      .object({
        type: z.enum(["pikalytics", "labmaus_consensus"]),
        as_of: ISODate,
      })
      .strict(),
  })
  .strict();

/** Curated 15-entry usage-weighted panel of canonical threats. */
export const ThreatPanelSchema = z
  .object({
    schema_version: z.literal(1),
    as_of: ISODate,
    generated_at: ISODateTime,
    entries: z.array(ThreatEntrySchema).min(1).max(25),
  })
  .strict();

/** One (our_slot vs threat) damage outcome row used as evidence. */
export const ThreatHitSchema = z
  .object({
    threat_species_id: RosterId,
    our_slot: z.number().int().min(0).max(5),
    our_species_id: RosterId,
    best_move_id: z.string(),
    ko_chance_pct: z.number().min(0).max(100),
    max_roll_pct: z.number().min(0).max(100),
    weight: z.number().min(0).max(1),
  })
  .strict();

/** Per-pillar 0–100 score + tier + pillar-specific evidence record. */
export const PillarScoreSchema = z
  .object({
    pillar: z.enum(["offense", "defense", "speed", "synergy", "support"]),
    score: z.number().int().min(0).max(100),
    tier: TierLabelSchema,
    evidence: z.record(z.unknown()),
  })
  .strict();

/** Bundle of all five pillar scores for a team. Stage A bumped from 4 → 5. */
export const PillarBundleSchema = z
  .object({
    offense: PillarScoreSchema,
    defense: PillarScoreSchema,
    speed: PillarScoreSchema,
    synergy: PillarScoreSchema,
    support: PillarScoreSchema,
  })
  .strict();

/** Stage A: deterministic role classification per set.
 *  Plan §3 + §3.1; Q2 binding split `setter` into three sub-tags. */
export const RoleTagSchema = z.enum([
  "screen_setter",
  "speed_control_setter",
  "weather_setter",
  "redirect",
  "cleric",
  "disruptor",
  "pivot",
  "setup_sweeper",
  "cleaner",
  "wallbreaker",
  "anti_priority",
  "untagged",
]);
export type RoleTag = z.infer<typeof RoleTagSchema>;

/** Weather a set brings (Rain Dance, Drizzle, etc.) or depends on
 *  (Electro Shot's 1-turn-in-rain, Solar Beam's 1-turn-in-sun, etc.). */
export const WeatherKindSchema = z.enum(["rain", "sun", "sand", "snow"]);
export type WeatherKind = z.infer<typeof WeatherKindSchema>;

/** Per-set role assignment: the highest-priority `primary` + every tag that
 *  hit. Optional weather pairing data lets the support_lift scorer match a
 *  rain-bringer to a rain-dependent payoff (Sableye Rain Dance →
 *  Archaludon Electro Shot) instead of treating all setters as
 *  interchangeable (plan §12 Q12(c) — mechanism compatibility). */
export const RoleTagAssignmentSchema = z
  .object({
    primary: RoleTagSchema,
    all: z.array(RoleTagSchema).min(1),
    /** Set when the role classifier detects a weather move/ability that
     *  brings this weather to the field. */
    weather_provided: WeatherKindSchema.optional(),
    /** Set when the role classifier detects a charging move whose
     *  charge-skip condition is this weather (Electro Shot ⇒ rain,
     *  Solar Beam ⇒ sun). The name reads as "the weather this move
     *  REQUIRES to skip its charge turn" — not a general payoff hint. */
    weather_charged_move: WeatherKindSchema.optional(),
  })
  .strict();
export type RoleTagAssignment = z.infer<typeof RoleTagAssignmentSchema>;

const RoleAssignmentRecord = z.record(RoleTagAssignmentSchema);

const SupportMechanismsSchema = z
  .object({
    screens: z.array(RosterId),
    weather_setters: z.array(RosterId),
    speed_control: z.array(RosterId),
    redirection: z.array(RosterId),
    healers: z.array(RosterId),
    disruption: z.array(RosterId),
    pivots: z.array(RosterId),
    anti_priority: z.array(RosterId),
  })
  .strict();

const CoherenceChainSchema = z
  .object({
    setter: RosterId,
    payoff: RosterId,
    payoff_role: RoleTagSchema,
  })
  .strict();

/** Pillar-specific evidence for `support`. */
export const SupportPillarEvidenceSchema = z
  .object({
    role_tags: RoleAssignmentRecord,
    mechanisms: SupportMechanismsSchema,
    role_coherence: z.boolean(),
    coherence_chain: CoherenceChainSchema.nullable(),
  })
  .strict();
export type SupportPillarEvidence = z.infer<typeof SupportPillarEvidenceSchema>;

/** Discriminator for ScenarioSkeleton kind.
 *  - `archetype`: Sun / Rain / Sand / Snow / Trick Room / Perish Trap
 *  - `individual`: top-usage threat by species
 *  - `weakness_counter`: auto-generated for structural team weakness
 *  - `meta_team`: top-frequency 6-species tournament team composition
 *  - `mirror_match`: emitted when user's own composition matches a
 *    high-frequency tournament cluster — the user WILL face this team
 *    at events, and mirror dynamics are distinct from generic meta_team. */
export const ScenarioTypeSchema = z.enum([
  "archetype",
  "individual",
  "weakness_counter",
  "meta_team",
  "mirror_match",
]);

/** Citation pulled from `knowledge_chunks` for a scenario. */
export const TacticalCitationSchema = z
  .object({
    knowledge_chunk_id: z.string(),
    excerpt: z.string().max(500),
    source_url: z.string().url(),
    species_ids: z.array(RosterId),
    /** `'vgcguide' | 'metavgc'` — surfaces the publisher of the chunk. */
    source_site: z.string().min(1).optional(),
    /** Article title from `knowledge_chunks.article_title`. */
    article_title: z.string().optional(),
    /** Stage B (Q6 §17): set when the citation was retrieved via the
     *  phase-aware filter. `"phase_specific"` means the chunk's
     *  `phase_tag` matched the requested phase; `"fallback"` means the
     *  phase-tag filter returned zero hits and the citation was
     *  surfaced via a species + claim_type only retry. */
    phase_tag_source: z.enum(["phase_specific", "fallback"]).optional(),
  })
  .strict();

/** Reference to a calc result (compact echo, not a full CalcResult). */
export const CalcResultRefSchema = z
  .object({
    attacker_species_id: RosterId,
    defender_species_id: RosterId,
    move_id: z.string(),
    max_roll_pct: z.number(),
    ko_chance_desc: z.string(),
    field_summary: z.string(),
  })
  .strict();

// `ScenarioSkeletonSchema` was removed in Stage B (Q5 §17). Use
// {@link TeamPlanScenarioSchema} for the per-scenario output;
// {@link ScenarioSkeletonSchema} carries the input-side fields shared
// by both Stage A's removed shape and Stage B's plan output.

/** Input-side fields shared by every scenario. `scenarios.ts` builds
 *  skeletons against this shape; the scoring loop
 *  (Stage B: `recommendTeamPlan`) reads them. */
export const ScenarioSkeletonSchema = z
  .object({
    name: z.string().min(1),
    type: ScenarioTypeSchema,
    field: ScenarioFieldSchema,
    opposing_preview: z.array(RosterId).min(1).max(6),
    description: z.string().max(800).optional(),
  })
  .strict();
export type ScenarioSkeleton = z.infer<typeof ScenarioSkeletonSchema>;

// ---- Stage B — phase-aware planning ----

const TurnWindowSchema = z
  .tuple([z.number().int().min(1), z.number().int().min(1)])
  .refine(([a, b]) => a <= b, "turn_window start must be ≤ end");

/** Lead phase — turn 1–2. Two active species + abandon condition. */
export const LeadPhaseSchema = z
  .object({
    phase: z.literal("lead"),
    turn_window: TurnWindowSchema,
    active: z.tuple([RosterId, RosterId]),
    rationale: z.string().max(300),
    key_calcs: z.array(CalcResultRefSchema).min(0).max(2),
    abandon_if: z.string().max(200),
    /** Q9 §17: preserves Stage A's `support_lift` introspection signal. */
    support_lift: z.number().optional(),
  })
  .strict();

/** Mid phase — turn 2–4. One pivot-in, optional pivot-out. */
export const MidPhaseSchema = z
  .object({
    phase: z.literal("mid"),
    turn_window: TurnWindowSchema,
    pivot_in: RosterId,
    pivot_out: RosterId.nullable(),
    rationale: z.string().max(300),
    key_calcs: z.array(CalcResultRefSchema).min(0).max(2),
    trigger: z.string().max(200),
  })
  .strict();

/** Late phase — turn 4+. One cleaner + win condition. */
export const LatePhaseSchema = z
  .object({
    phase: z.literal("late"),
    turn_window: TurnWindowSchema,
    cleaner: RosterId,
    rationale: z.string().max(300),
    key_calcs: z.array(CalcResultRefSchema).min(0).max(2),
    win_condition: z.string().max(200),
  })
  .strict();

/** Discriminated union — exported for type guards. Production code uses
 *  the strongly-typed 3-tuple inside {@link TeamPlanScenarioSchema}. */
export const PhaseSchema = z.discriminatedUnion("phase", [
  LeadPhaseSchema,
  MidPhaseSchema,
  LatePhaseSchema,
]);

/** Per-scenario 3-phase plan. Replaces the Stage-A `ScenarioSkeleton`
 *  shape inside {@link TeamTacticalOverviewSchema} per Q8 binding. */
export const TeamPlanScenarioSchema = z
  .object({
    name: z.string().min(1),
    type: ScenarioTypeSchema,
    field: ScenarioFieldSchema,
    opposing_preview: z.array(RosterId).min(1).max(6),
    description: z.string().max(800).optional(),
    phases: z.tuple([LeadPhaseSchema, MidPhaseSchema, LatePhaseSchema]),
    plan_score: z.number(),
    citations: z.array(TacticalCitationSchema).min(0).max(3),
    confidence: z.enum(["low", "medium", "high"]).optional(),
  })
  .strict();

/** End-to-end output of `buildOverview`. Stage A bumped 1 → 2; Stage B
 *  will bump 2 → 3 once the Stage-5 green commit reshapes the scenarios
 *  array to `TeamPlanScenario[]`. Stage 4 keeps the union to let Stage A
 *  production code remain green while the new tests target version 3. */
export const TeamTacticalOverviewSchema = z
  .object({
    schema_version: z.literal(3),
    team_id: z.string(),
    generated_at: ISODateTime,
    threat_panel_as_of: ISODate,
    pillars: PillarBundleSchema,
    scenarios: z.array(TeamPlanScenarioSchema).min(5).max(10),
  })
  .strict();

// Agent-tool I/O

export const ScorePillarsInputSchema = z
  .object({
    team_id: z.string(),
  })
  .strict();

export const ScorePillarsOutputSchema = z
  .object({
    team_id: z.string(),
    pillars: PillarBundleSchema,
    threat_panel_as_of: ISODate,
  })
  .strict();

/** Input to the `recommend_team_plan` Anthropic tool (replaces
 *  `recommend_leads` per Q8). */
export const RecommendTeamPlanInputSchema = z
  .object({
    team_id: z.string(),
    scenario_name: z.string().optional(),
  })
  .strict();

export const RecommendTeamPlanOutputSchema = z
  .object({
    team_id: z.string(),
    scenarios: z.array(TeamPlanScenarioSchema).min(1),
  })
  .strict();

export type TierLabel = z.infer<typeof TierLabelSchema>;
export type ScenarioField = z.infer<typeof ScenarioFieldSchema>;
export type ThreatEntry = z.infer<typeof ThreatEntrySchema>;
export type ThreatPanel = z.infer<typeof ThreatPanelSchema>;
export type ThreatHit = z.infer<typeof ThreatHitSchema>;
export type PillarScore = z.infer<typeof PillarScoreSchema>;
export type PillarBundle = z.infer<typeof PillarBundleSchema>;
export type ScenarioType = z.infer<typeof ScenarioTypeSchema>;
export type TacticalCitation = z.infer<typeof TacticalCitationSchema>;
export type CalcResultRef = z.infer<typeof CalcResultRefSchema>;
export type LeadPhase = z.infer<typeof LeadPhaseSchema>;
export type MidPhase = z.infer<typeof MidPhaseSchema>;
export type LatePhase = z.infer<typeof LatePhaseSchema>;
export type Phase = z.infer<typeof PhaseSchema>;
export type TeamPlanScenario = z.infer<typeof TeamPlanScenarioSchema>;
export type TeamTacticalOverview = z.infer<typeof TeamTacticalOverviewSchema>;
export type ScorePillarsInput = z.infer<typeof ScorePillarsInputSchema>;
export type ScorePillarsOutput = z.infer<typeof ScorePillarsOutputSchema>;
export type RecommendTeamPlanInput = z.infer<typeof RecommendTeamPlanInputSchema>;
export type RecommendTeamPlanOutput = z.infer<typeof RecommendTeamPlanOutputSchema>;
