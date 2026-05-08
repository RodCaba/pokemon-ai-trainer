/**
 * Zod schemas + inferred types for the `user-teams` slice domain.
 *
 * Pure-data module per CLAUDE.md §3 — landed as a single batch under the
 * pure-data exemption. Tests in `tests/schemas/user-teams.test.ts`
 * lock in the externally visible behavior (round-trips, Tera-strip
 * defense-in-depth, SPS caps, error/warning split).
 *
 * Reg M-A invariants per memory `regulation_m_a_no_tera.md` and
 * `regulation_m_a_stat_rules.md`: SPS total ≤ 66 / per-stat ≤ 32; no
 * `tera_*` field exists on any schema and `.strict()` rejects anything
 * that leaks through.
 */

import { z } from "zod";
import { SpsSchema } from "./team-set";

const ULID = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/);
const ISODateTime = z.string().datetime({ offset: false });
const RosterId = z.string().regex(/^[a-z0-9-]+$/);

export const UserTeamStatusSchema = z.enum(["draft", "saved", "archived"]);

export const UserTeamOriginSchema = z.enum([
  "paste",
  "builder",
  "ai_prompt",
  "duplicated_from_tournament",
]);

export const ValidationCodeSchema = z.enum([
  "species_unknown",
  "species_not_legal",
  "ability_not_legal",
  "move_not_legal",
  "item_unknown",
  "nature_unknown",
  "sps_total_exceeded",
  "sps_per_stat_exceeded",
  "slot_empty",
  "duplicate_species",
  "tera_present",
  "parse_failed",
]);

export const ValidationWarningCodeSchema = z.enum([
  "species_not_legal_warning",
]);

export const ValidationErrorSchema = z
  .object({
    code: ValidationCodeSchema,
    message: z.string().min(1),
    slot: z.number().int().min(0).max(5).nullable().optional(),
  })
  .strict();

export const ValidationWarningSchema = z
  .object({
    code: ValidationWarningCodeSchema,
    message: z.string().min(1),
    slot: z.number().int().min(0).max(5).nullable().optional(),
  })
  .strict();

export const ValidationResultSchema = z
  .object({
    errors: z.array(ValidationErrorSchema),
    warnings: z.array(ValidationWarningSchema),
  })
  .strict();

export const UserSetSchema = z
  .object({
    slot: z.number().int().min(0).max(5),
    species_id: RosterId.nullable(),
    nickname: z.string().min(1).nullable(),
    item_id: z.string().min(1).nullable(),
    ability_id: z.string().min(1).nullable(),
    nature: z.string().min(1).nullable(),
    hp_sps: z.number().int().min(0).max(32),
    atk_sps: z.number().int().min(0).max(32),
    def_sps: z.number().int().min(0).max(32),
    spa_sps: z.number().int().min(0).max(32),
    spd_sps: z.number().int().min(0).max(32),
    spe_sps: z.number().int().min(0).max(32),
    move_1_id: z.string().min(1).nullable(),
    move_2_id: z.string().min(1).nullable(),
    move_3_id: z.string().min(1).nullable(),
    move_4_id: z.string().min(1).nullable(),
    notes: z.string().nullable(),
  })
  .strict();

export const UserTeamSchema = z
  .object({
    schema_version: z.literal(1),
    id: ULID,
    name: z.string().min(1),
    description: z.string().nullable(),
    win_condition: z.string().nullable(),
    status: UserTeamStatusSchema,
    origin: UserTeamOriginSchema,
    origin_payload: z.string().nullable(),
    source_tournament_team_id: z.string().nullable(),
    validation_errors: z.array(ValidationErrorSchema),
    validation_warnings: z.array(ValidationWarningSchema),
    sets: z.array(UserSetSchema).length(6),
    created_at: ISODateTime,
    updated_at: ISODateTime,
  })
  .strict();

/** Per CLAUDE.md §10 the row mirror exists for repo-internal use; mirrors the DB row 1:1. */
export const UserTeamRowSchema = z
  .object({
    id: ULID,
    name: z.string().min(1),
    description: z.string().nullable(),
    win_condition: z.string().nullable(),
    status: UserTeamStatusSchema,
    origin: UserTeamOriginSchema,
    origin_payload: z.string().nullable(),
    source_tournament_team_id: z.string().nullable(),
    validation_errors: z.string(), // JSON
    validation_warnings: z.string(), // JSON
    schema_version: z.literal(1),
    created_at: ISODateTime,
    updated_at: ISODateTime,
  })
  .strict();

export const UserTeamCreateArgsSchema = z
  .object({
    origin: UserTeamOriginSchema,
    origin_payload: z.string().nullable().default(null),
    source_tournament_team_id: z.string().nullable().default(null),
    name: z.string().min(1).optional(),
    description: z.string().nullable().default(null),
    win_condition: z.string().nullable().default(null),
    sets: z.array(UserSetSchema).max(6).default([]),
  })
  .strict();

export const UserTeamUpdatePatchSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    win_condition: z.string().nullable().optional(),
  })
  .strict();

export const UserTeamSetUpsertPatchSchema = UserSetSchema.omit({ slot: true })
  .partial()
  .strict();

export const UserTeamFilterSchema = z
  .object({
    status: UserTeamStatusSchema.optional(),
    origin: UserTeamOriginSchema.optional(),
  })
  .strict();

export const UserTeamRevisionMetaSchema = z
  .object({
    user_team_id: ULID,
    revision_number: z.number().int().min(1).max(5),
    created_at: ISODateTime,
    label: z.string().nullable().optional(),
  })
  .strict();

export const UserTeamRevisionSchema = UserTeamRevisionMetaSchema.extend({
  snapshot: UserTeamSchema,
}).strict();

// Re-export SpsSchema for convenience (callers wiring user-set spreads can
// import from one place).
export { SpsSchema };

export type UserTeamStatus = z.infer<typeof UserTeamStatusSchema>;
export type UserTeamOrigin = z.infer<typeof UserTeamOriginSchema>;
export type ValidationCode = z.infer<typeof ValidationCodeSchema>;
export type ValidationWarningCode = z.infer<typeof ValidationWarningCodeSchema>;
export type ValidationError = z.infer<typeof ValidationErrorSchema>;
export type ValidationWarning = z.infer<typeof ValidationWarningSchema>;
export type ValidationResult = z.infer<typeof ValidationResultSchema>;
export type UserSet = z.infer<typeof UserSetSchema>;
export type UserTeam = z.infer<typeof UserTeamSchema>;
export type UserTeamRow = z.infer<typeof UserTeamRowSchema>;
export type UserTeamCreateArgs = z.input<typeof UserTeamCreateArgsSchema>;
export type UserTeamCreateArgsParsed = z.infer<typeof UserTeamCreateArgsSchema>;
export type UserTeamUpdatePatch = z.infer<typeof UserTeamUpdatePatchSchema>;
export type UserTeamSetUpsertPatch = z.infer<typeof UserTeamSetUpsertPatchSchema>;
export type UserTeamFilter = z.infer<typeof UserTeamFilterSchema>;
export type UserTeamRevisionMeta = z.infer<typeof UserTeamRevisionMetaSchema>;
export type UserTeamRevision = z.infer<typeof UserTeamRevisionSchema>;
