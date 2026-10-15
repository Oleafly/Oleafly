import { afterEach, describe, expect, it, vi } from "vitest";
import { dropNativeDecompression, isWebKit } from "./worker-decompression";

const WEBKITGTK =
  "Mozilla/5.0 (X11; Ubuntu; Linux aarch64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";
const MAC_WKWEBVIEW =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";
const MAC_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";
const IOS_WKWEBVIEW =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const WEBVIEW2 =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0";
const LINUX_CHROME =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const MAC_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const HEADLESS_CHROME =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36";
const ANDROID_WEBVIEW =
  "Mozilla/5.0 (Linux; Android 15; Pixel 9 Build/AP3A.241005.015; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36";
const MAC_FIREFOX = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:143.0) Gecko/20100101 Firefox/143.0";
const NODE = "Node.js/22";

const WEBKIT = [WEBKITGTK, MAC_WKWEBVIEW, MAC_SAFARI, IOS_WKWEBVIEW];
const NOT_WEBKIT = [WEBVIEW2, LINUX_CHROME, MAC_CHROME, HEADLESS_CHROME, ANDROID_WEBVIEW, MAC_FIREFOX, NODE];

class FakeDecompressionStream {}

describe("pdf.js worker decompression on WebKit", () => {
  it.each(WEBKIT)("recognizes WebKit in %s", (userAgent) => {
    expect(isWebKit(userAgent)).toBe(true);
  });

  it.each(NOT_WEBKIT)("does not mistake %s for WebKit", (userAgent) => {
    expect(isWebKit(userAgent)).toBe(false);
  });

  it.each(WEBKIT)("removes the native DecompressionStream under %s so pdf.js inflates in JavaScript", (userAgent) => {
    const scope: { DecompressionStream?: unknown } = { DecompressionStream: FakeDecompressionStream };
    expect(dropNativeDecompression(scope, userAgent)).toBe(true);
    expect(scope.DecompressionStream).toBeUndefined();
    expect(() => new (scope.DecompressionStream as typeof FakeDecompressionStream)()).toThrow(TypeError);
  });

  it.each([WEBKITGTK, MAC_WKWEBVIEW])("falls back to undefined under %s when the global cannot be deleted", (userAgent) => {
    const scope: { DecompressionStream?: unknown } = {};
    Object.defineProperty(scope, "DecompressionStream", {
      value: FakeDecompressionStream,
      writable: true,
      configurable: false,
    });
    expect(dropNativeDecompression(scope, userAgent)).toBe(true);
    expect(scope.DecompressionStream).toBeUndefined();
  });

  it("leaves other engines and scopes without the API alone", () => {
    for (const userAgent of NOT_WEBKIT) {
      const scope: { DecompressionStream?: unknown } = { DecompressionStream: FakeDecompressionStream };
      expect(dropNativeDecompression(scope, userAgent)).toBe(false);
      expect(scope.DecompressionStream).toBe(FakeDecompressionStream);
    }
    expect(dropNativeDecompression({}, WEBKITGTK)).toBe(false);
    expect(dropNativeDecompression({}, MAC_WKWEBVIEW)).toBe(false);
  });
});

describe("the pdf.js worker entry", () => {
  const native = Object.getOwnPropertyDescriptor(globalThis, "DecompressionStream");

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    if (native) Object.defineProperty(globalThis, "DecompressionStream", native);
  });

  it("drops the native DecompressionStream inside a macOS WKWebView", async () => {
    expect(native).toBeDefined();
    vi.stubGlobal("navigator", { userAgent: MAC_WKWEBVIEW });
    vi.resetModules();
    await import("./pdf.worker");
    expect((globalThis as { DecompressionStream?: unknown }).DecompressionStream).toBeUndefined();
  });

  it("keeps the native DecompressionStream inside WebView2", async () => {
    vi.stubGlobal("navigator", { userAgent: WEBVIEW2 });
    vi.resetModules();
    await import("./pdf.worker");
    expect((globalThis as { DecompressionStream?: unknown }).DecompressionStream).toBe(native?.value);
  });
});
