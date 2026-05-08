/**
 * META-T17 — metavgc tag-subtype is a no-op (always null).
 * Stage 4: fails because `tagSubtype` throws "not implemented (Stage 5)".
 */

import { describe, expect, it } from "vitest";
import { tagSubtype } from "../../../src/tools/metavgc/tag-subtype";

describe("metavgc tagSubtype (META-T17)", () => {
  it("META-T17. returns null for every slug (no metavgc subtypes today)", () => {
    for (const slug of [
      "how-to-counter-incineroar-pokemon-champions",
      "regulation-m-a-leads-opening-pokemon-champions",
      "battling-example-foo",
      "totally-made-up",
    ]) {
      expect(tagSubtype(slug)).toBeNull();
    }
  });
});
