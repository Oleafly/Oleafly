import { z } from "zod";
import {
  ActorIdSchema,
  ClientUpdateIdSchema,
  type ClientUpdateId,
  EditSessionIdSchema,
  FileIdSchema,
  ReplicaIdSchema,
  type ReplicaId,
  U64Schema,
} from "./identity";
import {
  DEFAULT_REALTIME_LIMITS_V1,
  type RealtimeLimitsV1,
  validateRealtimeLimitsV1,
} from "./limits";
import {
  AiAssistanceReceiptSchema,
  MUTATION_ORIGINS,
  MutationEnvelopeV1Schema,
  type MutationEnvelopeV1,
} from "./mutation";
import {
  ClientPresenceV1Schema,
  PresenceSelectionV1Schema,
  ServerPresenceV1Schema,
  type ClientPresenceV1,
  type ServerPresenceV1,
} from "./presence";
import { assertWellFormedUtf16, utf8Length } from "./unicode";
import { REALTIME_PROTOCOL_VERSION } from "./version";

export const FRAME_MAGIC = new Uint8Array([0x4f, 0x4c, 0x52, 0x54]);
export const FRAME_HEADER_VERSION = 1 as const;
export const FRAME_HEADER_LENGTH = 12 as const;
export const OPENING_PROTOCOL_VERSION = 0 as const;
export const SYNC_TICKET_LENGTH = 32 as const;

export const WIRE_MESSAGE_KINDS_V1 = {
  openingAuth: 0x01,
  openingAccepted: 0x02,
  yjsSync: 0x10,
  mutation: 0x11,
  durableReceipt: 0x12,
  clientPresence: 0x20,
  serverPresence: 0x21,
} as const;

const YJS_SYNC_KIND_TO_BYTE = {
  state_vector: 0,
  sync_update: 1,
  broadcast: 2,
} as const;

export interface OpeningAuthV1 {
  readonly kind: "opening_auth";
  readonly supportedVersions: readonly number[];
  readonly ticket: Uint8Array;
}

export interface OpeningAcceptedV1 {
  readonly kind: "opening_accepted";
}

export interface ClientStateVectorRequestV1 {
  readonly kind: "yjs_sync";
  readonly syncKind: "state_vector";
  readonly payload: Uint8Array;
}

export interface ServerYjsSyncMessageV1 {
  readonly kind: "yjs_sync";
  readonly syncKind: "sync_update" | "broadcast";
  readonly payload: Uint8Array;
}

export const DurableReceiptV1Schema = z.object({
  clientUpdateId: ClientUpdateIdSchema,
  replicaId: ReplicaIdSchema,
  clientSequence: U64Schema,
  serverSequence: U64Schema,
  authorizationEpoch: U64Schema,
  committedAtUnixMs: U64Schema,
}).strict();

export type DurableReceiptV1 = z.infer<typeof DurableReceiptV1Schema>;

export type ClientToServerMessageV1 =
  | OpeningAuthV1
  | ClientStateVectorRequestV1
  | { readonly kind: "mutation"; readonly envelope: MutationEnvelopeV1 }
  | { readonly kind: "client_presence"; readonly presence: ClientPresenceV1 };

export type ServerToClientMessageV1 =
  | OpeningAcceptedV1
  | ServerYjsSyncMessageV1
  | { readonly kind: "durable_receipt"; readonly receipt: DurableReceiptV1 }
  | { readonly kind: "server_presence"; readonly presence: ServerPresenceV1 };

export interface ClientToServerFrameV1 {
  readonly protocolVersion: number;
  readonly message: ClientToServerMessageV1;
}

export interface ServerToClientFrameV1 {
  readonly protocolVersion: number;
  readonly message: ServerToClientMessageV1;
}

type Direction = "client_to_server" | "server_to_client";
type RealtimeMessageV1 = ClientToServerMessageV1 | ServerToClientMessageV1;
type RealtimeFrameV1 = Readonly<{
  protocolVersion: number;
  message: RealtimeMessageV1;
}>;

export function encodeClientToServerFrameV1(
  frame: ClientToServerFrameV1,
  limits: RealtimeLimitsV1 = DEFAULT_REALTIME_LIMITS_V1,
): Uint8Array {
  return encodeFrame(frame, "client_to_server", limits);
}

