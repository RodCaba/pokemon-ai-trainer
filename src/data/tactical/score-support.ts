/**
 * Support pillar scorer (plan §3.2 + §5).
 *
 * Per-mechanism distinct-tag aggregation across the team:
 *   support_score = clamp(
 *     20*screen_setter + 20*speed_control_setter + 20*weather_setter
 *   + 15*redirect + 12*cleric + 10*disruptor + 8*pivot + 10*anti_priority
 *   + role_coherence_bonus(0|+15)
 *   , 0, 100)
 *
 * `distinct mechanism` (Q3 binding): count once per unique sub-tag PER TEAM.
 * Two screen-setters still credit +20, not +40.
 *
 * `role_coherence_bonus = +15` iff (a) ≥1 setter sub-tag present AND
 * (b) ≥1 payoff (`setup_sweeper` OR `cleaner`) present (Q12 (a)+(b) only).
 *
 * Tier labels: 0–40 Weak / 41–60 OK / 61–80 Good / 81–100 Strong.
 */

import type {
  PillarScore,
  RoleTag,
  RoleTagAssignment,
  SupportPillarEvidence,
} from "../../schemas/tactical";

const SETTER_TAGS = new Set<RoleTag>([
  "screen_setter",
  "speed_control_setter",
  "weather_setter",
]);

const PAYOFF_TAGS = new Set<RoleTag>(["setup_sweeper", "cleaner"]);

const PER_MECHANISM_WEIGHT: Partial<Record<RoleTag, number>> = {
  screen_setter: 20,
  speed_control_setter: 20,
  weather_setter: 20,
  redirect: 15,
  cleric: 12,
  disruptor: 10,
  pivot: 8,
  anti_priority: 10,
};

const COHERENCE_BONUS = 15;

function tierFor(score: number): "Weak" | "OK" | "Good" | "Strong" {
  if (score <= 40) return "Weak";
  if (score <= 60) return "OK";
  if (score <= 80) return "Good";
  return "Strong";
}

/**
 * Compute the support pillar score from a precomputed role-assignments map.
 *
 * **When to use it:** call once per overview from `pillars.ts` after
 * `deriveTeamRoleTags` runs across the saved team.
 *
 * @param roleAssignments - species_id → assignment map. Use an empty map
 *   for an unclassified team; result is `Weak / 0` with empty evidence.
 * @returns A 0–100 {@link PillarScore} with mechanism + coherence evidence.
 * @throws Never.
 *
 * @example
 *   const score = scoreSupport(deriveTeamRoleTags(inputs, deps));
 */
export function scoreSupport(
  roleAssignments: ReadonlyMap<string, RoleTagAssignment>,
): PillarScore {
  // Build mechanism-presence sets (per-tag → set of species ids that
  // carry it) so per-team distinct counting + evidence emission share
  // the same source of truth.
  const speciesByTag = new Map<RoleTag, string[]>();
  for (const [speciesId, assignment] of roleAssignments) {
    for (const t of assignment.all) {
      const arr = speciesByTag.get(t);
      if (arr) arr.push(speciesId);
      else speciesByTag.set(t, [speciesId]);
    }
  }

  // Per-mechanism contribution: weight × (1 if tag present anywhere on team).
  let total = 0;
  for (const [tag, weight] of Object.entries(PER_MECHANISM_WEIGHT) as Array<[
    RoleTag,
    number,
  ]>) {
    if (speciesByTag.has(tag)) total += weight;
  }

  // Coherence bonus.
  const setters: string[] = [];
  for (const t of SETTER_TAGS) {
    const arr = speciesByTag.get(t);
    if (arr) for (const s of arr) if (!setters.includes(s)) setters.push(s);
  }
  const payoffs: Array<{ id: string; role: RoleTag }> = [];
  for (const t of PAYOFF_TAGS) {
    const arr = speciesByTag.get(t);
    if (arr) for (const s of arr) payoffs.push({ id: s, role: t });
  }
  const role_coherence = setters.length > 0 && payoffs.length > 0;
  if (role_coherence) total += COHERENCE_BONUS;

  const score = Math.max(0, Math.min(100, total));

  // Coherence chain — Q4 binding: pick first setter / first payoff in
  // map iteration order. Map iteration is insertion-ordered which mirrors
  // the team-set order (slot 0 first). Deterministic given the input.
  const coherence_chain = role_coherence && setters[0] && payoffs[0]
    ? {
        setter: setters[0],
        payoff: payoffs[0].id,
        payoff_role: payoffs[0].role,
      }
    : null;

  // Materialize evidence. Map → plain object for the role_tags record.
  const role_tags_obj: Record<string, RoleTagAssignment> = {};
  for (const [k, v] of roleAssignments) role_tags_obj[k] = v;

  const mechanisms: SupportPillarEvidence["mechanisms"] = {
    screens: dedupe(speciesByTag.get("screen_setter")),
    weather_setters: dedupe(speciesByTag.get("weather_setter")),
    speed_control: dedupe(speciesByTag.get("speed_control_setter")),
    redirection: dedupe(speciesByTag.get("redirect")),
    healers: dedupe(speciesByTag.get("cleric")),
    disruption: dedupe(speciesByTag.get("disruptor")),
    pivots: dedupe(speciesByTag.get("pivot")),
    anti_priority: dedupe(speciesByTag.get("anti_priority")),
  };

  const evidence: SupportPillarEvidence = {
    role_tags: role_tags_obj,
    mechanisms,
    role_coherence,
    coherence_chain,
  };

  return {
    pillar: "support",
    score,
    tier: tierFor(score),
    evidence,
  };
}

function dedupe(arr: readonly string[] | undefined): string[] {
  if (!arr) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of arr) if (!seen.has(s)) { seen.add(s); out.push(s); }
  return out;
}
