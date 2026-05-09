/**
 * Regenerates `fixtures/speed/top50.json` from `pikalytics_snapshots`
 * × `species_stats`. Idempotent. Per Stage-3 §16.2 (Q5 binding): each
 * entry carries `nature_variants` so Jolly vs Adamant Garchomp are
 * tracked distinctly.
 *
 * Stage-4 stub.
 */

export async function main(_argv: string[]): Promise<number> {
  throw new Error("not implemented (Stage 5)");
}

if (
  typeof process !== "undefined" &&
  process.argv[1] &&
  /scripts\/data\/build-speed-table\.ts$/.test(process.argv[1])
) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}
