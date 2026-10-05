import { describe, expect, it } from "vitest";
import { dropNativeDecompression, isWebKitGtk } from "./worker-decompression";

const WEBKITGTK =
  "Mozilla/5.0 (X11; Ubuntu; Linux aarch64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";
const MAC_WKWEBVIEW =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";
const WEBVIEW2 =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0";
const LINUX_CHROME =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

class FakeDecompressionStream {}

describe("pdf.js worker decompression on WebKitGTK", () => {
  it("recognizes only WebKitGTK", () => {
    expect(isWebKitGtk(WEBKITGTK)).toBe(true);
    expect(isWebKitGtk(MAC_WKWEBVIEW)).toBe(false);
    expect(isWebKitGtk(WEBVIEW2)).toBe(false);
    expect(isWebKitGtk(LINUX_CHROME)).toBe(false);
  });

  it("removes the native DecompressionStream so pdf.js inflates in JavaScript", () => {
    const scope: { DecompressionStream?: unknown } = { DecompressionStream: FakeDecompressionStream };
    expect(dropNativeDecompression(scope, WEBKITGTK)).toBe(true);
    expect(scope.DecompressionStream).toBeUndefined();
    expect(() => new (scope.DecompressionStream as typeof FakeDecompressionStream)()).toThrow(TypeError);
  });

  it("falls back to undefined when the global cannot be deleted", () => {
    const scope: { DecompressionStream?: unknown } = {};
    Object.defineProperty(scope, "DecompressionStream", {
      value: FakeDecompressionStream,
      writable: true,
      configurable: false,
    });
    expect(dropNativeDecompression(scope, WEBKITGTK)).toBe(true);
    expect(scope.DecompressionStream).toBeUndefined();
  });

  it("leaves other engines and scopes without the API alone", () => {
    for (const userAgent of [MAC_WKWEBVIEW, WEBVIEW2, LINUX_CHROME]) {
      const scope: { DecompressionStream?: unknown } = { DecompressionStream: FakeDecompressionStream };
      expect(dropNativeDecompression(scope, userAgent)).toBe(false);
      expect(scope.DecompressionStream).toBe(FakeDecompressionStream);
    }
    expect(dropNativeDecompression({}, WEBKITGTK)).toBe(false);
  });
});
