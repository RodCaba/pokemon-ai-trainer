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
    pillar: z.enum(["offense", "defense", "speed", "synergy"]),
    score: z.number().int().min(0).max(100),
    tier: TierLabelSchema,
    evidence: z.record(z.unknown()),
  })
  .strict();

/** Bundle of all four pillar scores for a team. */
export const PillarBundleSchema = z
  .object({
    offense: PillarScoreSchema,
    defense: PillarScoreSchema,
    speed: PillarScoreSchema,
    synergy: PillarScoreSchema,
  })
  .strict();

/** Discriminator for ScenarioOverview kind.
 *  - `archetype`: Sun / Rain / Sand / Snow / Trick Room / Perish Trap
 *  - `individual`: top-usage threat by species
 *  - `weakness_counter`: auto-generated for structural team weakness
 *  - `meta_team`: top-frequency 6-species tournament team composition */
export const ScenarioTypeSchema = z.enum([
  "archetype",
  "individual",
  "weakness_counter",
  "meta_team",
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

/** Per-scenario overview: leads / back / rejected / reasoning / calcs / cites. */
export const ScenarioOverviewSchema = z
  .object({
    name: z.string().min(1),
    type: ScenarioTypeSchema,
    field: ScenarioFieldSchema,
    opposing_preview: z.array(RosterId).min(1).max(6),
    recommended_leads: z.tuple([RosterId, RosterId]),
    recommended_backline: z.tuple([RosterId, RosterId]),
    rejected_bench: z.tuple([RosterId, RosterId]),
    /** 1–2 paragraph natural-language description of what the scenario
     *  tests, why it matters in Reg M-A, and the high-level shape of the
     *  recommended response. Authored at orchestration time from the
     *  scenario field + opposing preview + pillar context. */
    description: z.string().max(800).optional(),
    reasoning: z.string().max(400),
    key_calcs: z.array(CalcResultRefSchema).min(0).max(3),
    citations: z.array(TacticalCitationSchema).min(0).max(3),
    pair_score: z.number(),
    /** Confidence signal for the agent loop (Stage 8). When `"low"`, the
     *  agent SHOULD chain a web_search before quoting the recommendation
     *  to the user. `"medium"` is the default. `"high"` indicates strong
     *  citation backing AND a clear pair_score margin over alternatives. */
    confidence: z.enum(["low", "medium", "high"]).optional(),
  })
  .strict();

/** End-to-end output of `buildOverview`. */
export const TeamTacticalOverviewSchema = z
  .object({
    schema_version: z.literal(1),
    team_id: z.string(),
    generated_at: ISODateTime,
    threat_panel_as_of: ISODate,
    pillars: PillarBundleSchema,
    scenarios: z.array(ScenarioOverviewSchema).min(5).max(10),
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

export const RecommendLeadsInputSchema = z
  .object({
    team_id: z.string(),
    scenario_name: z.string().optional(),
  })
  .strict();

export const RecommendLeadsOutputSchema = z
  .object({
    team_id: z.string(),
    scenarios: z.array(ScenarioOverviewSchema).min(1),
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
export type ScenarioOverview = z.infer<typeof ScenarioOverviewSchema>;
export type TeamTacticalOverview = z.infer<typeof TeamTacticalOverviewSchema>;
export type ScorePillarsInput = z.infer<typeof ScorePillarsInputSchema>;
export type ScorePillarsOutput = z.infer<typeof ScorePillarsOutputSchema>;
export type RecommendLeadsInput = z.infer<typeof RecommendLeadsInputSchema>;
export type RecommendLeadsOutput = z.infer<typeof RecommendLeadsOutputSchema>;
