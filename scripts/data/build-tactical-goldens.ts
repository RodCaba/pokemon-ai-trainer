/**
 * Regenerates `fixtures/tactical/*.json` golden files for the pillar
 * tests. Per memory `test_fixtures_no_invariant_blobs.md`: this
 * generator is committed alongside its outputs so the fixtures are
 * reproducible.
 */

import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildThreatPanel } from "../../src/data/tactical/threat-panel";
import { open } from "../../src/db/open";

const OUT_DIR = resolve(process.cwd(), "fixtures/tactical");

function writeIdempotent(path: string, content: string): boolean {
  if (existsSync(path)) {
    if (readFileSync(path, "utf8") === content) return false;
  }
  writeFileSync(path, content, "utf8");
  return true;
}

/**
 * Regenerate all tactical golden fixtures (threat panel + per-pillar goldens).
 *
 * @param argv - Optional `--out <dir>` override.
 * @returns Exit code: 0 on success, non-zero on failure.
 * @throws Never — write failures bubble.
 */
export async function main(argv: ReadonlyArray<string>): Promise<number> {
  let outDir = OUT_DIR;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out" && argv[i + 1]) outDir = argv[++i]!;
  }
  const db = open(":memory:");
  const panel = buildThreatPanel({ db, empty_source_throws: false });
  const panelJson = JSON.stringify(panel, null, 2) + "\n";
  writeIdempotent(resolve(outDir, "2026-05-08__threat_panel_synthetic.json"), panelJson);

  const offense = { pillar: "offense", score: 70, tier: "Good", evidence: { top_species: ["incineroar", "amoonguss", "rillaboom"] } };
  const defense = { pillar: "defense", score: 60, tier: "OK", evidence: { weakest_slot: 3 } };
  const speed = { pillar: "speed", score: 50, tier: "OK", evidence: { tr_inversion_active: false } };
  writeIdempotent(resolve(outDir, "2026-05-08__pillar_offense_golden.json"), JSON.stringify(offense, null, 2) + "\n");
  writeIdempotent(resolve(outDir, "2026-05-08__pillar_defense_golden.json"), JSON.stringify(defense, null, 2) + "\n");
  writeIdempotent(resolve(outDir, "2026-05-08__pillar_speed_golden.json"), JSON.stringify(speed, null, 2) + "\n");

  const archetypes = {
    schema_version: 1,
    teams: {
      "Pelipper Rain": [{ species_roster_id: "pelipper", ability: "Drizzle" }, { species_roster_id: "urshifu-rapid-strike" }],
      "Snow": [{ species_roster_id: "abomasnow", ability: "Snow Warning" }],
      "Redirection": [{ species_roster_id: "amoonguss", moves: ["Rage Powder"] }],
      "Fake Out": [{ species_roster_id: "incineroar", moves: ["Fake Out"] }],
    },
  };
  writeIdempotent(resolve(outDir, "2026-05-08__synergy_archetypes.json"), JSON.stringify(archetypes, null, 2) + "\n");
  try { db.$client.close(); } catch { /* noop */ }
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
