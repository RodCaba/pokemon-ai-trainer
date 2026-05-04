import { createHash } from "node:crypto";
import { readFileSync, unlinkSync } from "node:fs";
import { open } from "../../src/db/open";
import { seedTinyDb as seedSchema } from "../../tests/data/fixtures";

// Build the same DB twice on disk and compare SHA-256.
function buildAndHash(path: string): string {
  try { unlinkSync(path); } catch {}
  const db = open(path);
  // Same seed function, same data → byte-identical output (we hope).
  // For the spike, we drop the in-memory open and re-seed onto the disk DB by copying
  // the seedTinyDb logic — but easier: open a fresh memory DB, then export to disk.
  db.$client.exec(`DETACH DATABASE main; ATTACH DATABASE '${path}' AS main;`);
  // Above doesn't quite work in better-sqlite3 — let's do it the simpler way:
  // open the disk DB directly and re-run the seed logic against it.
  db.$client.close();

  // Open the disk DB fresh and seed using the existing helper (it opens its own
  // in-memory DB, so we'll instead use db.$client.backup to clone).
  // Simplest path: we just need byte-equality of the schema-only DB on two runs.
  return sha256(path);
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

// Quick path: compare two empty (migrations-only) on-disk DBs.
const path1 = "/tmp/det-check-1.sqlite";
const path2 = "/tmp/det-check-2.sqlite";
try { unlinkSync(path1); } catch {}
try { unlinkSync(path2); } catch {}

const db1 = open(path1); db1.$client.close();
const db2 = open(path2); db2.$client.close();

const h1 = sha256(path1);
const h2 = sha256(path2);
console.log("DB1 sha256:", h1);
console.log("DB2 sha256:", h2);
console.log("byte-identical:", h1 === h2 ? "YES ✓" : "NO ✗");

// Cleanup
unlinkSync(path1);
unlinkSync(path2);

// Also seed two in-memory DBs and compare backed-up bytes.
const memA = seedSchema();
const memB = seedSchema();
memA.$client.backup("/tmp/det-mem-a.sqlite").then(() => {
  memB.$client.backup("/tmp/det-mem-b.sqlite").then(() => {
    const ha = sha256("/tmp/det-mem-a.sqlite");
    const hb = sha256("/tmp/det-mem-b.sqlite");
    console.log("\nSeeded DB A sha256:", ha);
    console.log("Seeded DB B sha256:", hb);
    console.log("byte-identical:", ha === hb ? "YES ✓" : "NO ✗");
    memA.$client.close();
    memB.$client.close();
    unlinkSync("/tmp/det-mem-a.sqlite");
    unlinkSync("/tmp/det-mem-b.sqlite");
  });
});

void buildAndHash;
