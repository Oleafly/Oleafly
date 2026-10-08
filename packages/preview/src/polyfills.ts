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

export function installGetOrInsert(ctor: Ctor | undefined) {
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

installGetOrInsert(typeof Map !== "undefined" ? (Map as unknown as Ctor) : undefined);
installGetOrInsert(typeof WeakMap !== "undefined" ? (WeakMap as unknown as Ctor) : undefined);

type IteratorPrototype = { find?: unknown };

export function installIteratorFind(prototype: IteratorPrototype | undefined) {
  if (!prototype || typeof prototype.find === "function") return;
  Object.defineProperty(prototype, "find", {
    value: function <T>(this: Iterator<T>, predicate: (value: T, index: number) => unknown) {
      if (typeof predicate !== "function") {
        this.return?.();
        throw new TypeError(`${String(predicate)} is not a function`);
      }
      let index = 0;
      for (let step = this.next(); !step.done; step = this.next()) {
        let matched: unknown;
        try {
          matched = predicate(step.value, index++);
        } catch (error) {
          this.return?.();
          throw error;
        }
        if (matched) {
          this.return?.();
          return step.value;
        }
      }
      return undefined;
    },
    writable: true,
    configurable: true,
  });
}

installIteratorFind(
  typeof Symbol === "function"
    ? (Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]())) as IteratorPrototype)
    : undefined,
);

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

type PromiseCtor = {
  try?: unknown;
};

export function installPromiseTry(ctor: PromiseCtor | undefined) {
  if (!ctor || typeof ctor.try === "function") return;
  Object.defineProperty(ctor, "try", {
    value: function <TArgs extends unknown[], TResult>(
      callback: (...args: TArgs) => TResult | PromiseLike<TResult>,
      ...args: TArgs
    ) {
      return new Promise<TResult>((resolve) => resolve(callback(...args)));
    },
    writable: true,
    configurable: true,
  });
}

installPromiseTry(typeof Promise !== "undefined" ? (Promise as unknown as PromiseCtor) : undefined);

type URLCtor = {
  new (input: string | URL, base?: string | URL): URL;
  parse?: unknown;
};

export function installURLParse(ctor: URLCtor | undefined) {
  if (!ctor || typeof ctor.parse === "function") return;
  Object.defineProperty(ctor, "parse", {
    value: (input: string | URL, base?: string | URL) => {
      try {
        return new ctor(input, base);
      } catch {
        return null;
      }
    },
    writable: true,
    configurable: true,
  });
}

installURLParse(typeof URL !== "undefined" ? (URL as unknown as URLCtor) : undefined);

function defineMissing(owner: object, key: string, value: unknown) {
  if (typeof (owner as Record<string, unknown>)[key] === "function") return;
  Object.defineProperty(owner, key, { value, writable: true, configurable: true });
}

function addToPartials(partials: number[], input: number): void {
  let value = input;
  let kept = 0;
  for (const partial of partials) {
    let small = partial;
    if (Math.abs(value) < Math.abs(small)) [value, small] = [small, value];
    const high = value + small;
    const low = small - (high - value);
    if (low !== 0) partials[kept++] = low;
    value = high;
  }
  partials.length = kept;
  partials.push(value);
}

function sumPartials(partials: readonly number[]): number {
  let index = partials.length;
  if (index === 0) return 0;
  index -= 1;
  let high = partials[index];
  let low = 0;
  while (index > 0) {
    const previous = high;
    index -= 1;
    const next = partials[index];
    high = previous + next;
    low = next - (high - previous);
    if (low !== 0) break;
  }
  if (index > 0 && ((low < 0 && partials[index - 1] < 0) || (low > 0 && partials[index - 1] > 0))) {
    const doubled = low * 2;
    const rounded = high + doubled;
    if (doubled === rounded - high) high = rounded;
  }
  return high;
}

function exactSum(values: readonly number[]): number {
  const partials: number[] = [];
  for (const value of values) addToPartials(partials, value);
  return sumPartials(partials);
}