export function encodeServerToClientFrameV1(
  frame: ServerToClientFrameV1,
  limits: RealtimeLimitsV1 = DEFAULT_REALTIME_LIMITS_V1,
): Uint8Array {
  return encodeFrame(frame, "server_to_client", limits);
}

export function decodeClientToServerFrameV1(
  bytes: Uint8Array,
  limits: RealtimeLimitsV1 = DEFAULT_REALTIME_LIMITS_V1,
): ClientToServerFrameV1 {
  return decodeFrame(bytes, "client_to_server", limits) as ClientToServerFrameV1;
}

export function decodeServerToClientFrameV1(
  bytes: Uint8Array,
  limits: RealtimeLimitsV1 = DEFAULT_REALTIME_LIMITS_V1,
): ServerToClientFrameV1 {
  return decodeFrame(bytes, "server_to_client", limits) as ServerToClientFrameV1;
}

function encodeFrame(
  frame: RealtimeFrameV1,
  direction: Direction,
  rawLimits: RealtimeLimitsV1,
): Uint8Array {
  const limits = validateRealtimeLimitsV1(rawLimits);
  validateDirection(frame.message, direction);
  validateFrameProtocolVersion(frame);
  const payload = encodeMessage(frame.message, limits);
  const totalLength = FRAME_HEADER_LENGTH + payload.length;
  if (totalLength > limits.maxFrameBytes) throw new Error("realtime frame exceeds the configured limit");
  const result = new Uint8Array(totalLength);
  result.set(FRAME_MAGIC, 0);
  const view = new DataView(result.buffer, result.byteOffset, result.byteLength);
  view.setUint8(4, FRAME_HEADER_VERSION);
  view.setUint16(5, frame.protocolVersion, false);
  view.setUint8(7, messageKindByte(frame.message));
  view.setUint32(8, payload.length, false);
  result.set(payload, FRAME_HEADER_LENGTH);
  return result;
}

function decodeFrame(
  bytes: Uint8Array,
  direction: Direction,
  rawLimits: RealtimeLimitsV1,
): RealtimeFrameV1 {
  const limits = validateRealtimeLimitsV1(rawLimits);
  if (!(bytes instanceof Uint8Array)) throw new Error("realtime frame is not a Uint8Array");
  if (bytes.length > limits.maxFrameBytes) throw new Error("realtime frame exceeds the configured limit");
  if (bytes.length < FRAME_HEADER_LENGTH) throw new Error("realtime frame is truncated");
  if (!FRAME_MAGIC.every((byte, index) => bytes[index] === byte)) throw new Error("realtime frame has invalid magic");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint8(4) !== FRAME_HEADER_VERSION) {
    throw new Error(`unsupported realtime frame header version: ${view.getUint8(4)}`);
  }
  const protocolVersion = view.getUint16(5, false);
  const messageKind = view.getUint8(7);
  const payloadLength = view.getUint32(8, false);
  if (payloadLength > limits.maxFrameBytes - FRAME_HEADER_LENGTH) {
    throw new Error("realtime frame payload exceeds the configured limit");
  }
  if (payloadLength !== bytes.length - FRAME_HEADER_LENGTH) {
    throw new Error("realtime frame payload length does not match the header");
  }
  const reader = new Reader(bytes.subarray(FRAME_HEADER_LENGTH), limits);
  const message = decodeMessage(messageKind, reader, direction);
  reader.finish();
  const frame = { protocolVersion, message };
  validateFrameProtocolVersion(frame);
  return frame;
}

