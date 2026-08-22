import { z } from "zod";
import { ActorIdSchema, FileIdSchema, ReplicaIdSchema } from "./identity";
import { DEFAULT_REALTIME_LIMITS_V1 } from "./limits";
import { utf8Length } from "./unicode";

const boundedBytes = z.instanceof(Uint8Array).refine(
  (value) => value.length <= DEFAULT_REALTIME_LIMITS_V1.maxRelativePositionBytes,
  "relative position exceeds the default configured limit",
);

const boundedString = z.string().min(1).refine((value) => {
  try {
    return utf8Length(value, "presence string") <= DEFAULT_REALTIME_LIMITS_V1.maxStringBytes;
  } catch {
    return false;
  }
}, "presence string is ill-formed or too large");

export const PresenceSelectionV1Schema = z.object({
  fileId: FileIdSchema,
  anchorRelativePosition: boundedBytes,
  headRelativePosition: boundedBytes,
}).strict();

/** Client-to-server presence. Actor and replica identity come from the session. */
export const ClientPresenceV1Schema = z.object({
  selection: PresenceSelectionV1Schema.nullable(),
}).strict();

/** Server-to-client presence after the authenticated identity has been stamped. */
export const ServerPresenceV1Schema = ClientPresenceV1Schema.extend({
  actorId: ActorIdSchema,
  replicaId: ReplicaIdSchema,
  displayName: boundedString,
  colorToken: boundedString,
}).strict();

export type PresenceSelectionV1 = z.infer<typeof PresenceSelectionV1Schema>;
export type ClientPresenceV1 = z.infer<typeof ClientPresenceV1Schema>;
export type ServerPresenceV1 = z.infer<typeof ServerPresenceV1Schema>;