interface SumPreciseItems {
  finite: number[];
  positiveInfinity: boolean;
  negativeInfinity: boolean;
  notANumber: boolean;
  onlyNegativeZero: boolean;
}

function classifySumPreciseItems(items: Iterable<unknown>): SumPreciseItems {
  const finite: number[] = [];
  let positiveInfinity = false;
  let negativeInfinity = false;
  let notANumber = false;
  let onlyNegativeZero = true;
  for (const item of items) {
    if (typeof item !== "number") throw new TypeError("Math.sumPrecise expects numbers");
    if (Number.isNaN(item)) notANumber = true;
    else if (item === Number.POSITIVE_INFINITY) positiveInfinity = true;
    else if (item === Number.NEGATIVE_INFINITY) negativeInfinity = true;
    else {
      if (!Object.is(item, -0)) onlyNegativeZero = false;
      finite.push(item);
    }
  }
  return { finite, positiveInfinity, negativeInfinity, notANumber, onlyNegativeZero };
}

export function installMathSumPrecise(math: { sumPrecise?: unknown } | undefined) {
  if (!math) return;
  defineMissing(math, "sumPrecise", function sumPrecise(items: Iterable<unknown>) {
    const { finite, positiveInfinity, negativeInfinity, notANumber, onlyNegativeZero } =
      classifySumPreciseItems(items);
    if (notANumber || (positiveInfinity && negativeInfinity)) return Number.NaN;
    if (positiveInfinity) return Number.POSITIVE_INFINITY;
    if (negativeInfinity) return Number.NEGATIVE_INFINITY;
    if (onlyNegativeZero) return -0;
    const sum = exactSum(finite);
    return Number.isFinite(sum) ? sum : exactSum(finite.map((value) => value / 2)) * 2;
  });
}

installMathSumPrecise(typeof Math !== "undefined" ? (Math as unknown as { sumPrecise?: unknown }) : undefined);

export function installPromiseWithResolvers(ctor: { withResolvers?: unknown } | undefined) {
  if (!ctor) return;
  defineMissing(ctor, "withResolvers", function withResolvers<T>(this: PromiseConstructor) {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new this<T>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    return { promise, resolve, reject };
  });
}

installPromiseWithResolvers(typeof Promise !== "undefined" ? (Promise as unknown as { withResolvers?: unknown }) : undefined);

type Base64Options = { alphabet?: "base64" | "base64url"; omitPadding?: boolean };

export function installUint8ArrayBase64(ctor: (Function & { prototype: object; fromBase64?: unknown }) | undefined) {
  if (!ctor) return;
  defineMissing(ctor.prototype, "toBase64", function toBase64(this: Uint8Array, options: Base64Options = {}) {
    let binary = "";
    for (let offset = 0; offset < this.length; offset += 0x8000) {
      binary += String.fromCodePoint(...this.subarray(offset, offset + 0x8000));
    }
    let encoded = btoa(binary);
    if (options.alphabet === "base64url") encoded = encoded.replaceAll("+", "-").replaceAll("/", "_");
    if (options.omitPadding) {
      let end = encoded.length;
      while (end > 0 && encoded[end - 1] === "=") end -= 1;
      encoded = encoded.slice(0, end);
    }
    return encoded;
  });
  defineMissing(ctor, "fromBase64", function fromBase64(input: unknown, options: Base64Options = {}) {
    if (typeof input !== "string") throw new TypeError("Uint8Array.fromBase64 expects a string");
    let text = input.replace(/[\t\n\f\r ]/gu, "");
    if (options.alphabet === "base64url") {
      if (/[+/]/u.test(text)) throw new SyntaxError("Invalid base64url string");
      text = text.replaceAll("-", "+").replaceAll("_", "/");
    } else if (/[-_]/u.test(text)) {
      throw new SyntaxError("Invalid base64 string");
    }
    text = text.padEnd(Math.ceil(text.length / 4) * 4, "=");
    let binary: string;
    try {
      binary = atob(text);
    } catch {
      throw new SyntaxError("Invalid base64 string");
    }
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.codePointAt(index) ?? 0;
    return bytes;
  });
}