function encodeMessage(message: RealtimeMessageV1, limits: RealtimeLimitsV1): Uint8Array {
  const writer = new Writer(limits);
  switch (message.kind) {
    case "opening_auth": {
      if (message.supportedVersions.length === 0 || message.supportedVersions.length > 0xffff) {
        throw new Error("opening auth must advertise 1 to 65535 protocol versions");
      }
      const versions = [...message.supportedVersions];
      if (versions.some((version) => version === OPENING_PROTOCOL_VERSION)) {
        throw new Error("opening auth cannot advertise reserved protocol version 0");
      }
      if (new Set(versions).size !== versions.length) throw new Error("opening auth protocol versions must be unique");
      writer.u16(versions.length);
      for (const version of versions) writer.u16(version);
      writer.fixedBytes(message.ticket, SYNC_TICKET_LENGTH, "sync ticket");
      break;
    }
    case "opening_accepted":
      break;
    case "yjs_sync":
      writer.u8(YJS_SYNC_KIND_TO_BYTE[message.syncKind]);
      writer.bytes(
        message.payload,
        message.syncKind === "state_vector" ? limits.maxYjsStateVectorBytes : limits.maxYjsUpdateBytes,
        message.syncKind === "state_vector" ? "Yjs state vector" : "Yjs update",
      );
      break;
    case "mutation": {
      const envelope = MutationEnvelopeV1Schema.parse(message.envelope);
      writer.uuid(envelope.clientUpdateId);
      writer.uuid(envelope.replicaId);
      writer.u64(envelope.clientSequence);
      writer.uuid(envelope.editSessionId);
      writer.u8(MUTATION_ORIGINS.indexOf(envelope.origin));
      writer.optional(envelope.assistance, (assistance) => {
        const value = AiAssistanceReceiptSchema.parse(assistance);
        writer.string(value.provider, Math.min(128, limits.maxStringBytes), "assistance provider");
        writer.string(value.model, Math.min(256, limits.maxStringBytes), "assistance model");
        writer.string(value.proposalIdentifier, Math.min(256, limits.maxStringBytes), "proposal identifier");
        writer.string32(value.acceptedDiff, limits.maxAssistanceAcceptedDiffBytes, "accepted diff");
      });
      writer.bytes(envelope.update, limits.maxMutationUpdateBytes, "mutation update");
      break;
    }
    case "durable_receipt": {
      const receipt = DurableReceiptV1Schema.parse(message.receipt);
      writer.uuid(receipt.clientUpdateId);
      writer.uuid(receipt.replicaId);
      writer.u64(receipt.clientSequence);
      writer.u64(receipt.serverSequence);
      writer.u64(receipt.authorizationEpoch);
      writer.u64(receipt.committedAtUnixMs);
      break;
    }
    case "client_presence":
      encodeSelection(writer, ClientPresenceV1Schema.parse(message.presence).selection);
      break;
    case "server_presence": {
      const presence = ServerPresenceV1Schema.parse(message.presence);
      writer.uuid(presence.actorId);
      writer.uuid(presence.replicaId);
      writer.string(presence.displayName, limits.maxStringBytes, "presence display name");
      writer.string(presence.colorToken, limits.maxStringBytes, "presence color token");
      encodeSelection(writer, presence.selection);
      break;
    }
  }
  return writer.finish();
}

