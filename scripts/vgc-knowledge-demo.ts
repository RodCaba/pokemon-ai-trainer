/**
 * Operator-facing demo: runs 4-5 hardcoded conceptual queries against the
 * populated knowledge_chunks DB, pretty-prints top-3 hits per query with
 * article title, section, and a 2-line snippet. Mirrors `scripts/pikalytics-demo.ts`.
 *
 * Stage 4 stub: throws `not implemented (Stage 5)`.
 *
 * Run: `tsx scripts/vgc-knowledge-demo.ts`
 */

/**
 * Demo entry point.
 *
 * @returns Process exit code.
 */
export async function main(): Promise<number> {
  throw new Error("not implemented (Stage 5)");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error(e);
      process.exit(1);
    },
  );
}
