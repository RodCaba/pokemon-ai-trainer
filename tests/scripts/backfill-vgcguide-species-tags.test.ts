/**
 * META-T49 — `scripts/data/backfill-vgcguide-species-tags.ts` orchestration.
 * Stage 4: fails because `main` throws "not implemented (Stage 5)" AND the
 * link table doesn't exist on the current schema.
 */

import { describe, expect, it } from "vitest";
import { open, type Db } from "../../src/db/open";
import { main } from "../../scripts/data/backfill-vgcguide-species-tags";

const DIM = 512;

function fakeVecBuf(seed: number): Buffer {
  const v = new Float32Array(DIM);
  for (let i = 0; i < DIM; i++) v[i] = ((seed * 31 + i) % 17) / 17;
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

function seedSpecies(db: Db): void {
  const insert = db.$client.prepare(
    `INSERT INTO species (id, display_name, form_id, is_mega, types, weight_kg, aliases, movepool, source_json)
     VALUES (?, ?, NULL, ?, '["Normal"]', 1.0, ?, '[]', '{}')`,
  );
  const stats = db.$client.prepare(
    `INSERT INTO species_stats (species_id, hp, atk, def, spa, spd, spe, bst)
     VALUES (?, 100, 100, 100, 100, 100, 100, 600)`,
  );
  const mem = db.$client.prepare(
    `INSERT INTO roster_membership (species_id, format, is_legal, is_mega, notes)
     VALUES (?, 'RegM-A', 1, ?, NULL)`,
  );
  const rows = [
    { id: "incineroar", display_name: "Incineroar", is_mega: 0, aliases: [] },
    { id: "garchomp", display_name: "Garchomp", is_mega: 0, aliases: [] },
    { id: "sneasler", display_name: "Sneasler", is_mega: 0, aliases: [] },
  ];
  for (const r of rows) {
    insert.run(r.id, r.display_name, r.is_mega, JSON.stringify(r.aliases));
    stats.run(r.id);
    mem.run(r.id, r.is_mega);
  }
}

function seedVgcguideChunks(db: Db): void {
  const fixtures = [
    {
      id: "vgcguide:typing:0",
      slug: "typing",
      text: "Incineroar's Dark/Fire typing punishes Psychic threats.",
    },
    {
      id: "vgcguide:speed-control:0",
      slug: "speed-control",
      text: "Garchomp out-speeds most of the meta after a Tailwind.",
    },
    {
      id: "vgcguide:predictions:0",
      slug: "predictions",
      text: "When predicting, consider speed, item, and ability lines.",
    },
  ];
  for (let i = 0; i < fixtures.length; i++) {
    const f = fixtures[i]!;
    const r = db.$client
      .prepare("INSERT INTO knowledge_chunk_embeddings (embedding) VALUES (?)")
      .run(fakeVecBuf(i));
    const rowid = Number(r.lastInsertRowid);
    db.$client
      .prepare(
        `INSERT INTO knowledge_chunks
          (id, source_site, article_slug, article_title, article_url,
           article_section, section_heading, chunk_index, chunk_text,
           chunk_token_count, subtype, body_hash, embedding_ref,
           fetched_at, author, captured_via)
         VALUES (?, 'vgcguide', ?, ?, ?, 'teambuilding', 'S', 0, ?, 10, NULL, ?, ?, '2026-05-08T00:00:00Z', NULL, 'ingest@dev')`,
      )
      .run(
        f.id,
        f.slug,
        f.slug,
        `https://www.vgcguide.com/${f.slug}`,
        f.text,
        "sha256:" + "0".repeat(64),
        `knowledge_chunk_embeddings:${rowid}`,
      );
  }
}

describe("backfill-vgcguide-species-tags (META-T49)", () => {
  it("META-T49. backfill produces expected link rows; second run is a no-op (idempotent)", async () => {
    const db = open(":memory:");
    try {
      seedSpecies(db);
      seedVgcguideChunks(db);

      const exit1 = await main([], { db });
      expect(exit1).toBe(0);

      const linksAfter1 = db.$client
        .prepare(
          "SELECT chunk_id, species_id FROM knowledge_chunk_species_tags ORDER BY chunk_id, species_id",
        )
        .all() as Array<{ chunk_id: string; species_id: string }>;
      const expected: Array<{ chunk_id: string; species_id: string }> = [
        { chunk_id: "vgcguide:speed-control:0", species_id: "garchomp" },
        { chunk_id: "vgcguide:typing:0", species_id: "incineroar" },
      ];
      expect(linksAfter1).toEqual(expected);

      // Second run: no growth, no duplicates.
      const exit2 = await main([], { db });
      expect(exit2).toBe(0);
      const linksAfter2 = db.$client
        .prepare(
          "SELECT chunk_id, species_id FROM knowledge_chunk_species_tags ORDER BY chunk_id, species_id",
        )
        .all() as Array<{ chunk_id: string; species_id: string }>;
      expect(linksAfter2).toEqual(linksAfter1);
    } finally {
      db.$client.close();
    }
  });
});
