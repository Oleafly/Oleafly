import { z } from "zod";

declare const identityBrand: unique symbol;

type BrandedIdentity<Name extends string> = string & {
  readonly [identityBrand]: Name;
};

export type UUID = BrandedIdentity<"UUID">;
export type ActorId = BrandedIdentity<"ActorId">;
export type ServerProfileId = BrandedIdentity<"ServerProfileId">;
export type ServerInstanceId = BrandedIdentity<"ServerInstanceId">;
export type SharedProjectId = BrandedIdentity<"SharedProjectId">;
export type ReplicaId = BrandedIdentity<"ReplicaId">;
export type FileId = BrandedIdentity<"FileId">;
export type ProjectRevisionId = BrandedIdentity<"ProjectRevisionId">;
export type EditSessionId = BrandedIdentity<"EditSessionId">;
export type ClientUpdateId = BrandedIdentity<"ClientUpdateId">;
export type ConflictId = BrandedIdentity<"ConflictId">;
export type ContentDigest = `sha256:${string}`;

export const U64_MAX = 18_446_744_073_709_551_615n;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CONTENT_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

export const UuidSchema = z.string().regex(UUID_PATTERN).transform((id) => id as UUID);
export const ActorIdSchema = z
  .string()
  .regex(UUID_PATTERN)
  .transform((id) => id as ActorId);
export const ServerProfileIdSchema = z
  .string()
  .regex(UUID_PATTERN)
  .transform((id) => id as ServerProfileId);
export const ServerInstanceIdSchema = z
  .string()
  .regex(UUID_PATTERN)
  .transform((id) => id as ServerInstanceId);

const uuidV7Schema = <Name extends string>() =>
  z.string().regex(UUID_V7_PATTERN).transform((id) => id as BrandedIdentity<Name>);

export const SharedProjectIdSchema = uuidV7Schema<"SharedProjectId">();
export const ReplicaIdSchema = uuidV7Schema<"ReplicaId">();
export const FileIdSchema = uuidV7Schema<"FileId">();
export const ProjectRevisionIdSchema = uuidV7Schema<"ProjectRevisionId">();
export const EditSessionIdSchema = uuidV7Schema<"EditSessionId">();
export const ClientUpdateIdSchema = uuidV7Schema<"ClientUpdateId">();
export const ConflictIdSchema = uuidV7Schema<"ConflictId">();
export const ContentDigestSchema = z
  .string()
  .regex(CONTENT_DIGEST_PATTERN)
  .transform((digest) => digest as ContentDigest);

export interface RemoteProjectRef {
  readonly serverInstanceId: ServerInstanceId;
  readonly projectId: SharedProjectId;
}

export interface SharedProjectBinding extends RemoteProjectRef {
  readonly localProjectId: string;
  readonly serverProfileId: ServerProfileId;
  readonly replicaId: ReplicaId;
  readonly state: LocalBindingState;
}

export type LocalBindingState =
  | "sharing_staging"
  | "sharing_cutover"
  | "joining_bootstrap"
  | "shared_active"
  | "revocation_recovery";

/** Retained origin metadata after the live binding and credentials are removed. */
export interface ClosedSharedProjectRecord extends RemoteProjectRef {
  readonly localProjectId: string;
  readonly state: "shared_closed";
}

/** A copy is a separately minted solo project; it never changes the source project state. */
export interface MakeLocalCopyResultV1 {
  readonly source: RemoteProjectRef;
  readonly sourceRevisionId: ProjectRevisionId;
  readonly mintedLocalProjectId: string;
}

export const U64Schema = z.bigint().min(0n).max(U64_MAX);

export const CanonicalU64JsonSchema = z.string()
  .regex(/^(0|[1-9][0-9]{0,19})$/)
  .transform((value, context) => {
    const parsed = BigInt(value);
    if (parsed > U64_MAX) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "u64 decimal string is out of range" });
      return z.NEVER;
    }
    return parsed;
  });

export const RemoteProjectRefSchema = z.object({
  serverInstanceId: ServerInstanceIdSchema,
  projectId: SharedProjectIdSchema,
}).strict();

export const SharedProjectBindingSchema = RemoteProjectRefSchema.extend({
  localProjectId: z.string().min(1),
  serverProfileId: ServerProfileIdSchema,
  replicaId: ReplicaIdSchema,
  state: z.enum([
    "sharing_staging",
    "sharing_cutover",
    "joining_bootstrap",
    "shared_active",
    "revocation_recovery",
  ]),
}).strict();

export function remoteProjectKey(ref: RemoteProjectRef): string {
  return `${ref.serverInstanceId}:${ref.projectId}`;
}
