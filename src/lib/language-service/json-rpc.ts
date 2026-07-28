export type JsonRpcId = string | number;

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: JsonValue;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: JsonValue;
}

export interface JsonRpcSuccessResponse {
  jsonrpc: "2.0";
  id: JsonRpcId | null;
  result: JsonValue;
}

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: JsonValue;
}

export interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: JsonRpcId | null;
  error: JsonRpcErrorObject;
}

export type JsonRpcResponse =
  | JsonRpcSuccessResponse
  | JsonRpcErrorResponse;

export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcResponse;

const hasOwn = (value: object, key: PropertyKey): boolean =>
  Object.hasOwn(value, key);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (!isRecord(value)) return false;
  return Object.values(value).every(isJsonValue);
}

export const isJsonRpcId = (value: unknown): value is JsonRpcId =>
  typeof value === "string" ||
  (typeof value === "number" && Number.isFinite(value));

const hasValidParams = (value: Record<string, unknown>): boolean =>
  !hasOwn(value, "params") || isJsonValue(value.params);

export function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (!isRecord(value)) return false;
  return (
    value.jsonrpc === "2.0" &&
    isJsonRpcId(value.id) &&
    typeof value.method === "string" &&
    value.method.length > 0 &&
    !hasOwn(value, "result") &&
    !hasOwn(value, "error") &&
    hasValidParams(value)
  );
}

export function isJsonRpcNotification(
  value: unknown,
): value is JsonRpcNotification {
  if (!isRecord(value)) return false;
  return (
    value.jsonrpc === "2.0" &&
    !hasOwn(value, "id") &&
    typeof value.method === "string" &&
    value.method.length > 0 &&
    !hasOwn(value, "result") &&
    !hasOwn(value, "error") &&
    hasValidParams(value)
  );
}

export function isJsonRpcErrorObject(
  value: unknown,
): value is JsonRpcErrorObject {
  if (!isRecord(value)) return false;
  return (
    typeof value.code === "number" &&
    Number.isInteger(value.code) &&
    typeof value.message === "string" &&
    (!hasOwn(value, "data") || isJsonValue(value.data))
  );
}

const hasValidResponseId = (value: unknown): value is JsonRpcId | null =>
  value === null || isJsonRpcId(value);

export function isJsonRpcSuccessResponse(
  value: unknown,
): value is JsonRpcSuccessResponse {
  if (!isRecord(value)) return false;
  return (
    value.jsonrpc === "2.0" &&
    hasValidResponseId(value.id) &&
    hasOwn(value, "result") &&
    isJsonValue(value.result) &&
    !hasOwn(value, "error") &&
    !hasOwn(value, "method")
  );
}

export function isJsonRpcErrorResponse(
  value: unknown,
): value is JsonRpcErrorResponse {
  if (!isRecord(value)) return false;
  return (
    value.jsonrpc === "2.0" &&
    hasValidResponseId(value.id) &&
    hasOwn(value, "error") &&
    isJsonRpcErrorObject(value.error) &&
    !hasOwn(value, "result") &&
    !hasOwn(value, "method")
  );
}

export const isJsonRpcResponse = (
  value: unknown,
): value is JsonRpcResponse =>
  isJsonRpcSuccessResponse(value) || isJsonRpcErrorResponse(value);

export const isJsonRpcMessage = (value: unknown): value is JsonRpcMessage =>
  isJsonRpcRequest(value) ||
  isJsonRpcNotification(value) ||
  isJsonRpcResponse(value);

export class JsonRpcProtocolError extends Error {
  readonly code: number;
  readonly data?: JsonValue;

  constructor(message: string, code = -32600, data?: JsonValue) {
    super(message);
    this.name = "JsonRpcProtocolError";
    this.code = code;
    this.data = data;
  }
}

export class JsonRpcRemoteError extends Error {
  readonly code: number;
  readonly data?: JsonValue;

  constructor(error: JsonRpcErrorObject) {
    super(error.message);
    this.name = "JsonRpcRemoteError";
    this.code = error.code;
    this.data = error.data;
  }
}

export function parseJsonRpcMessage(value: unknown): JsonRpcMessage {
  if (!isJsonRpcMessage(value)) {
    throw new JsonRpcProtocolError("Invalid JSON-RPC 2.0 message");
  }
  return value;
}

export function toJsonValue(value: unknown): JsonValue {
  if (!isJsonValue(value)) {
    throw new JsonRpcProtocolError("Value is not JSON serializable");
  }
  return value;
}
