import { writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";

// Fetcher for Smogon's `SETDEX_CHAMPIONS` (curated sample sets) at
// https://calc.pokemonshowdown.com/js/data/sets/champions.js. Output is committed
// to `data/reg-m-a/raw-sets.smogon.json` so the build pipeline reads from a
// snapshot (deterministic, offline, reviewable diffs).
//
// Run via `pnpm data:refresh:reg-m-a` when the upstream metagame patch lands
// (the contract test in `tests/contract/upstream-calc.test.ts` watches for drift).
//
// Security: the upstream is JS, not JSON. We extract the literal between
// `SETDEX_CHAMPIONS = ` and `};` and evaluate it via `Function(...)` in a
// freshly-created context. The threat model is upstream Smogon publishing
// malicious JS — acceptable for a manually-triggered dev-time refresh; not
// acceptable for runtime use.

const SETDEX_URL = "https://calc.pokemonshowdown.com/js/data/sets/champions.js";
const OUT_PATH = "data/reg-m-a/raw-sets.smogon.json";

interface SnapshotFile {
  source_url: string;
  fetched_at: string;
  sha256_of_body: string;
  setdex: Record<string, Record<string, unknown>>;
}

async function main(): Promise<void> {
  console.log(`fetching ${SETDEX_URL} ...`);
  const r = await fetch(SETDEX_URL);
  if (!r.ok) throw new Error(`fetch failed: ${r.status} ${r.statusText}`);
  const body = await r.text();
  console.log(`  body length: ${body.length} chars`);

  // The file looks like: `var SETDEX_CHAMPIONS = { ... };`.
  // We extract the object literal between `=` and the trailing `;` (or EOF).
  const match = body.match(/SETDEX_CHAMPIONS\s*=\s*(\{[\s\S]*\})\s*;?\s*$/);
  if (!match || !match[1]) {
    throw new Error("could not locate SETDEX_CHAMPIONS literal in upstream body");
  }
  const literal = match[1];

  // Evaluate the JS object literal. Using `Function` (not `eval`) — same trust
  // boundary, fewer side-effects on the surrounding scope.
  let setdex: Record<string, Record<string, unknown>>;
  try {
    setdex = new Function(`return (${literal});`)() as Record<string, Record<string, unknown>>;
  } catch (e) {
    throw new Error(`SETDEX_CHAMPIONS literal failed to evaluate: ${(e as Error).message}`);
  }

  const speciesCount = Object.keys(setdex).length;
  let setCount = 0;
  for (const sets of Object.values(setdex)) setCount += Object.keys(sets).length;
  console.log(`  parsed: ${speciesCount} species, ${setCount} sets`);

  const sha256 = await crypto.subtle
    .digest("SHA-256", new TextEncoder().encode(body))
    .then((buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join(""));

  const snapshot: SnapshotFile = {
    source_url: SETDEX_URL,
    fetched_at: new Date().toISOString(),
    sha256_of_body: sha256,
    setdex,
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`  wrote ${OUT_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
