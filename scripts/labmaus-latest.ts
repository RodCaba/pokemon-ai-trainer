/**
 * Query the local DB for the most recent ingested tournament + its winner.
 * Demonstrates the repo layer (no live API calls).
 */
import { open } from "../src/db/open";
import * as tournaments from "../src/db/tournaments";
import * as sets from "../src/db/sets";

const db = open("data/reg-m-a/db.sqlite");
try {
  const list = tournaments.list(db, { format: "RegM-A" });
  console.log(`Tournaments in DB: ${list.length}`);
  if (list.length === 0) { console.log("(none — run ingest-labmaus first)"); process.exit(0); }

  // tournaments.list() is documented as returning newest first; take the head.
  const latest = list[0];
  if (!latest) { process.exit(0); }
  console.log(`\n=== Most recent tournament ===`);
  console.log(`  id:          ${latest.id}`);
  console.log(`  name:        ${latest.name}`);
  console.log(`  organizer:   ${latest.organizer}`);
  console.log(`  date:        ${latest.date}`);
  console.log(`  division:    ${latest.division}`);
  console.log(`  num_players: ${latest.num_players}`);
  console.log(`  status:      ${latest.status}`);

  const detail = tournaments.detail(db, latest.id);
  if (!detail) { console.log("no detail"); process.exit(0); }

  const winner = detail.teams.find((t) => t.placement === 1);
  if (!winner) { console.log("\nno team with placement === 1"); process.exit(0); }

  console.log(`\n=== Winning team ===`);
  console.log(`  player:      ${winner.player}`);
  console.log(`  country:     ${winner.country ?? "(none)"}`);
  console.log(`  record:      ${winner.record}`);
  console.log(`  team_url:    ${winner.team_url}`);

  const winnerSets = sets.list(db, { tournament_team_id: winner.id });
  console.log(`\n=== Pokémon (with full sets from pokepaste) ===`);
  if (winnerSets.length === 0) {
    console.log("  (no team_sets — pokepaste may have rejected the team; falling back to labmaus species)");
    const winnerSpecies = detail.species.filter((s) => s.tournament_team_id === winner.id);
    for (const s of winnerSpecies.sort((a, b) => a.slot - b.slot)) {
      console.log(`    slot ${s.slot}: ${s.labmaus_id}`);
    }
  } else {
    for (const s of winnerSets.sort((a, b) => a.slot - b.slot)) {
      const moves = s.moves.length ? s.moves.join(", ") : "(none)";
      console.log(`  ${(s.species_roster_id).padEnd(20)} @ ${s.item ?? "(no item)"}`);
      console.log(`    Ability: ${s.ability ?? "(none)"} | Nature: ${s.nature ?? "(unspecified)"} | Completeness: ${s.completeness}`);
      console.log(`    Moves: ${moves}`);
    }
  }
} finally {
  db.$client.close();
}