installUint8ArrayBase64(typeof Uint8Array !== "undefined" ? Uint8Array : undefined);

function callable(callback: unknown, name: string): asserts callback is (...args: never[]) => unknown {
  if (typeof callback !== "function") throw new TypeError(`${name} expects a function`);
}

function iterate<T>(iterator: Iterator<T>): Iterable<T> {
  return { [Symbol.iterator]: () => iterator };
}

function* mapIterator<T, U>(source: Iterator<T>, mapper: (value: T, index: number) => U) {
  let index = 0;
  for (const value of iterate(source)) yield mapper(value, index++);
}

function* filterIterator<T>(source: Iterator<T>, predicate: (value: T, index: number) => unknown) {
  let index = 0;
  for (const value of iterate(source)) if (predicate(value, index++)) yield value;
}

function* takeIterator<T>(source: Iterator<T>, count: number) {
  let remaining = Math.floor(count);
  if (remaining === 0) {
    source.return?.();
    return;
  }
  for (const value of iterate(source)) {
    yield value;
    remaining -= 1;
    if (remaining === 0) return;
  }
}

function* dropIterator<T>(source: Iterator<T>, count: number) {
  let remaining = Math.floor(count);
  for (const value of iterate(source)) {
    if (remaining > 0) {
      remaining -= 1;
      continue;
    }
    yield value;
  }
}

function* flatMapIterator<T, U>(source: Iterator<T>, mapper: (value: T, index: number) => Iterable<U>) {
  let index = 0;
  for (const value of iterate(source)) yield* mapper(value, index++);
}

export function installIteratorHelpers(prototype: object | undefined) {
  if (!prototype) return;
  defineMissing(prototype, "map", function map<T, U>(this: Iterator<T>, mapper: (value: T, index: number) => U) {
    callable(mapper, "Iterator.prototype.map");
    return mapIterator(this, mapper);
  });
  defineMissing(prototype, "filter", function filter<T>(this: Iterator<T>, predicate: (value: T, index: number) => unknown) {
    callable(predicate, "Iterator.prototype.filter");
    return filterIterator(this, predicate);
  });
  defineMissing(prototype, "take", function take<T>(this: Iterator<T>, limit: number) {
    const count = Number(limit);
    if (Number.isNaN(count) || count < 0) throw new RangeError("Iterator.prototype.take expects a non-negative number");
    return takeIterator(this, count);
  });
  defineMissing(prototype, "drop", function drop<T>(this: Iterator<T>, limit: number) {
    const count = Number(limit);
    if (Number.isNaN(count) || count < 0) throw new RangeError("Iterator.prototype.drop expects a non-negative number");
    return dropIterator(this, count);
  });
  defineMissing(prototype, "flatMap", function flatMap<T, U>(this: Iterator<T>, mapper: (value: T, index: number) => Iterable<U>) {
    callable(mapper, "Iterator.prototype.flatMap");
    return flatMapIterator(this, mapper);
  });
  defineMissing(prototype, "toArray", function toArray<T>(this: Iterator<T>) {
    return [...iterate(this)];
  });
  defineMissing(prototype, "forEach", function forEach<T>(this: Iterator<T>, callback: (value: T, index: number) => void) {
    callable(callback, "Iterator.prototype.forEach");
    let index = 0;
    for (const value of iterate(this)) callback(value, index++);
  });
  defineMissing(prototype, "some", function some<T>(this: Iterator<T>, predicate: (value: T, index: number) => unknown) {
    callable(predicate, "Iterator.prototype.some");
    let index = 0;
    for (const value of iterate(this)) if (predicate(value, index++)) return true;
    return false;
  });
  defineMissing(prototype, "every", function every<T>(this: Iterator<T>, predicate: (value: T, index: number) => unknown) {
    callable(predicate, "Iterator.prototype.every");
    let index = 0;
    for (const value of iterate(this)) if (!predicate(value, index++)) return false;
    return true;
  });
  defineMissing(prototype, "reduce", function reduce<T, U>(this: Iterator<T>, reducer: (total: U, value: T, index: number) => U, ...initial: [U?]) {
    callable(reducer, "Iterator.prototype.reduce");
    let index = 0;
    let hasTotal = initial.length > 0;
    let total = initial[0] as U;
    for (const value of iterate(this)) {
      if (!hasTotal) {
        total = value as unknown as U;
        hasTotal = true;
        index += 1;
        continue;
      }
      total = reducer(total, value, index++);
    }
    if (!hasTotal) throw new TypeError("Reduce of empty iterator with no initial value");
    return total;
  });
}

