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
import { createCalcCache } from "../../src/data/tactical/calc-cache";
import type { ThreatPanel } from "../../src/schemas/tactical";
import type { UserTeam } from "../../src/schemas/user-teams";

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

  // Speed + Synergy stubs remain neutral (Stage 5b deferred — see plan).
  const speed = {
    pillar: "speed",
    score: 50,
    tier: "OK",
    evidence: { tr_inversion_active: false },
  };
  const synergy = {
    pillar: "synergy",
    score: 55,
    tier: "OK",
    evidence: {
      archetypes: ["Weather", "Redirection", "Fake Out", "Good Stuff"],
      teammate_component_max: 60,
      archetype_component_max: 40,
    },
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
