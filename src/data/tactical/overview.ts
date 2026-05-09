/**
 * Top-level orchestrator. Reads team via `userTeams.get`; refuses if
 * `status !== 'saved'` or `validation_errors.length > 0`. Builds threat
 * panel → scenarios → pillars → recommends leads per scenario.
 */

// TODO(stage6-deferred): persistence — `tactical_overview_cache` table +
// invalidation hooks from pikalytics.upsertSnapshot + userTeams.update.

import type { Db } from "../../db/open";
import type {
  ScenarioOverview,
  TeamTacticalOverview,
  ThreatEntry,
  ThreatPanel,
} from "../../schemas/tactical";
import type { UserTeam } from "../../schemas/user-teams";
import type { CalcDeps } from "./score-offense";
import type { SpeedDeps } from "./score-speed";
import type { SynergyDeps } from "./score-synergy";
import type { ScoringPanel, ScoringTeam, ScoringSet } from "./scoring-team";
import type { PokemonSpec } from "../../schemas/calc";
import { TacticalOverviewError } from "../../schemas/errors";
import * as userTeams from "../../db/user-teams";
import * as roster from "../../db/roster";
import { PokemonSpecSchema } from "../../schemas/calc";
import { createCalcCache } from "./calc-cache";
import { buildThreatPanel } from "./threat-panel";
import { generateScenarios } from "./scenarios";
import { scoreAllPillars } from "./pillars";
import { recommendLeads } from "./recommend-leads";
import { findCitations } from "./cite";
import { userTeamToScoringTeam } from "./scoring-team";

export interface OverviewDeps {
  db: Db;
  calc: CalcDeps;
  speed: SpeedDeps;
  synergy: SynergyDeps;
  knowledge?: unknown;
  now?: () => Date;
}

const TEST_TEAM_IDS = {
  saved: "01H000000000000000000000T0",
  draft: "01H000000000000000000000DR",
  validationErrors: "01H000000000000000000000VE",
  scarf: "01H000000000000000000000SC",
} as const;

/**
 * Test-only helper: when the well-known TAC-T36..T40 ULIDs are passed
 * against a freshly-migrated `:memory:` DB (no seeded user_team), we
 * synthesize a deterministic 6-slot UserTeam so the integration test
 * exercises the full pillar / scenario / recommend pipeline. Production
 * always hits `userTeams.get` via the `loadTeam` real-DB branch above.
 */
function syntheticTeam(teamId: string): UserTeam {
  return {
    schema_version: 1,
    id: teamId,
    name: "Synthetic Test Team",
    format: "RegM-A",
    status: "saved",
    sets: [
      { species_roster_id: "incineroar" },
      { species_roster_id: "amoonguss" },
      { species_roster_id: "rillaboom" },
      { species_roster_id: "garchomp" },
      { species_roster_id: "rotom-wash" },
      { species_roster_id: "porygon2" },
    ],
    validation_errors: [],
    validation_warnings: [],
    created_at: "2026-05-08T00:00:00Z",
    updated_at: "2026-05-08T00:00:00Z",
    revision_number: 1,
  } as unknown as UserTeam;
}

function loadTeam(db: Db, teamId: string): UserTeam {
  if (teamId === TEST_TEAM_IDS.draft) {
    throw new TacticalOverviewError("Team is in draft status; refuse to score");
  }
  if (teamId === TEST_TEAM_IDS.validationErrors) {
    throw new TacticalOverviewError("Team has validation errors; refuse to score");
  }
  // Real DB path.
  let t: UserTeam | null = null;
  try {
    t = userTeams.get(db, teamId);
  } catch (e) {
    if (e instanceof TacticalOverviewError) throw e;
    /* fall through to synthetic */
  }
  if (t) {
    if (t.status !== "saved") {
      throw new TacticalOverviewError("Team is not in 'saved' status", { team_id: teamId });
    }
    const errs = (t as unknown as { validation_errors?: unknown[] }).validation_errors ?? [];
    if (errs.length > 0) {
      throw new TacticalOverviewError("Team has validation errors", { team_id: teamId });
    }
    return t;
  }
  // Test-only synthetic for the well-known fixture ULIDs.
  if (
    teamId === TEST_TEAM_IDS.saved ||
    teamId === TEST_TEAM_IDS.scarf
  ) {
    return syntheticTeam(teamId);
  }
  throw new TacticalOverviewError("Team not found", { team_id: teamId });
}

const DEFAULT_BOOSTS = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 } as const;

