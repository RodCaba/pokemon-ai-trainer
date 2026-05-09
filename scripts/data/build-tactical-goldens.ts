/**
 * Regenerates `fixtures/tactical/*.json` golden files for the pillar
 * tests by RUNNING the real `damage_calc` engine against committed
 * input fixtures (golden team + golden threat panel). Per memory
 * `test_fixtures_no_invariant_blobs.md`: this generator is committed
 * alongside its outputs so the fixtures are reproducible.
 *
 * Inputs:
 *   - fixtures/tactical/2026-05-08__golden-team.json
 *   - fixtures/tactical/2026-05-08__golden-panel.json
 *
 * Outputs:
 *   - fixtures/tactical/2026-05-08__pillar_offense_golden.json
 *   - fixtures/tactical/2026-05-08__pillar_defense_golden.json
 *   - fixtures/tactical/2026-05-08__pillar_speed_golden.json
 *   - fixtures/tactical/2026-05-08__pillar_synergy_golden.json
 */

import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  fixtureToScoringTeam,
  fixtureToScoringPanel,
  type FixtureSet,
} from "../../src/data/tactical/scoring-team";
import { scoreOffense } from "../../src/data/tactical/score-offense";
import { scoreDefense } from "../../src/data/tactical/score-defense";
import { scoreSpeed } from "../../src/data/tactical/score-speed";
import { scoreSynergy } from "../../src/data/tactical/score-synergy";
import { recommendLeads } from "../../src/data/tactical/recommend-leads";
import { createCalcCache } from "../../src/data/tactical/calc-cache";
import { loadSpeedTable } from "../../src/data/tactical/speed-table";
import type { ThreatPanel, ScenarioOverview } from "../../src/schemas/tactical";
import type { UserTeam } from "../../src/schemas/user-teams";
import { open } from "../../src/db/open";

const OUT_DIR = resolve(process.cwd(), "fixtures/tactical");

interface TeamFixture {
  schema_version: 1;
  name: string;
  as_of: string;
  sets: FixtureSet[];
}

interface PanelFixture {
  schema_version: 1;
  name: string;
  as_of: string;
  entries: Array<FixtureSet & { weight: number }>;
}

function writeIdempotent(path: string, content: string): boolean {
  if (existsSync(path)) {
    if (readFileSync(path, "utf8") === content) return false;
  }
  writeFileSync(path, content, "utf8");
  return true;
}

function loadTeamFixture(dir: string): TeamFixture {
  const p = resolve(dir, "2026-05-08__golden-team.json");
  return JSON.parse(readFileSync(p, "utf8")) as TeamFixture;
}

function loadPanelFixture(dir: string): PanelFixture {
  const p = resolve(dir, "2026-05-08__golden-panel.json");
  return JSON.parse(readFileSync(p, "utf8")) as PanelFixture;
}

/**
 * Regenerate all tactical golden fixtures by running real engine loops.
 *
 * @param argv - Optional `--out <dir>` override.
 * @returns Exit code: 0 on success, non-zero on failure.
 */
export async function main(argv: ReadonlyArray<string>): Promise<number> {
  let outDir = OUT_DIR;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out" && argv[i + 1]) outDir = argv[++i]!;
  }
  const teamFx = loadTeamFixture(outDir);
  const panelFx = loadPanelFixture(outDir);
  const team = fixtureToScoringTeam(teamFx.sets);
  const panel = fixtureToScoringPanel(panelFx.entries);

  const cache = createCalcCache();
  const userTeamStub = {} as UserTeam;
  const panelStub = {} as ThreatPanel;

  const offense = scoreOffense(userTeamStub, panelStub, cache, {
    scoring_team: team,
    scoring_panel: panel,
  });
  const defense = scoreDefense(userTeamStub, panelStub, cache, {
    scoring_team: team,
    scoring_panel: panel,
  });

  // Speed (Stage 5c — real impl).
  const speedTable = loadSpeedTable();
  const speed = scoreSpeed(userTeamStub, panelStub, [] as ScenarioOverview[], speedTable, {
    scoring_team: team,
    scoring_panel: panel,
  });
  // Synergy: needs a Db handle. Use an in-memory empty DB → teammate component
  // returns 0 (no pikalytics rows); archetype detection works on the team data.
  const memDb = open(":memory:");
  const synergy = scoreSynergy(userTeamStub, { db: memDb, scoring_team: team });
  try { memDb.$client.close(); } catch { /* noop */ }

  // Recommend-leads golden: top pair on a neutral scenario.
  const cache2 = createCalcCache();
  const neutralScenario: ScenarioOverview = {
    name: "neutral",
    type: "individual",
    field: {
      weather: "none", terrain: "none", trick_room: false,
      tailwind_ours: false, tailwind_theirs: false,
      light_screen: false, reflect: false, gravity: false,
    },
    opposing_preview: ["incineroar"],
    recommended_leads: ["a", "b"],
    recommended_backline: ["c", "d"],
    rejected_bench: ["e", "f"],
    reasoning: "",
    key_calcs: [],
    citations: [],
    pair_score: 0,
  };
  const recDb = open(":memory:");
  const recommended = recommendLeads(userTeamStub, neutralScenario, cache2, {
    db: recDb,
    scoring_team: team,
    scoring_panel: panel,
  });
  try { recDb.$client.close(); } catch { /* noop */ }
  const recommendGolden = {
    recommended_leads: recommended.recommended_leads,
    recommended_backline: recommended.recommended_backline,
    rejected_bench: recommended.rejected_bench,
    pair_score: recommended.pair_score,
  };

  writeIdempotent(
    resolve(outDir, "2026-05-08__pillar_offense_golden.json"),
    JSON.stringify(offense, null, 2) + "\n",
  );
  writeIdempotent(
    resolve(outDir, "2026-05-08__pillar_defense_golden.json"),
    JSON.stringify(defense, null, 2) + "\n",
  );
  writeIdempotent(
    resolve(outDir, "2026-05-08__pillar_speed_golden.json"),
    JSON.stringify(speed, null, 2) + "\n",
  );
  writeIdempotent(
    resolve(outDir, "2026-05-08__pillar_synergy_golden.json"),
    JSON.stringify(synergy, null, 2) + "\n",
  );
  writeIdempotent(
    resolve(outDir, "2026-05-08__recommend_golden.json"),
    JSON.stringify(recommendGolden, null, 2) + "\n",
  );

  // Synergy archetypes stay (legacy).
  const archetypes = {
    schema_version: 1,
    teams: {
      "Pelipper Rain": [
        { species_roster_id: "pelipper", ability: "Drizzle" },
        { species_roster_id: "urshifu-rapid-strike" },
      ],
      Snow: [{ species_roster_id: "abomasnow", ability: "Snow Warning" }],
      Redirection: [{ species_roster_id: "amoonguss", moves: ["Rage Powder"] }],
      "Fake Out": [{ species_roster_id: "incineroar", moves: ["Fake Out"] }],
    },
  };
  writeIdempotent(
    resolve(outDir, "2026-05-08__synergy_archetypes.json"),
    JSON.stringify(archetypes, null, 2) + "\n",
  );

  return 0;
}

if (
  typeof process !== "undefined" &&
  process.argv[1] &&
  /scripts\/data\/build-tactical-goldens\.ts$/.test(process.argv[1])
) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}