function decodeMessage(kind: number, reader: Reader, direction: Direction): RealtimeMessageV1 {
  switch (kind) {
    case WIRE_MESSAGE_KINDS_V1.openingAuth: {
      if (direction !== "client_to_server") throw new Error("opening_auth is not a server-to-client message");
      const count = reader.u16();
      if (count === 0) throw new Error("opening auth advertised no protocol versions");
      if (count * 2 + SYNC_TICKET_LENGTH > reader.remaining) throw new Error("opening auth version list is truncated");
      const supportedVersions: number[] = [];
      for (let index = 0; index < count; index += 1) supportedVersions.push(reader.u16());
      if (new Set(supportedVersions).size !== supportedVersions.length) throw new Error("opening auth protocol versions must be unique");
      if (supportedVersions.includes(OPENING_PROTOCOL_VERSION)) throw new Error("opening auth cannot advertise reserved protocol version 0");
      return { kind: "opening_auth", supportedVersions, ticket: reader.fixedBytes(SYNC_TICKET_LENGTH) };
    }
    case WIRE_MESSAGE_KINDS_V1.openingAccepted:
      if (direction !== "server_to_client") throw new Error("opening_accepted is not a client-to-server message");
      return { kind: "opening_accepted" };
    case WIRE_MESSAGE_KINDS_V1.yjsSync: {
      const byte = reader.u8();
      if (direction === "client_to_server") {
        if (byte !== YJS_SYNC_KIND_TO_BYTE.state_vector) throw new Error("clients may only send Yjs state-vector requests");
        return { kind: "yjs_sync", syncKind: "state_vector", payload: reader.bytes(reader.limits.maxYjsStateVectorBytes, "Yjs state vector") };
      }
      if (byte !== YJS_SYNC_KIND_TO_BYTE.sync_update && byte !== YJS_SYNC_KIND_TO_BYTE.broadcast) {
        throw new Error("server Yjs message has an invalid subtype");
      }
      return {
        kind: "yjs_sync",
        syncKind: byte === YJS_SYNC_KIND_TO_BYTE.sync_update ? "sync_update" : "broadcast",
        payload: reader.bytes(reader.limits.maxYjsUpdateBytes, "Yjs update"),
      };
    }
    case WIRE_MESSAGE_KINDS_V1.mutation:
      if (direction !== "client_to_server") throw new Error("mutation is not a server-to-client message");
      return {
        kind: "mutation",
        envelope: MutationEnvelopeV1Schema.parse({
          clientUpdateId: reader.uuid(ClientUpdateIdSchema),
          replicaId: reader.uuid(ReplicaIdSchema),
          clientSequence: reader.u64(),
          editSessionId: reader.uuid(EditSessionIdSchema),
          origin: MUTATION_ORIGINS[reader.u8()],
          assistance: reader.optional(() => ({
            provider: reader.string(Math.min(128, reader.limits.maxStringBytes), "assistance provider"),
            model: reader.string(Math.min(256, reader.limits.maxStringBytes), "assistance model"),
            proposalIdentifier: reader.string(Math.min(256, reader.limits.maxStringBytes), "proposal identifier"),
            acceptedDiff: reader.string32(reader.limits.maxAssistanceAcceptedDiffBytes, "accepted diff"),
          })),
          update: reader.bytes(reader.limits.maxMutationUpdateBytes, "mutation update"),
        }),
      };
    case WIRE_MESSAGE_KINDS_V1.durableReceipt:
      if (direction !== "server_to_client") throw new Error("durable_receipt is not a client-to-server message");
      return { kind: "durable_receipt", receipt: DurableReceiptV1Schema.parse({
        clientUpdateId: reader.uuid(ClientUpdateIdSchema),
        replicaId: reader.uuid(ReplicaIdSchema),
        clientSequence: reader.u64(),
        serverSequence: reader.u64(),
        authorizationEpoch: reader.u64(),
        committedAtUnixMs: reader.u64(),
      }) };
    case WIRE_MESSAGE_KINDS_V1.clientPresence:
      if (direction !== "client_to_server") throw new Error("client_presence is not a server-to-client message");
      return { kind: "client_presence", presence: ClientPresenceV1Schema.parse({ selection: decodeSelection(reader) }) };
    case WIRE_MESSAGE_KINDS_V1.serverPresence:
      if (direction !== "server_to_client") throw new Error("server_presence is not a client-to-server message");
      return { kind: "server_presence", presence: ServerPresenceV1Schema.parse({
        actorId: reader.uuid(ActorIdSchema),
        replicaId: reader.uuid(ReplicaIdSchema),
        displayName: reader.string(reader.limits.maxStringBytes, "presence display name"),
        colorToken: reader.string(reader.limits.maxStringBytes, "presence color token"),
        selection: decodeSelection(reader),
      }) };
    default:
      throw new Error(`unknown realtime message kind: ${kind}`);
  }
}

function validateDirection(message: RealtimeMessageV1, direction: Direction): void {
  const clientKind = message.kind === "opening_auth" || message.kind === "mutation" ||
    message.kind === "client_presence" || (message.kind === "yjs_sync" && message.syncKind === "state_vector");
  if ((direction === "client_to_server") !== clientKind) {
    throw new Error(`${message.kind} is not valid for ${direction}`);
  }
}

function encodeSelection(writer: Writer, selection: ClientPresenceV1["selection"]): void {
  writer.optional(selection ?? undefined, (value) => {
    const parsed = PresenceSelectionV1Schema.parse(value);
    writer.uuid(parsed.fileId);
    writer.bytes(parsed.anchorRelativePosition, writer.limits.maxRelativePositionBytes, "presence anchor relative position");
    writer.bytes(parsed.headRelativePosition, writer.limits.maxRelativePositionBytes, "presence head relative position");
  });
}

