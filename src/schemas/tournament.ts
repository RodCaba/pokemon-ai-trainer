import { z } from "zod";

/**
 * Zod schemas for the labmaus tournament domain.
 *
 * Both the **raw labmaus payload** shapes (`LabmausRawTournament`, `LabmausRawTeam`)
 * and the **persisted domain** shapes (`TournamentResult`, `TournamentTeam`,
 * `TournamentTeamSpecies`) live here, plus tool-input and repo-input arg shapes.
 *
 * Reg M-A invariant: any top-level key whose name contains `tera` (case-insensitive)
 * is stripped by the raw schema's `.transform`. Domain schemas are `.strict()` so
 * a slipped-through Tera field would fail validation.
 */

const ISODate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
// labmaus emits naive UTC ISO strings ("2026-05-04T19:32:11Z"). We accept either an
// offset or a 'Z' (zod's `.datetime()` accepts both with `offset: false`).
const ISODateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/);

// ---------------------------------------------------------------------------
// Raw labmaus payload schemas (defensive — `.passthrough()` absorbs additive
// upstream changes; the `.transform` strips Tera keys defense-in-depth).
// ---------------------------------------------------------------------------

/**
 * Raw shape of one entry in `tournament.teams[]` as returned by labmaus.
 *
 * **Note:** plan §3 specified `team_names: z.array(z.string()).length(6)` but the
 * live API returns a comma-separated string ("A,B,C,D,E,F"). We accept the string
 * and the `transform.ts` layer splits on `,`. Plan deviation flagged in
 * `fixtures/labmaus/README.md`.
 */
export const LabmausRawTeamSchema = z
  .object({
    id: z.number().int().nonnegative(),
    player: z.string(),
    country: z.string().length(2).nullable().optional().transform((v) => v ?? null),
    placement: z.number().int().positive().nullable().optional().transform((v) => v ?? null),
    record: z.string(),
    team: z.array(z.string()).length(6),
    team_names: z.string(), // comma-separated
    team_url: z.string().url(),
  })
  .passthrough();

/**
 * Raw shape of the full `/api/tournament` response, with Tera keys stripped.
 */
export const LabmausRawTournamentSchema = z
  .object({
    overview: z
      .object({
        id: z.number().int().positive(),
        tournament_code: z.string().min(1).nullable().optional().transform((v) => v ?? null),
        name: z.string().min(1),
        organizer: z.string().min(1).nullable().optional().transform((v) => v ?? null),
        source: z.string().min(1).nullable().optional().transform((v) => v ?? null),
        regulation: z.string(),
        division: z.enum(["Masters", "Seniors", "Juniors"]),
        status: z.enum(["official", "unofficial"]),
        date: ISODate,
        num_players: z.number().int().nonnegative(),
        num_phase_2: z
          .number()
          .int()
          .nonnegative()
          .nullable()
          .optional()
          .transform((v) => v ?? null),
      })
      .passthrough(),
    teams: z.array(LabmausRawTeamSchema),
    pokemon: z.array(z.unknown()).optional(),
    items: z.array(z.unknown()).optional(),
    moves: z.array(z.unknown()).optional(),
    compositions: z.array(z.unknown()).optional(),
  })
  .passthrough()
  .transform((raw): typeof raw => {
    // Defense-in-depth: drop ANY top-level key whose name contains "tera" (case-insensitive).
    // Reg M-A has no Terastallization; Tera fields must never propagate downstream.
    const out: Record<string, unknown> = { ...raw };
    for (const k of Object.keys(out)) {
      if (/tera/i.test(k)) delete out[k];
    }
    return out as typeof raw;
  });

// ---------------------------------------------------------------------------
// listTournaments summary
// ---------------------------------------------------------------------------

/**
 * One row from `/api/completed_tournaments`.
 */
export const TournamentSummarySchema = z
  .object({
    id: z.number().int().positive(),
    date: ISODate,
    name: z.string().min(1),
    regulation: z.string(),
    division: z.enum(["Masters", "Seniors", "Juniors"]),
    num_players: z.number().int().nonnegative(),
    status: z.enum(["official", "unofficial"]),
  })
  .strict();

// ---------------------------------------------------------------------------
// Persisted domain shapes
// ---------------------------------------------------------------------------

/**
 * Provenance carried on every `TournamentResult` record.
 */
export const TournamentSourceSchema = z
  .object({
    schema_version: z.literal(1),
    site: z.literal("labmaus"),
    site_source: z.string().min(1).nullable(),
    source_url: z.string().url(),
    fetched_at: ISODateTime,
  })
  .strict();

/**
 * One canonical tournament record.
 */
