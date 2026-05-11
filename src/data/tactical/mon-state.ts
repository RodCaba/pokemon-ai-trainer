/**
 * Stage D (per-mon-state-tracking) — small shared helpers for the
 * per-phase per-mon state resolver. Stage 4 scaffolds the symbols;
 * Stage 5 fills them in.
 */

export function clampHpPct(_n: number): number {
  throw new Error("stage 5 not yet implemented");
}

export function isSandImmune(_species_id: string, _ability: string | null): boolean {
  throw new Error("stage 5 not yet implemented");
}

export function isDbConfirmedMove(
  _opposingSpeciesId: string,
  _moveId: string,
  _panel: unknown,
  _db: unknown,
): boolean {
  throw new Error("stage 5 not yet implemented");
}
