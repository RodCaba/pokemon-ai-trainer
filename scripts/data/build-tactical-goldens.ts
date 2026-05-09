/**
 * Regenerates `fixtures/tactical/*.json` golden files for the pillar
 * tests. Per memory `test_fixtures_no_invariant_blobs.md`: this
 * generator is committed alongside its outputs so the fixtures are
 * reproducible.
 *
 * Stage-4 stub.
 */

export async function main(_argv: string[]): Promise<number> {
  throw new Error("not implemented (Stage 5)");
}

if (
  typeof process !== "undefined" &&
  process.argv[1] &&
  /scripts\/data\/build-tactical-goldens\.ts$/.test(process.argv[1])
) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}
