import { describe, expect, it } from "vitest";
import {
  isJsonRpcErrorResponse,
  isJsonRpcMessage,
  isJsonRpcNotification,
  isJsonRpcRequest,
  isJsonRpcSuccessResponse,
  isJsonValue,
  isJsonRpcErrorObject,
  JsonRpcProtocolError,
  JsonRpcRemoteError,
  parseJsonRpcMessage,
  toJsonValue,
} from "./json-rpc";

describe("JSON-RPC 2.0 runtime guards", () => {
  it("accepts valid requests, notifications, and exclusive responses", () => {
    expect(
      isJsonRpcRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "example/request",
        params: { nested: [true, null, 2] },
      }),
    ).toBe(true);
    expect(
      isJsonRpcNotification({
        jsonrpc: "2.0",
        method: "example/notification",
      }),
    ).toBe(true);
    expect(
      isJsonRpcSuccessResponse({
        jsonrpc: "2.0",
        id: 1,
        result: null,
      }),
    ).toBe(true);
    expect(
      isJsonRpcErrorResponse({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: "Invalid Request" },
      }),
    ).toBe(true);
  });

  it("rejects malformed versions, ids, methods, params, and mixed responses", () => {
    expect(
      isJsonRpcRequest({ jsonrpc: "1.0", id: 1, method: "test" }),
    ).toBe(false);
    expect(
      isJsonRpcRequest({ jsonrpc: "2.0", id: null, method: "test" }),
    ).toBe(false);
    expect(
      isJsonRpcRequest({ jsonrpc: "2.0", id: 1, method: "" }),
    ).toBe(false);
    expect(
      isJsonRpcRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "test",
        params: { invalid: Number.NaN },
      }),
    ).toBe(false);
    expect(
      isJsonRpcSuccessResponse({
        jsonrpc: "2.0",
        id: 1,
        result: null,
        error: { code: -1, message: "both" },
      }),
    ).toBe(false);
    expect(
      isJsonRpcErrorResponse({
        jsonrpc: "2.0",
        id: 1,
        error: { code: 1.5, message: "non-integer code" },
      }),
    ).toBe(false);
  });

  it("validates JSON values recursively and throws on invalid messages", () => {
    expect(isJsonValue({ a: ["text", 1, false, null] })).toBe(true);
    expect(isJsonValue({ a: undefined })).toBe(false);
    expect(isJsonValue(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isJsonRpcMessage({ jsonrpc: "2.0", method: "ok" })).toBe(
      true,
    );
    expect(() => parseJsonRpcMessage({ jsonrpc: "2.0" })).toThrow(
      JsonRpcProtocolError,
    );
  });
});

describe("JSON-RPC guards for non-object values", () => {
  it.each([null, "text", 3, [1]])("rejects %j as any message shape", (value) => {
    expect(isJsonRpcRequest(value)).toBe(false);
    expect(isJsonRpcNotification(value)).toBe(false);
    expect(isJsonRpcErrorObject(value)).toBe(false);
    expect(isJsonRpcSuccessResponse(value)).toBe(false);
    expect(isJsonRpcErrorResponse(value)).toBe(false);
  });

  it("checks error objects field by field", () => {
    expect(isJsonRpcErrorObject({ code: -32600, message: "bad", data: [1] })).toBe(
      true,
    );
    expect(isJsonRpcErrorObject({ code: 1.5, message: "bad" })).toBe(false);
    expect(isJsonRpcErrorObject({ code: 1, message: 2 })).toBe(false);
    expect(
      isJsonRpcErrorObject({ code: 1, message: "bad", data: Number.NaN }),
    ).toBe(false);
  });

  it("converts JSON values and remote errors", () => {
    expect(toJsonValue({ ok: [1, "two", null] })).toEqual({
      ok: [1, "two", null],
    });
    expect(() => toJsonValue({ ratio: Number.POSITIVE_INFINITY })).toThrow(
      new JsonRpcProtocolError("Value is not JSON serializable"),
    );
    const remote = new JsonRpcRemoteError({
      code: -32001,
      message: "busy",
      data: { retry: true },
    });
    expect(remote).toMatchObject({
      name: "JsonRpcRemoteError",
      code: -32001,
      message: "busy",
      data: { retry: true },
    });
  });
});
