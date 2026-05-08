/**
 * META-T16 — metavgc inferMetaVgcSection always returns "intro".
 * Stage 4: fails because the implementation throws "not implemented (Stage 5)".
 */

import { describe, expect, it } from "vitest";
import { inferMetaVgcSection } from "../../../src/tools/metavgc/section";

describe("inferMetaVgcSection (META-T16)", () => {
  it("META-T16. always returns 'intro' regardless of slug content", () => {
    for (const slug of [
      "how-to-counter-incineroar-pokemon-champions",
      "regulation-m-a-leads-opening-pokemon-champions",
      "anti-meta-underrated-megas-pokemon-champions-2026",
      "vgc-speed-control-tailwind-vs-trick-room",
      "totally-made-up",
      "",
    ]) {
      expect(inferMetaVgcSection(slug)).toBe("intro");
    }
  });
});
