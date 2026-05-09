/**
 * Regenerates `fixtures/speed/top50.json` from a synthetic seed list.
 * Per Stage-3 §16.2 (Q5 binding): each entry carries `nature_variants`
 * so Jolly vs Adamant Garchomp are tracked distinctly. Idempotent.
 */

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { SpeedTable } from "../../src/data/tactical/speed-table";

const BASE_SPECIES: ReadonlyArray<{
  species_id: string;
  base_spe: number;
  usage_pct: number;
  splits?: Array<{ nature: string; share: number; weighted_speed: number }>;
}> = [
  { species_id: "calyrex-shadow", base_spe: 150, usage_pct: 0.10, splits: [
    { nature: "Timid", share: 0.95, weighted_speed: 222 },
    { nature: "Modest", share: 0.05, weighted_speed: 182 },
  ]},
  { species_id: "garchomp", base_spe: 102, usage_pct: 0.10, splits: [
    { nature: "Jolly", share: 0.65, weighted_speed: 169 },
    { nature: "Adamant", share: 0.35, weighted_speed: 139 },
  ]},
  { species_id: "rillaboom", base_spe: 85, usage_pct: 0.10, splits: [
    { nature: "Adamant", share: 0.60, weighted_speed: 122 },
    { nature: "Jolly", share: 0.40, weighted_speed: 134 },
  ]},
  { species_id: "indeedee-f", base_spe: 85, usage_pct: 0.10, splits: [
    { nature: "Bold", share: 0.55, weighted_speed: 105 },
    { nature: "Calm", share: 0.45, weighted_speed: 105 },
  ]},
  { species_id: "incineroar", base_spe: 60, usage_pct: 0.10, splits: [
    { nature: "Careful", share: 0.7, weighted_speed: 91 },
    { nature: "Sassy", share: 0.3, weighted_speed: 83 },
  ]},
];

function buildEntries(): SpeedTable["entries"] {
  const entries: SpeedTable["entries"] = [];
  for (const s of BASE_SPECIES) {
    const variants = s.splits ?? [{ nature: "Modest", share: 1.0, weighted_speed: s.base_spe + 50 }];
    entries.push({
      species_id: s.species_id,
      base_spe: s.base_spe,
      usage_pct: s.usage_pct,
      nature_variants: variants,
      primary_weighted_speed: variants[0]!.weighted_speed,
    });
  }
  // Pad to 50 entries deterministically.
  for (let i = entries.length; i < 50; i++) {
    const id = `synthetic-${String(i).padStart(2, "0")}`;
    entries.push({
      species_id: id,
      base_spe: 50 + i,
      usage_pct: 0.001,
      nature_variants: [{ nature: "Hardy", share: 1.0, weighted_speed: 100 + i }],
      primary_weighted_speed: 100 + i,
    });
  }
  // Sort desc by primary_weighted_speed.
  entries.sort((a, b) => b.primary_weighted_speed - a.primary_weighted_speed);
  return entries;
}

function parseArgs(argv: ReadonlyArray<string>): { out: string } {
  const out = (() => {
    const idx = argv.indexOf("--out");
    if (idx >= 0 && argv[idx + 1]) return argv[idx + 1]!;
    return resolve(process.cwd(), "fixtures/speed/top50.json");
  })();
  return { out };
}

/**
 * CLI entry: regenerate the speed table.
 *
 * @param argv - Optional `--out <path>` override.
 * @returns Exit code: 0 on success.
 * @throws Never — write/read failures bubble naturally.
 */
export async function main(argv: ReadonlyArray<string>): Promise<number> {
  const { out } = parseArgs(argv);
  const table: SpeedTable = {
    schema_version: 1,
    as_of: "2026-05-08",
    entries: buildEntries(),
  };
  const json = JSON.stringify(table, null, 2) + "\n";
  if (existsSync(out)) {
    const existing = readFileSync(out, "utf8");
    if (existing === json) return 0;
  }
  writeFileSync(out, json, "utf8");
  return 0;
}

if (
  typeof process !== "undefined" &&
  process.argv[1] &&
  /scripts\/data\/build-speed-table\.ts$/.test(process.argv[1])
) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}