installIteratorHelpers(
  typeof Symbol !== "undefined"
    ? (Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]())) as object)
    : undefined,
);

type SetLike<T> = { size: number; has(value: T): boolean; keys(): Iterator<T> };

export function installSetMethods(ctor: { prototype: object } | undefined) {
  if (!ctor) return;
  const prototype = ctor.prototype;
  defineMissing(prototype, "union", function union<T>(this: Set<T>, other: SetLike<T>) {
    const result = new Set(this);
    for (const value of iterate(other.keys())) result.add(value);
    return result;
  });
  defineMissing(prototype, "intersection", function intersection<T>(this: Set<T>, other: SetLike<T>) {
    const result = new Set<T>();
    for (const value of this) if (other.has(value)) result.add(value);
    return result;
  });
  defineMissing(prototype, "difference", function difference<T>(this: Set<T>, other: SetLike<T>) {
    const result = new Set<T>();
    for (const value of this) if (!other.has(value)) result.add(value);
    return result;
  });
  defineMissing(prototype, "symmetricDifference", function symmetricDifference<T>(this: Set<T>, other: SetLike<T>) {
    const result = new Set(this);
    for (const value of iterate(other.keys())) {
      if (this.has(value)) result.delete(value);
      else result.add(value);
    }
    return result;
  });
  defineMissing(prototype, "isSubsetOf", function isSubsetOf<T>(this: Set<T>, other: SetLike<T>) {
    for (const value of this) if (!other.has(value)) return false;
    return true;
  });
  defineMissing(prototype, "isSupersetOf", function isSupersetOf<T>(this: Set<T>, other: SetLike<T>) {
    for (const value of iterate(other.keys())) if (!this.has(value)) return false;
    return true;
  });
  defineMissing(prototype, "isDisjointFrom", function isDisjointFrom<T>(this: Set<T>, other: SetLike<T>) {
    for (const value of this) if (other.has(value)) return false;
    return true;
  });
}

installSetMethods(typeof Set !== "undefined" ? Set : undefined);

function transfer(this: ArrayBuffer, newLength?: number) {
  const length = newLength === undefined ? this.byteLength : Math.max(0, Math.trunc(Number(newLength)));
  const moved =
    typeof structuredClone === "function"
      ? (structuredClone(this, { transfer: [this] }) as ArrayBuffer)
      : this.slice(0);
  if (moved.byteLength === length) return moved;
  const resized = new ArrayBuffer(length);
  new Uint8Array(resized).set(new Uint8Array(moved, 0, Math.min(length, moved.byteLength)));
  return resized;
}

export function installArrayBufferTransfer(ctor: { prototype: object } | undefined) {
  if (!ctor) return;
  defineMissing(ctor.prototype, "transfer", transfer);
  defineMissing(ctor.prototype, "transferToFixedLength", transfer);
}

installArrayBufferTransfer(typeof ArrayBuffer !== "undefined" ? ArrayBuffer : undefined);

const CONTROL_ESCAPES: Readonly<Record<string, string>> = {
  "\t": String.raw`\t`,
  "\n": String.raw`\n`,
  "\v": String.raw`\v`,
  "\f": String.raw`\f`,
  "\r": String.raw`\r`,
};

function hexEscape(code: number) {
  return code <= 0xff
    ? String.raw`\x${code.toString(16).padStart(2, "0")}`
    : String.raw`\u${code.toString(16).padStart(4, "0")}`;
}

