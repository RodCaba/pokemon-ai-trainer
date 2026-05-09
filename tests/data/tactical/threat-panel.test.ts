/**
 * TAC-T7..T10 — buildThreatPanel curation. Stage-4 red.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  buildThreatPanel,
  type ThreatPanelDeps,
} from "../../../src/data/tactical/threat-panel";
import { TacticalThreatPanelError } from "../../../src/schemas/errors";
import { open, type Db } from "../../../src/db/open";

let opened: Db | null = null;
afterEach(() => {
  if (opened) {
    try {
      opened.$client.close();
    } catch {
      /* noop */
    }
    opened = null;
  }
});

function deps(db: Db, size = 15): ThreatPanelDeps {
  return { db, size };
}

describe("buildThreatPanel (TAC-T7..T10)", () => {
  it("TAC-T7. curates 15 entries; weights normalize to 1.0 ± 1e-9", () => {
    const db = open(":memory:");
    opened = db;
    const panel = buildThreatPanel(deps(db));
    expect(panel.entries.length).toBe(15);
    const total = panel.entries.reduce((s, e) => s + e.weight, 0);
    expect(Math.abs(total - 1.0)).toBeLessThan(1e-9);
  });

  it("TAC-T8. labmaus consensus fallback fires when species lacks pikalytics row", () => {
    const db = open(":memory:");
    opened = db;
    const panel = buildThreatPanel(deps(db));
    expect(
      panel.entries.some((e) => e.source.type === "labmaus_consensus"),
    ).toBe(true);
  });

  it("TAC-T9. deterministic given fixed snapshot — repeat calls byte-equal", () => {
    const db = open(":memory:");
    opened = db;
    const a = buildThreatPanel(deps(db));
    const b = buildThreatPanel(deps(db));
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it("TAC-T10. refuses with TacticalThreatPanelError when both sources empty", () => {
    const db = open(":memory:");
    opened = db;
    // Explicitly opt into the empty-source guard. In production this fires
    // when `pikalytics_snapshots` and `team_sets` are both empty for RegM-A;
    // the test pins the contract via `empty_source_throws=true` + seeded-empty.
    expect(() => buildThreatPanel({ db, size: 15, empty_source_throws: true, _force_empty: true } as never)).toThrow(
      TacticalThreatPanelError,
    );
  });
});
