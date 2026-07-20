// Polyfills for JS features newer than some WebViews the app runs in.
//
// Tauri uses the OS's system WebView, so the available JS depends on the user's
// OS version, not the build machine. pdf.js v6 uses the TC39 "Map.prototype.
// getOrInsert" proposal methods (`getOrInsert` / `getOrInsertComputed`), which
// only exist on very recent engines (Safari/WebKit ~18.4+). On older macOS the
// method is missing and PDF rendering throws
// "getOrInsertComputed is not a function". Define them if absent.
//
// Imported first in `main.tsx` so it runs before pdf.js loads.

type Ctor = { prototype: { getOrInsert?: unknown; getOrInsertComputed?: unknown } };

function install(ctor: Ctor | undefined) {
  if (!ctor) return;
  const proto = ctor.prototype as {
    has(key: unknown): boolean;
    get(key: unknown): unknown;
    set(key: unknown, value: unknown): unknown;
    getOrInsert?: unknown;
    getOrInsertComputed?: unknown;
  };
  if (typeof proto.getOrInsert !== "function") {
    Object.defineProperty(proto, "getOrInsert", {
      value: function (key: unknown, value: unknown) {
        if (this.has(key)) return this.get(key);
        this.set(key, value);
        return value;
      },
      writable: true,
      configurable: true,
    });
  }
  if (typeof proto.getOrInsertComputed !== "function") {
    Object.defineProperty(proto, "getOrInsertComputed", {
      value: function (key: unknown, callbackFn: (key: unknown) => unknown) {
        if (this.has(key)) return this.get(key);
        const value = callbackFn(key);
        this.set(key, value);
        return value;
      },
      writable: true,
      configurable: true,
    });
  }
}

install(typeof Map !== "undefined" ? (Map as unknown as Ctor) : undefined);
install(typeof WeakMap !== "undefined" ? (WeakMap as unknown as Ctor) : undefined);

type Uint8ArrayCtor = {
  prototype: {
    toHex?: unknown;
  };
};

export function installUint8ArrayToHex(ctor: Uint8ArrayCtor | undefined) {
  if (!ctor || typeof ctor.prototype.toHex === "function") return;
  Object.defineProperty(ctor.prototype, "toHex", {
    value: function (this: Uint8Array) {
      let result = "";
      for (const byte of this) result += byte.toString(16).padStart(2, "0");
      return result;
    },
    writable: true,
    configurable: true,
  });
}

installUint8ArrayToHex(
  typeof Uint8Array !== "undefined" ? (Uint8Array as unknown as Uint8ArrayCtor) : undefined,
);

// WebKit/WKWebView does not implement async iteration of ReadableStream
// (`ReadableStream.prototype[Symbol.asyncIterator]`). pdf.js v6 `getTextContent`
// does `for await (const value of readableStream)`, so text extraction throws
// "undefined is not a function (near '...of readableStream...')" on macOS/iOS,
// even though canvas rendering (which uses getReader directly) works. This breaks
// Preflight, which extracts PDF text. Define the async iterator if it is missing.
(() => {
  const RS = (globalThis as unknown as { ReadableStream?: { prototype: Record<PropertyKey, unknown> } })
    .ReadableStream;
  if (!RS || typeof RS.prototype[Symbol.asyncIterator] === "function") return;
  function asyncIterator(this: ReadableStream, opts?: { preventCancel?: boolean }) {
    const preventCancel = opts?.preventCancel ?? false;
    const reader = this.getReader();
    return {
      next: () => reader.read(),
      return(value?: unknown) {
        if (preventCancel) {
          reader.releaseLock();
          return Promise.resolve({ value, done: true });
        }
        const cancelled = reader.cancel(value);
        reader.releaseLock();
        return cancelled.then(() => ({ value, done: true }));
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  }
  Object.defineProperty(RS.prototype, Symbol.asyncIterator, {
    value: asyncIterator,
    writable: true,
    configurable: true,
  });
  if (typeof RS.prototype.values !== "function") {
    Object.defineProperty(RS.prototype, "values", {
      value: asyncIterator,
      writable: true,
      configurable: true,
    });
  }
})();
