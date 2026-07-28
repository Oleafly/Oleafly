import { describe, expect, it } from "vitest";
import {
  isJsonRpcErrorResponse,
  isJsonRpcMessage,
  isJsonRpcNotification,
  isJsonRpcRequest,
  isJsonRpcSuccessResponse,
  isJsonValue,
  JsonRpcProtocolError,
  parseJsonRpcMessage,
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