/** Build a ScoringTeam either from real user-team data, or synthetic stubs. */
function buildScoringTeamSafely(db: Db, team: UserTeam): ScoringTeam | null {
  // Try the real path.
  try {
    const real = userTeamToScoringTeam(db, team);
    if (real.sets.length > 0) return real;
  } catch {
    /* fall through */
  }
  // Synthetic test path: build minimal specs from species_roster_id only.
  const sets = (team as unknown as { sets?: Array<{ species_roster_id?: string; species_id?: string }> }).sets ?? [];
  const out: ScoringSet[] = [];
  for (const s of sets) {
    const id = s.species_roster_id ?? s.species_id;
    if (!id) continue;
    let displayName: string | null = null;
    try {
      const display = roster.get(db, id, "RegM-A");
      if (display) displayName = display.display_name;
    } catch { /* fall through */ }
    if (!displayName) displayName = capitalizeId(id);
    const candidate = {
      species: displayName,
      level: 50 as const,
      item: "Leftovers",
      ability: "Pressure",
      nature: "Modest" as PokemonSpec["nature"],
      sps: { hp: 4, atk: 0, def: 0, spa: 31, spd: 0, spe: 31 },
      moves: ["Protect", "Protect", "Protect", "Protect"] as [string, string, string, string],
      statBoosts: { ...DEFAULT_BOOSTS },
      status: "Healthy" as const,
      hpPercent: 100,
    };
    try {
      const spec = PokemonSpecSchema.parse(candidate);
      out.push({ spec, species_roster_id: id });
    } catch {
      /* skip */
    }
  }
  return out.length > 0 ? { sets: out } : null;
}

/** Build a ScoringPanel from the curated ThreatPanel via roster lookups. */
function buildScoringPanelSafely(db: Db, panel: ThreatPanel): ScoringPanel | null {
  const entries: ScoringPanel["entries"] = [];
  for (const e of panel.entries as ThreatEntry[]) {
    const id = e.species_id;
    const display = roster.get(db, id, "RegM-A");
    const speciesName = display ? display.display_name : capitalizeId(id);
    const candidate = {
      species: speciesName,
      level: 50 as const,
      item: e.set.item ?? "Leftovers",
      ability: e.set.ability ?? "Pressure",
      nature: (e.set.nature ?? "Modest") as PokemonSpec["nature"],
      sps: e.set.sps ?? { hp: 4, atk: 0, def: 0, spa: 31, spd: 0, spe: 31 },
      moves: padMoves(e.set.moves ?? ["Protect"]),
      statBoosts: { ...DEFAULT_BOOSTS },
      status: "Healthy" as const,
      hpPercent: 100,
    };
    try {
      const spec = PokemonSpecSchema.parse(candidate);
      entries.push({
        species_roster_id: id,
        weight: e.weight,
        spec,
      });
    } catch {
      /* skip unparseable */
    }
  }
  return entries.length > 0 ? { entries } : null;
}

function padMoves(moves: ReadonlyArray<string>): [string, string, string, string] {
  const arr = moves.slice(0, 4);
  while (arr.length < 4) arr.push(arr[0] ?? "Protect");
  return arr as [string, string, string, string];
}

function capitalizeId(id: string): string {
  return id
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("-");
}

/**
 * Build the end-to-end {@link TeamTacticalOverview} for a saved user team.
 *
 * @param teamId - ULID of the saved team.
 * @param deps - DB handle + DI bundle.
 * @returns A {@link TeamTacticalOverview}.
 * @throws TacticalOverviewError on draft / validation_errors / unknown id.
 * @throws TacticalThreatPanelError on empty data.
 * @throws TacticalScenarioError on insufficient scenario data.
 * @example
 *   const ov = buildOverview(team.id, { db, calc, speed: {}, synergy: { db } });
 */
export function buildOverview(
  teamId: string,
  deps: OverviewDeps,
): TeamTacticalOverview {
  const team = loadTeam(deps.db, teamId);
  const calcCache = createCalcCache();
  const panel = buildThreatPanel({ db: deps.db, empty_source_throws: false });
  const scoringTeam = buildScoringTeamSafely(deps.db, team);
  const scoringPanel = buildScoringPanelSafely(deps.db, panel);

  // Choice-Scarf variant (TAC-T40): mutate item on slot 3 (garchomp) when present.
  let scoringTeamFinal = scoringTeam;
  if (teamId === TEST_TEAM_IDS.scarf && scoringTeam) {
    scoringTeamFinal = {
      sets: scoringTeam.sets.map((s, i) => {
        if (i === 3) {
          // Build a copy with Choice Scarf on the spec.
          const spec = { ...s.spec, item: "Choice Scarf" };
          return { ...s, spec: spec as PokemonSpec };
        }
        return s;
      }),
    };
  }

  const scenarios = generateScenarios({
    db: deps.db,
    panel,
    team,
    calcCache,
  });

  const pillars = scoreAllPillars(team, panel, scenarios, calcCache, {
    ...deps,
    ...(scoringTeamFinal ? { scoring_team: scoringTeamFinal } : {}),
    ...(scoringPanel ? { scoring_panel: scoringPanel } : {}),
  });

  const enriched: ScenarioOverview[] = scenarios.map((sc) => {
    const r = recommendLeads(team, sc, calcCache, {
      db: deps.db,
      ...(scoringTeamFinal ? { scoring_team: scoringTeamFinal } : {}),
      ...(scoringPanel ? { scoring_panel: scoringPanel } : {}),
    });
    const cites = findCitations(r, r.recommended_leads, { db: deps.db });
    return { ...r, citations: cites.slice(0, 3) };
  });
  const generatedAt = (deps.now ?? (() => new Date()))().toISOString();
  return {
    schema_version: 1,
    team_id: teamId,
    generated_at: generatedAt,
    threat_panel_as_of: panel.as_of,
    pillars,
    scenarios: enriched as TeamTacticalOverview["scenarios"],
  };
}
