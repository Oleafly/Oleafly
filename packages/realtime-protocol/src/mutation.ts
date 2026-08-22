import { z } from "zod";
import {
  ClientUpdateIdSchema,
  EditSessionIdSchema,
  ReplicaIdSchema,
  U64Schema,
} from "./identity";
import { DEFAULT_REALTIME_LIMITS_V1 } from "./limits";
import { utf8Length } from "./unicode";

export const MUTATION_ORIGINS = [
  "human",
  "suggestion_accept",
  "version_restore",
  "external_small_save",
  "external_bulk_apply",
  "import",
] as const;

export type MutationOrigin = (typeof MUTATION_ORIGINS)[number];

const utf8String = (label: string, minimum: number, maximum: number) => z.string()
  .refine((value) => {
    let length: number;
    try {
      length = utf8Length(value, label);
    } catch {
      return false;
    }
    return length >= minimum && length <= maximum;
  }, `${label} must contain ${minimum} to ${maximum} UTF-8 bytes`);

export const AiAssistanceReceiptSchema = z.object({
  provider: utf8String("provider", 1, 128),
  model: utf8String("model", 1, 256),
  proposalIdentifier: utf8String("proposal identifier", 1, 256),
  acceptedDiff: utf8String("accepted diff", 0, 1_048_576),
}).strict();

export const MutationEnvelopeV1Schema = z.object({
  clientUpdateId: ClientUpdateIdSchema,
  replicaId: ReplicaIdSchema,
  clientSequence: U64Schema,
  editSessionId: EditSessionIdSchema,
  origin: z.enum(MUTATION_ORIGINS),
  assistance: AiAssistanceReceiptSchema.optional(),
  update: z.instanceof(Uint8Array).refine(
    (value) => value.length <= DEFAULT_REALTIME_LIMITS_V1.maxMutationUpdateBytes,
    "mutation update exceeds the default configured limit",
  ),
}).strict();

export type AiAssistanceReceipt = z.infer<typeof AiAssistanceReceiptSchema>;
export type MutationEnvelopeV1 = z.infer<typeof MutationEnvelopeV1Schema>;
