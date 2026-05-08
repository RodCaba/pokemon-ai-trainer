/**
 * VGC-T19, VGC-T20 — vgcguide subtype tagger.
 * Stage 4: every test fails because `tagSubtype` throws "not implemented (Stage 5)".
 */

import { describe, expect, it } from "vitest";
import {
  BATTLE_REPLAY_SLUGS,
  tagSubtype,
} from "../../../src/tools/vgcguide/tag-subtype";

describe("tagSubtype (VGC-T19, VGC-T20)", () => {
  it("VGC-T19. returns 'battle-replay' for the 3 known slugs", () => {
    for (const slug of BATTLE_REPLAY_SLUGS) {
      expect(tagSubtype(slug)).toBe("battle-replay");
    }
  });

  it("VGC-T20. returns null for any other slug", () => {
    for (const slug of [
      "speed-control",
      "team-preview",
      "predictions",
      "what-is-pokemon-showdown",
      "totally-made-up",
    ]) {
      expect(tagSubtype(slug)).toBeNull();
    }
  });
});