export const TournamentResultSchema = z
  .object({
    schema_version: z.literal(1),
    id: z.string().regex(/^labmaus:\d+$/),
    external_id: z.number().int().positive(),
    tournament_code: z.string().nullable(),
    name: z.string().min(1),
    organizer: z.string().nullable(),
    format: z.literal("RegM-A"),
    division: z.enum(["Masters", "Seniors", "Juniors"]),
    status: z.enum(["official", "unofficial"]),
    date: ISODate,
    num_players: z.number().int().nonnegative(),
    num_phase_2: z.number().int().nonnegative().nullable(),
    source: TournamentSourceSchema,
  })
  .strict();

/**
 * One team within a tournament (one (tournament, player) pair).
 */
export const TournamentTeamSchema = z
  .object({
    schema_version: z.literal(1),
    id: z.string().regex(/^labmaus:\d+:\d+$/),
    tournament_id: z.string().regex(/^labmaus:\d+$/),
    external_team_id: z.number().int().nonnegative(),
    player: z.string(),
    player_key: z.string(),
    country: z.string().length(2).nullable(),
    placement: z.number().int().positive().nullable(),
    record: z.string(),
    team_url: z.string().url(),
    fetched_at: ISODateTime,
  })
  .strict();

/**
 * One slot of one team's species composition.
 */
export const TournamentTeamSpeciesSchema = z
  .object({
    team_id: z.string().regex(/^labmaus:\d+:\d+$/),
    slot: z.number().int().min(0).max(5),
    labmaus_id: z.string().min(1),
    roster_id: z.string().regex(/^[a-z0-9-]+$/),
  })
  .strict();

/**
 * Aggregate output of `getTournament`: tournament + teams + flattened species rows.
 */
export const TournamentDetailSchema = z
  .object({
    tournament: TournamentResultSchema,
    teams: z.array(TournamentTeamSchema),
    species: z.array(TournamentTeamSpeciesSchema),
  })
  .strict();

// ---------------------------------------------------------------------------
// Repo input/output shapes
// ---------------------------------------------------------------------------

export const TournamentFilterSchema = z
  .object({
    format: z.literal("RegM-A"),
    date_from: ISODate.optional(),
    date_to: ISODate.optional(),
    division: z.enum(["Masters", "Seniors", "Juniors"]).optional(),
    status: z.enum(["official", "unofficial"]).optional(),
  })
  .strict();

export const TeamsWithArgsSchema = z
  .object({
    format: z.literal("RegM-A"),
    species: z.array(z.string().min(1)).min(1).max(6),
    lookback_days: z.number().int().positive().optional(),
    min_placement: z.number().int().positive().optional(),
  })
  .strict();

export const UsageArgsSchema = z
  .object({
    format: z.literal("RegM-A"),
    lookback_days: z.number().int().positive(),
    weight_by: z.enum(["appearances", "wins", "tournament_weight"]).default("appearances"),
    kind: z.enum(["species", "item", "move", "core"]).default("species"),
  })
  .strict();

export const UsageRowSchema = z
  .object({
    kind: z.enum(["species", "item", "move", "core"]),
    key: z.string(),
    display_label: z.string(),
    appearances: z.number().int().nonnegative(),
    total_teams: z.number().int().nonnegative(),
    usage_percent: z.number().min(0).max(100),
    citations: z.array(z.string()).default([]),
  })
  .strict();

// ---------------------------------------------------------------------------
// Tool-arg shapes
// ---------------------------------------------------------------------------

export const LabmausListArgsSchema = z
  .object({
    regulation: z.literal("RegM-A"),
    date_range: z.object({ from: ISODate, to: ISODate }).strict(),
    status: z.enum(["official", "unofficial"]).optional(),
    division: z.enum(["Masters", "Seniors", "Juniors"]).optional(),
  })
  .strict()
  .superRefine((args, ctx) => {
    if (args.date_range.from > args.date_range.to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["date_range"],
        message: "date_range.from must be <= date_range.to",
      });
    }
  });

export const LabmausGetArgsSchema = z
  .object({
    id: z.number().int().positive(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type LabmausRawTeam = z.infer<typeof LabmausRawTeamSchema>;
export type LabmausRawTournament = z.infer<typeof LabmausRawTournamentSchema>;
export type TournamentSummary = z.infer<typeof TournamentSummarySchema>;
export type TournamentSource = z.infer<typeof TournamentSourceSchema>;
export type TournamentResult = z.infer<typeof TournamentResultSchema>;
export type TournamentTeam = z.infer<typeof TournamentTeamSchema>;
export type TournamentTeamSpecies = z.infer<typeof TournamentTeamSpeciesSchema>;
export type TournamentDetail = z.infer<typeof TournamentDetailSchema>;
export type TournamentFilter = z.infer<typeof TournamentFilterSchema>;
export type TeamsWithArgs = z.infer<typeof TeamsWithArgsSchema>;
export type UsageArgs = z.infer<typeof UsageArgsSchema>;
export type UsageRow = z.infer<typeof UsageRowSchema>;
export type LabmausListArgs = z.infer<typeof LabmausListArgsSchema>;
export type LabmausGetArgs = z.infer<typeof LabmausGetArgsSchema>;