function decodeSelection(reader: Reader): ClientPresenceV1["selection"] {
  return reader.optional(() => PresenceSelectionV1Schema.parse({
    fileId: reader.uuid(FileIdSchema),
    anchorRelativePosition: reader.bytes(reader.limits.maxRelativePositionBytes, "presence anchor relative position"),
    headRelativePosition: reader.bytes(reader.limits.maxRelativePositionBytes, "presence head relative position"),
  })) ?? null;
}

function messageKindByte(message: RealtimeMessageV1): number {
  switch (message.kind) {
    case "opening_auth": return WIRE_MESSAGE_KINDS_V1.openingAuth;
    case "opening_accepted": return WIRE_MESSAGE_KINDS_V1.openingAccepted;
    case "yjs_sync": return WIRE_MESSAGE_KINDS_V1.yjsSync;
    case "mutation": return WIRE_MESSAGE_KINDS_V1.mutation;
    case "durable_receipt": return WIRE_MESSAGE_KINDS_V1.durableReceipt;
    case "client_presence": return WIRE_MESSAGE_KINDS_V1.clientPresence;
    case "server_presence": return WIRE_MESSAGE_KINDS_V1.serverPresence;
  }
}

function validateFrameProtocolVersion(frame: RealtimeFrameV1): void {
  if (!Number.isInteger(frame.protocolVersion) || frame.protocolVersion < 0 || frame.protocolVersion > 0xffff) {
    throw new Error("protocol version is outside the u16 range");
  }
  if (frame.message.kind === "opening_auth") {
    if (frame.protocolVersion !== OPENING_PROTOCOL_VERSION) throw new Error("opening auth must use protocol version 0 before negotiation");
  } else if (frame.protocolVersion !== REALTIME_PROTOCOL_VERSION) {
    throw new Error(`realtime v1 codec cannot read protocol version ${frame.protocolVersion}`);
  }
}

