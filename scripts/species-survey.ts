/**
 * Survey species names appearing in real Reg M-A pokepastes vs. the roster.
 * Fetches top-cut teams (placement <= 8 or null-and-record-good) from the
 * last 14 days, pulls each pokepaste, parses species, and reports unknowns.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Teams } from "@pkmn/sets";
import { open } from "/Users/rodrigo/src/pokemon-ai-trainer/src/db/open";
import { createLabmausClient } from "/Users/rodrigo/src/pokemon-ai-trainer/src/tools/labmaus/client";
import { listTournaments } from "/Users/rodrigo/src/pokemon-ai-trainer/src/tools/labmaus/list-tournaments";
import { createPokepasteClient } from "/Users/rodrigo/src/pokemon-ai-trainer/src/tools/pokepaste/client";
import * as roster from "/Users/rodrigo/src/pokemon-ai-trainer/src/db/roster";
import { normalizeSpeciesName } from "/Users/rodrigo/src/pokemon-ai-trainer/src/tools/pokepaste/transform";

interface RawTopTeam {
  placement: number | null;
  team_url: string;
  team_names: string;
}
interface RawTournament {
  overview: { id: number; name: string };
  teams: RawTopTeam[];
}

async function main(): Promise<void> {
  const db = open("data/reg-m-a/db.sqlite");
  const labmaus = createLabmausClient({
    cacheDir: "data/cache/labmaus",
    cacheTtlMs: 24 * 60 * 60 * 1000,
    throttleRps: 100,
    maxRetries: 3,
    backoffBaseMs: 1000,
  });
  const pokepaste = createPokepasteClient({
    cacheDir: "data/cache/pokepaste",
    throttleRps: 100,
    maxRetries: 3,
    backoffBaseMs: 1000,
  });

  const summaries = await listTournaments(
    { regulation: "RegM-A", date_range: { from: "2026-04-22", to: "2026-05-05" } },
    { client: labmaus },
  );
  console.log(`Tournaments in window: ${summaries.length}`);

  const teamUrls: string[] = [];
  let i = 0;
  for (const s of summaries) {
    process.stderr.write(`\rFetching tournament details ${++i}/${summaries.length} `);
    let raw: RawTournament;
    try {
      raw = (await labmaus.getTournament({ id: s.id })) as RawTournament;
    } catch (e) {
      console.error(`\nfailed at tournament ${s.id}:`, e);
      throw e;
    }
    if (!raw || !Array.isArray(raw.teams)) {
      console.error(`\ntournament ${s.id} has no teams array; raw=`, JSON.stringify(raw).slice(0, 200));
      continue;
    }
    for (const t of raw.teams) {
      if (t.placement !== null && t.placement <= 8) teamUrls.push(t.team_url);
    }
  }
  process.stderr.write(`\n`);
  const unique = [...new Set(teamUrls)];
  console.log(`Top-cut team_urls collected: ${teamUrls.length} (unique: ${unique.length})`);

  const speciesCounts = new Map<string, number>();
  let teamsParsed = 0;
  let teamsFailed = 0;
  i = 0;
  for (const url of unique) {
    process.stderr.write(`\rFetching pastes ${++i}/${unique.length}`);
    const m = /pokepast\.es\/([a-f0-9]{12,32})/i.exec(url);
    if (!m) continue;
    try {
      const raw = await pokepaste.fetchRaw(m[1]);
      const team = Teams.importTeam(raw);
      if (team === null) {
        if (teamsFailed < 3) console.error(`\nimportTeam null for ${m[1]}; raw head:\n${raw.slice(0, 200)}`);
        teamsFailed++; continue;
      }
      const sets = (team as unknown as { team?: unknown[] }).team ?? team;
      const arr = Array.isArray(sets) ? sets : Array.from(sets as Iterable<unknown>);
      for (const set of arr) {
        const s = set as { species?: string; name?: string };
        const species = s.species ?? s.name ?? "?";
        speciesCounts.set(species, (speciesCounts.get(species) ?? 0) + 1);
      }
      teamsParsed++;
    } catch (e) {
      if (teamsFailed < 3) console.error(`\nfetch/parse failed for ${m[1]}:`, e);
      teamsFailed++;
    }
  }
  process.stderr.write(`\n`);
  console.log(`\nTeams parsed: ${teamsParsed}, failed: ${teamsFailed}`);
  console.log(`Unique species names seen: ${speciesCounts.size}\n`);

  // Bucket each species into hits / misses against the roster.
  const hits: Array<{ species: string; count: number; rosterId: string }> = [];
  const misses: Array<{ species: string; count: number; normalizedTried: string }> = [];
  for (const [species, count] of speciesCounts) {
    const normalized = normalizeSpeciesName(species);
    const got = roster.get(db, normalized, "RegM-A");
    if (got !== null) hits.push({ species, count, rosterId: got.id });
    else misses.push({ species, count, normalizedTried: normalized });
  }
  hits.sort((a, b) => b.count - a.count);
  misses.sort((a, b) => b.count - a.count);

  console.log(`=== HITS (${hits.length}) — top 20 ===`);
  for (const h of hits.slice(0, 20)) {
    console.log(`  ${h.count.toString().padStart(4)}× ${h.species.padEnd(30)} → ${h.rosterId}`);
  }
  console.log(`\n=== MISSES (${misses.length}) — full list ===`);
  for (const m of misses) {
    console.log(`  ${m.count.toString().padStart(4)}× ${m.species.padEnd(30)} (tried: ${m.normalizedTried})`);
  }
  db.$client.close();
}

main().catch((e) => { console.error("SURVEY FAILED:", e); process.exit(1); });
