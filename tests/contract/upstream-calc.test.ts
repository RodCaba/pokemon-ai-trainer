import { describe, expect, it } from "vitest";

// Contract tests against live upstream sources.
//
// Skipped by default — they hit the network and would flake CI on transient
// outages. Run explicitly via `pnpm test:contract` (sets RUN_CONTRACT_TESTS=1)
// or schedule weekly in a separate pipeline.
//
// What they watch for:
//   1. A published `@smogon/calc` npm release that contains Champions support
//      → signal to switch from the GitHub pin (RodCaba fork) back to a stable
//      npm version.
//   2. SETDEX_CHAMPIONS (Smogon's curated sample sets) drifting against any
//      committed snapshot we have → signal to run `pnpm data:refresh:reg-m-a`.

const ENABLED = process.env.RUN_CONTRACT_TESTS === "1";
const NPM_REGISTRY = "https://registry.npmjs.org/@smogon/calc";
const SETDEX_URL = "https://calc.pokemonshowdown.com/js/data/sets/champions.js";
const PIN_PUBLISHED_AT = "2026-03-11T19:23:04.166Z"; // 0.11.0 (latest as of fork)

interface NpmRegistryDoc {
  "dist-tags": { latest: string };
  versions: Record<string, { version: string }>;
  time: Record<string, string>;
}

interface JsdelivrFlatEntry {
  name: string;
}
interface JsdelivrFlat {
  files: JsdelivrFlatEntry[];
}

async function fetchNpmDoc(): Promise<NpmRegistryDoc> {
  const r = await fetch(NPM_REGISTRY);
  if (!r.ok) throw new Error(`npm registry GET failed: ${r.status}`);
  return (await r.json()) as NpmRegistryDoc;
}

async function fetchJsdelivrFiles(version: string): Promise<string[]> {
  const r = await fetch(`https://data.jsdelivr.com/v1/package/npm/@smogon/calc@${version}/flat`);
  if (!r.ok) throw new Error(`jsdelivr flat GET failed for ${version}: ${r.status}`);
  const json = (await r.json()) as JsdelivrFlat;
  return json.files.map((f) => f.name);
}

describe.skipIf(!ENABLED)("upstream-calc — contract", () => {
  it("1. no published @smogon/calc release contains Champions yet (else: switch from GitHub pin)", async () => {
    const doc = await fetchNpmDoc();
    const pinDate = new Date(PIN_PUBLISHED_AT).getTime();
    const newer = Object.keys(doc.versions)
      .filter((v) => {
        const t = doc.time[v];
        return t !== undefined && new Date(t).getTime() > pinDate;
      })
      .sort();

    if (newer.length === 0) {
      // No newer versions — no action needed.
      expect(newer).toEqual([]);
      return;
    }

    // For each newer version, check whether `dist/mechanics/champions.js` is in the
    // tarball. If any does, the test fails with a switch-back instruction.
    const championsContainers: string[] = [];
    for (const version of newer) {
      const files = await fetchJsdelivrFiles(version).catch(() => [] as string[]);
      if (files.some((f) => f.endsWith("/dist/mechanics/champions.js"))) {
        championsContainers.push(version);
      }
    }

    if (championsContainers.length > 0) {
      expect.fail(
        `@smogon/calc has shipped Champions in published version(s): ${championsContainers.join(", ")}. ` +
          `Switch from the GitHub fork pin (package.json) to "@smogon/calc": "^${championsContainers[0]}".`,
      );
    } else {
      // Newer versions exist but none contain Champions — still pinned correctly.
      expect(championsContainers).toEqual([]);
    }
  }, 60_000);

  it("2. SETDEX_CHAMPIONS is fetchable and has the expected JS shape (snapshot baseline TBD)", async () => {
    // Until the SETDEX_CHAMPIONS ingest slice lands, we don't have a committed
    // snapshot to diff against. This test currently asserts only that upstream is
    // reachable and the file's structure matches what the future parser will
    // expect. Once the snapshot exists at `data/reg-m-a/raw-sets.smogon.json`,
    // upgrade this test to compare a SHA against the committed baseline.
    const r = await fetch(SETDEX_URL);
    expect(r.ok, `SETDEX_CHAMPIONS GET failed: ${r.status}`).toBe(true);
    const body = await r.text();
    expect(body.length).toBeGreaterThan(1000); // sanity: file is non-trivial
    // Upstream uses `var SETDEX_CHAMPIONS = { ... };` per the spike investigation.
    expect(body).toMatch(/SETDEX_CHAMPIONS\s*=/);
    // TODO(snapshot): once raw-sets.smogon.json is committed, assert
    //   sha1(body) === sha1(committed-snapshot) — fail with "run pnpm data:refresh:reg-m-a".
  }, 60_000);
});

describe.skipIf(ENABLED)("upstream-calc — contract (offline placeholder)", () => {
  it("contract tests are skipped offline; run `pnpm test:contract` to enable", () => {
    // This placeholder ensures the file isn't empty when reporters look at it
    // in offline mode, and gives the reader a clear pointer.
    expect(ENABLED).toBe(false);
  });
});