class Writer {
  readonly #parts: Uint8Array[] = [];
  constructor(readonly limits: RealtimeLimitsV1) {}
  u8(value: number): void { if (!Number.isInteger(value) || value < 0 || value > 0xff) throw new Error("value is outside the u8 range"); this.#parts.push(Uint8Array.of(value)); }
  u16(value: number): void { if (!Number.isInteger(value) || value < 0 || value > 0xffff) throw new Error("value is outside the u16 range"); const bytes = new Uint8Array(2); new DataView(bytes.buffer).setUint16(0, value, false); this.#parts.push(bytes); }
  u32(value: number): void { if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) throw new Error("value is outside the u32 range"); const bytes = new Uint8Array(4); new DataView(bytes.buffer).setUint32(0, value, false); this.#parts.push(bytes); }
  u64(value: bigint): void { U64Schema.parse(value); const bytes = new Uint8Array(8); let remaining = value; for (let index = 7; index >= 0; index -= 1) { bytes[index] = Number(remaining & 0xffn); remaining >>= 8n; } this.#parts.push(bytes); }
  fixedBytes(value: Uint8Array, length: number, label: string): void { if (!(value instanceof Uint8Array) || value.length !== length) throw new Error(`${label} must contain exactly ${length} bytes`); this.#parts.push(value); }
  bytes(value: Uint8Array, maximum: number, label: string): void { if (!(value instanceof Uint8Array)) throw new Error(`${label} is not a Uint8Array`); if (value.length > maximum) throw new Error(`${label} exceeds the configured limit`); this.u32(value.length); this.#parts.push(value); }
  string(value: string, maximum: number, label: string): void { const length = utf8Length(value, label); if (length > maximum) throw new Error(`${label} exceeds the configured limit`); const bytes = new TextEncoder().encode(value); this.u16(bytes.length); this.#parts.push(bytes); }
  string32(value: string, maximum: number, label: string): void { const length = utf8Length(value, label); if (length > maximum) throw new Error(`${label} exceeds the configured limit`); const bytes = new TextEncoder().encode(value); this.u32(bytes.length); this.#parts.push(bytes); }
  uuid(value: string): void { const compact = value.replaceAll("-", ""); if (!/^[0-9a-f]{32}$/.test(compact)) throw new Error("UUID is not canonical lowercase"); this.#parts.push(Uint8Array.from(compact.match(/../g) ?? [], (part) => Number.parseInt(part, 16))); }
  optional<T>(value: T | undefined, write: (value: T) => void): void { this.u8(value === undefined ? 0 : 1); if (value !== undefined) write(value); }
  finish(): Uint8Array { const length = this.#parts.reduce((sum, part) => sum + part.length, 0); if (length + FRAME_HEADER_LENGTH > this.limits.maxFrameBytes) throw new Error("realtime frame exceeds the configured limit"); const result = new Uint8Array(length); let offset = 0; for (const part of this.#parts) { result.set(part, offset); offset += part.length; } return result; }
}

class Reader {
  #offset = 0;
  constructor(private readonly bytesValue: Uint8Array, readonly limits: RealtimeLimitsV1) {}
  get remaining(): number { return this.bytesValue.length - this.#offset; }
  u8(): number { return this.take(1)[0]; }
  u16(): number { const bytes = this.take(2); return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(0, false); }
  u32(): number { const bytes = this.take(4); return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, false); }
  u64(): bigint { let value = 0n; for (const byte of this.take(8)) value = (value << 8n) | BigInt(byte); return U64Schema.parse(value); }
  fixedBytes(length: number): Uint8Array { return this.take(length); }
  bytes(maximum: number, label: string): Uint8Array { const length = this.u32(); if (length > maximum) throw new Error(`${label} exceeds the configured limit`); return this.take(length); }
  string(maximum: number, label: string): string { const length = this.u16(); if (length > maximum) throw new Error(`${label} exceeds the configured limit`); return decodeUtf8(this.take(length), label); }
  string32(maximum: number, label: string): string { const length = this.u32(); if (length > maximum) throw new Error(`${label} exceeds the configured limit`); return decodeUtf8(this.take(length), label); }
  uuid<T>(schema: z.ZodType<T>): T { const hex = [...this.take(16)].map((byte) => byte.toString(16).padStart(2, "0")).join(""); return schema.parse(`${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`); }
  optional<T>(read: () => T): T | undefined { const marker = this.u8(); if (marker === 0) return undefined; if (marker === 1) return read(); throw new Error("optional field marker is invalid"); }
  finish(): void { if (this.#offset !== this.bytesValue.length) throw new Error("realtime message has trailing bytes"); }
  private take(length: number): Uint8Array { if (length < 0 || this.#offset + length > this.bytesValue.length) throw new Error("realtime frame payload is truncated"); const result = this.bytesValue.subarray(this.#offset, this.#offset + length); this.#offset += length; return result; }
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  let value: string;
  try { value = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new Error(`${label} is not valid UTF-8`); }
  assertWellFormedUtf16(value, label);
  return value;
}

export type PendingMutationId = Readonly<{
  clientUpdateId: ClientUpdateId;
  replicaId: ReplicaId;
  clientSequence: bigint;
}>;

export class PendingMutationTracker {
  readonly #pending = new Map<ClientUpdateId, PendingMutationId>();

  add(value: PendingMutationId): boolean {
    U64Schema.parse(value.clientSequence);
    const existing = this.#pending.get(value.clientUpdateId);
    if (existing !== undefined) {
      if (existing.replicaId !== value.replicaId || existing.clientSequence !== value.clientSequence) {
        throw new Error("client update ID is already pending with a different mutation identity");
      }
      return false;
    }
    this.#pending.set(value.clientUpdateId, value);
    return true;
  }

  acknowledge(receipt: DurableReceiptV1): boolean {
    const parsed = DurableReceiptV1Schema.parse(receipt);
    const pending = this.#pending.get(parsed.clientUpdateId);
    if (pending === undefined) return false;
    if (pending.replicaId !== parsed.replicaId || pending.clientSequence !== parsed.clientSequence) {
      throw new Error("durable receipt does not match the pending mutation identity");
    }
    this.#pending.delete(parsed.clientUpdateId);
    return true;
  }

  get count(): number { return this.#pending.size; }
  get ids(): readonly ClientUpdateId[] { return [...this.#pending.keys()]; }
  get isSavedToTeam(): boolean { return this.#pending.size === 0; }
}