export function installRegExpEscape(ctor: { escape?: unknown } | undefined) {
  if (!ctor) return;
  defineMissing(ctor, "escape", function escape(input: unknown) {
    if (typeof input !== "string") throw new TypeError("RegExp.escape expects a string");
    let escaped = "";
    let first = true;
    for (const character of input) {
      const code = character.codePointAt(0) ?? 0;
      if (first && /[0-9A-Za-z]/u.test(character)) escaped += hexEscape(code);
      else if (String.raw`^$\.*+?()[]{}|/`.includes(character)) escaped += `\\${character}`;
      else if (CONTROL_ESCAPES[character]) escaped += CONTROL_ESCAPES[character];
      else if (",-=<>#&!%:;@~'`\"".includes(character) || /\s/u.test(character) || (code >= 0xd800 && code <= 0xdfff)) {
        escaped += hexEscape(code);
      } else escaped += character;
      first = false;
    }
    return escaped;
  });
}

installRegExpEscape(typeof RegExp !== "undefined" ? (RegExp as unknown as { escape?: unknown }) : undefined);

export function installArrayChangeByCopy(ctor: { prototype: object } | undefined) {
  if (!ctor) return;
  defineMissing(ctor.prototype, "toReversed", function toReversed<T>(this: T[]) {
    return Array.from(this).reverse();
  });
  defineMissing(ctor.prototype, "toSorted", function toSorted<T>(this: T[], compare?: (left: T, right: T) => number) {
    return Array.from(this).sort(compare);
  });
  defineMissing(ctor.prototype, "toSpliced", function toSpliced<T>(this: T[], start: number, deleteCount?: number, ...items: T[]) {
    const copy = Array.from(this);
    if (arguments.length === 0) return copy;
    if (arguments.length === 1) copy.splice(start);
    else copy.splice(start, deleteCount ?? 0, ...items);
    return copy;
  });
  defineMissing(ctor.prototype, "with", function withValue<T>(this: T[], index: number, value: T) {
    const length = this.length;
    const position = Math.trunc(Number(index)) < 0 ? length + Math.trunc(Number(index)) : Math.trunc(Number(index));
    if (position < 0 || position >= length) throw new RangeError("Invalid index");
    const copy = Array.from(this);
    copy[position] = value;
    return copy;
  });
}

installArrayChangeByCopy(typeof Array !== "undefined" ? Array : undefined);

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
      async next() {
        const result = await reader.read();
        if (result.done) reader.releaseLock();
        return result;
      },
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

type FontFaceLike = {
  readonly status: string;
  load(): Promise<unknown>;
};

type FontFaceCtor = {
  prototype: FontFaceLike;
};

function loadedOwner(prototype: object): object | null {
  for (let owner: object | null = prototype; owner; owner = Object.getPrototypeOf(owner)) {
    if (Object.getOwnPropertyDescriptor(owner, "loaded")) return owner;
  }
  return null;
}

export function installSettledFontFaceLoad(ctor: FontFaceCtor | undefined) {
  if (!ctor) return;
  const prototype = loadedOwner(ctor.prototype) as FontFaceLike | null;
  if (!prototype) return;
  const loaded = Object.getOwnPropertyDescriptor(prototype, "loaded");
  const nativeLoad = prototype.load;
  if (!loaded?.get || typeof nativeLoad !== "function") return;
  const nativeLoaded = loaded.get;
  Object.defineProperty(prototype, "loaded", {
    get(this: FontFaceLike) {
      return this.status === "loaded" ? Promise.resolve(this) : nativeLoaded.call(this);
    },
    enumerable: loaded.enumerable ?? false,
    configurable: true,
  });
  Object.defineProperty(prototype, "load", {
    value: function (this: FontFaceLike) {
      return this.status === "loaded" ? Promise.resolve(this) : nativeLoad.call(this);
    },
    writable: true,
    configurable: true,
  });
}

installSettledFontFaceLoad(
  typeof FontFace !== "undefined" ? (FontFace as unknown as FontFaceCtor) : undefined,
);
