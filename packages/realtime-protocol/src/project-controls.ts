import { z } from "zod";
import { CanonicalU64JsonSchema, FileIdSchema } from "./identity";

export const PROJECT_CONTROLS_SCHEMA_VERSION = 1 as const;

export const ProjectControlsSnapshotV1Schema = z.object({
  schemaVersion: z.literal(PROJECT_CONTROLS_SCHEMA_VERSION),
  version: CanonicalU64JsonSchema,
  mainFileId: FileIdSchema.nullable(),
}).strict();

export const SetMainFileCommandV1Schema = z.object({
  kind: z.literal("set_main_file"),
  expectedVersion: CanonicalU64JsonSchema,
  mainFileId: FileIdSchema.nullable(),
}).strict();

export type ProjectControlsSnapshotV1 = z.infer<
  typeof ProjectControlsSnapshotV1Schema
>;
export type SetMainFileCommandV1 = z.infer<typeof SetMainFileCommandV1Schema>;

/**
 * Control commands use the authenticated Owner-only control API. They are not
 * stored in, or accepted as edits to, AuthoringDoc.
 */
export type ProjectControlCommandV1 = SetMainFileCommandV1;
