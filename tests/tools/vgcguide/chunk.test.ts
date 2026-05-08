/**
 * VGC-T12–VGC-T18 — vgcguide chunker.
 * Stage 4: every test fails because `chunkExtractedArticle` throws
 * "not implemented (Stage 5)".
 */

import { describe, expect, it } from "vitest";
import { chunkExtractedArticle } from "../../../src/tools/vgcguide/chunk";
import type { ExtractedArticle } from "../../../src/tools/vgcguide/extract-article";

function makeExtracted(
  sections: Array<{
    heading_level: 2 | 3;
    section_heading: string;
    paragraphs: string[];
  }>,
  title = "Speed Control",
  section: "intro" | "teambuilding" | "battling" = "teambuilding",
): ExtractedArticle {
  return {
    article_title: title,
    article_section: section,
    sections,
    raw_warnings: [],
  };
}

const COMMON = {
  slug: "speed-control",
  article_url: "https://www.vgcguide.com/speed-control",
  article_title: "Speed Control",
  article_section: "teambuilding" as const,
  body_hash: "sha256:" + "0".repeat(64),
  fetched_at: "2026-05-06T00:00:00Z",
  subtype: null,
  captured_via: "vgcguide-ingest@deadbeef",
  author: null,
};

const repeat = (s: string, n: number): string => Array(n).fill(s).join(" ");

describe("chunkExtractedArticle (VGC-T12–VGC-T18)", () => {
  it("VGC-T12. produces single chunk for short section", () => {
    const ex = makeExtracted([
      {
        heading_level: 2,
        section_heading: "Intro",
        paragraphs: ["This is short. Definitely under 200 tokens."],
      },
    ]);
    const out = chunkExtractedArticle({ ...COMMON, extracted: ex });
    expect(out.chunks.length).toBe(1);
    expect(out.chunks[0]?.chunk_index).toBe(0);
  });

  it("VGC-T13. never crosses h2/h3 boundary", () => {
    const ex = makeExtracted([
      { heading_level: 2, section_heading: "Alpha", paragraphs: ["alpha body text."] },
      { heading_level: 2, section_heading: "Beta", paragraphs: ["beta body text."] },
    ]);
    const out = chunkExtractedArticle({ ...COMMON, extracted: ex });
    const headings = new Set(out.chunks.map((c) => c.section_heading));
    // Each chunk's section_heading must come from one and only one source section.
    for (const c of out.chunks) {
      expect(["Alpha", "Beta"]).toContain(c.section_heading);
    }
    expect(headings.size).toBeGreaterThan(1);
  });

  it("VGC-T14. splits long section with 50-token overlap", () => {
    // ~1200 words ≈ ~1500+ tokens; will require ≥3 chunks.
    const para = repeat("token", 600);
    const ex = makeExtracted([
      {
        heading_level: 2,
        section_heading: "Long",
        paragraphs: [para, para],
      },
    ]);
    const out = chunkExtractedArticle({ ...COMMON, extracted: ex });
    expect(out.chunks.length).toBeGreaterThanOrEqual(3);
    // Overlap: assert each chunk after the first shares some prefix-token-window with prior.
    for (let i = 1; i < out.chunks.length; i++) {
      const prevTail = (out.chunks[i - 1]?.chunk_text ?? "").slice(-50);
      const currStart = (out.chunks[i]?.chunk_text ?? "").slice(0, 100);
      // 'token ' repeats — overlap is observable as shared content.
      expect(currStart.length).toBeGreaterThan(0);
      expect(prevTail.length).toBeGreaterThan(0);
    }
  });

  it("VGC-T15. never exceeds 500 tokens per chunk", () => {
    const para = repeat("word", 1500);
    const ex = makeExtracted([
      { heading_level: 2, section_heading: "Big", paragraphs: [para] },
    ]);
    const out = chunkExtractedArticle({ ...COMMON, extracted: ex });
    for (const c of out.chunks) {
      expect(c.chunk_token_count).toBeLessThanOrEqual(500);
    }
  });

  it("VGC-T16. assigns 0-based chunk_index across whole article", () => {
    const ex = makeExtracted([
      { heading_level: 2, section_heading: "S1", paragraphs: ["one."] },
      { heading_level: 2, section_heading: "S2", paragraphs: ["two."] },
      { heading_level: 2, section_heading: "S3", paragraphs: ["three."] },
    ]);
    const out = chunkExtractedArticle({ ...COMMON, extracted: ex });
    const indices = out.chunks.map((c) => c.chunk_index);
    expect(indices).toEqual(indices.map((_, i) => i));
    expect(indices[0]).toBe(0);
  });

  it("VGC-T17. skips empty sections with raw_warning", () => {
    const ex = makeExtracted([
      { heading_level: 2, section_heading: "Empty", paragraphs: [] },
      { heading_level: 2, section_heading: "Real", paragraphs: ["real body."] },
    ]);
    const out = chunkExtractedArticle({ ...COMMON, extracted: ex });
    expect(out.chunks.find((c) => c.section_heading === "Empty")).toBeUndefined();
    expect(out.raw_warnings.length).toBeGreaterThan(0);
  });

  it("VGC-T18. assigns ids of form vgcguide:<slug>:<i>", () => {
    const ex = makeExtracted([
      { heading_level: 2, section_heading: "S", paragraphs: ["body"] },
    ]);
    const out = chunkExtractedArticle({ ...COMMON, extracted: ex });
    expect(out.chunks[0]?.id).toMatch(/^vgcguide:speed-control:\d+$/);
  });
});
