/**
 * Day-to-day Reg M-A questions answered against the local DB. Mirrors the
 * shape of conversations the agent will eventually have with the player.
 * No live network — everything reads from the snapshots ingested by
 * `pnpm data:ingest:pikalytics`.
 */
import { open } from "../src/db/open";
import * as pikalytics from "../src/db/pikalytics";
import * as tournaments from "../src/db/tournaments";
import * as setsRepo from "../src/db/sets";

function pct(n: number): string { return `${n.toFixed(1)}%`; }

const db = open("data/reg-m-a/db.sqlite");
try {
  // ─────────────────────────────────────────────────────────────────────
  console.log(`\n━━━ Q1. "What pairs well with Sneasler?" ━━━\n`);
  // ─────────────────────────────────────────────────────────────────────
  const sneaslerMates = pikalytics.teammates(db, { format: "RegM-A", species: "sneasler", limit: 6 });
  const sneaslerSnap = pikalytics.get(db, { species_roster_id: "sneasler" });
  console.log(`Top Pikalytics teammates (Reg M-A, ladder data, as_of ${sneaslerSnap?.as_of}):`);
  for (const t of sneaslerMates) console.log(`  ${pct(t.percent).padStart(7)}  ${t.roster_id}`);

  // ─────────────────────────────────────────────────────────────────────
  console.log(`\n━━━ Q2. "What item should I run on Garchomp?" ━━━\n`);
  // ─────────────────────────────────────────────────────────────────────
  const garchompSnap = pikalytics.get(db, { species_roster_id: "garchomp" });
  if (garchompSnap) {
    console.log(`Pikalytics item distribution (Reg M-A, as_of ${garchompSnap.as_of}):`);
    for (const i of garchompSnap.items.slice(0, 5))
      console.log(`  ${pct(i.percent).padStart(7)}  ${i.name}`);

    // Cross-source: what items did real labmaus tournament Garchomps run?
    console.log(`\nLabmaus tournament item distribution (real placing teams):`);
    const labmausItemUsage = tournaments.usage(db, {
      format: "RegM-A",
      kind: "item",
      species_roster_id: "garchomp",
      lookback_days: 30,
    });
    if (labmausItemUsage.length === 0) {
      console.log(`  (no item rows yet — labmaus team_sets needs a re-ingest with the merged pokepaste)`);
    } else {
      for (const r of labmausItemUsage.slice(0, 5))
        console.log(`  ${pct(r.usage_percent).padStart(7)}  ${r.key}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  console.log(`\n━━━ Q3. "If I see Charizard-Mega-Y at preview, what's likely backing it?" ━━━\n`);
  // ─────────────────────────────────────────────────────────────────────
  const charYMates = pikalytics.teammates(db, { format: "RegM-A", species: "charizardmegay", limit: 6 });
  const charYSnap = pikalytics.get(db, { species_roster_id: "charizardmegay" });
  console.log(`Pikalytics teammates for Charizard-Mega-Y (as_of ${charYSnap?.as_of}):`);
  for (const t of charYMates) console.log(`  ${pct(t.percent).padStart(7)}  ${t.roster_id}`);
  console.log(`\nInterpretation: ${charYMates[0]?.percent.toFixed(0)}% of teams running Char-Y also run ${charYMates[0]?.roster_id} → that's the partner most worth preparing for.`);

  // ─────────────────────────────────────────────────────────────────────
  console.log(`\n━━━ Q4. "Cross-source consistency check on Sneasler+Kingambit" ━━━\n`);
  // ─────────────────────────────────────────────────────────────────────
  const sneaslerKingambit = sneaslerMates.find((t) => t.roster_id === "kingambit");
  const labmausPair = tournaments.teams_with(db, {
    species: ["sneasler", "kingambit"],
    format: "RegM-A",
    lookback_days: 30,
  });
  console.log(`Pikalytics (Showdown ladder): ${sneaslerKingambit ? pct(sneaslerKingambit.percent) : "n/a"} of Sneasler teams also run Kingambit.`);
  console.log(`Labmaus (real tournaments, last 30d): ${labmausPair.length} placing teams ran Sneasler+Kingambit (out of ${(() => {
    const all = tournaments.teams_with(db, { species: ["sneasler"], format: "RegM-A", lookback_days: 30 });
    return all.length;
  })()} Sneasler teams total).`);

  // ─────────────────────────────────────────────────────────────────────
  console.log(`\n━━━ Q5a. "What's the standard ability on Floette-Mega?" ━━━\n`);
  // ─────────────────────────────────────────────────────────────────────
  const floetteSnap = pikalytics.get(db, { species_roster_id: "floettemega" });
  if (floetteSnap) {
    console.log(`Abilities (Pikalytics, as_of ${floetteSnap.as_of}):`);
    for (const a of floetteSnap.abilities.slice(0, 5))
      console.log(`  ${pct(a.percent).padStart(7)}  ${a.name}`);
  }

  // ─────────────────────────────────────────────────────────────────────
  console.log(`\n━━━ Q5b. "What's the standard moveset on Floette-Mega?" ━━━\n`);
  // ─────────────────────────────────────────────────────────────────────
  if (floetteSnap) {
    console.log(`Moves (Pikalytics, as_of ${floetteSnap.as_of}):`);
    for (const m of floetteSnap.moves.slice(0, 6))
      console.log(`  ${pct(m.percent).padStart(7)}  ${m.name}`);
  }

  // ─────────────────────────────────────────────────────────────────────
  console.log(`\n━━━ Q6. "Show me the top-3 species teammate clusters" ━━━\n`);
  // ─────────────────────────────────────────────────────────────────────
  // Walk the species we ingested and report each one's #1 teammate.
  const ingested = ["sneasler", "kingambit", "garchomp", "charizardmegay", "floettemega", "basculegion", "aerodactyl", "incineroar"];
  console.log(`${"species".padEnd(18)} → #1 teammate (Pikalytics)`);
  for (const sp of ingested) {
    const top = pikalytics.teammates(db, { format: "RegM-A", species: sp, limit: 1 })[0];
    if (top) console.log(`  ${sp.padEnd(16)} → ${top.roster_id} (${pct(top.percent)})`);
  }
} finally {
  db.$client.close();
}
