import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installBodyBytes,
  installGetOrInsert,
  installIteratorConstructor,
  installIteratorFind,
  installPromiseTry,
  installSettledFontFaceLoad,
  installUint8ArrayToHex,
  installURLParse,
} from "./polyfills";

function mapBackedPrototype() {
  const store = new Map<unknown, unknown>();
  const prototype: Record<string, unknown> = {
    has: (key: unknown) => store.has(key),
    get: (key: unknown) => store.get(key),
    set: (key: unknown, value: unknown) => store.set(key, value),
  };
  return { prototype, store };
}

function trackedIterator(values: number[], prototype: object) {
  let position = 0;
  const iterator = Object.create(prototype) as Iterator<number> & { closed: number };
  iterator.closed = 0;
  iterator.next = () =>
    position < values.length
      ? { done: false, value: values[position++] }
      : { done: true, value: undefined };
  iterator.return = () => {
    iterator.closed += 1;
    return { done: true, value: undefined };
  };
  return iterator;
}

describe("PDF runtime polyfills", () => {
  it("installs a non-enumerable Uint8Array hexadecimal encoder", () => {
    const prototype: { toHex?: unknown } = {};
    installUint8ArrayToHex({ prototype });

    const descriptor = Object.getOwnPropertyDescriptor(prototype, "toHex");
    expect(descriptor?.enumerable).toBe(false);
    expect(descriptor?.writable).toBe(true);
    expect(descriptor?.configurable).toBe(true);
    expect(
      (descriptor?.value as (this: Uint8Array) => string).call(
        Uint8Array.from([0, 1, 15, 16, 254, 255]),
      ),
    ).toBe("00010f10feff");
  });

  it("preserves an existing native encoder", () => {
    const native = () => "native";
    const prototype = { toHex: native };
    installUint8ArrayToHex({ prototype });
    expect(prototype.toHex).toBe(native);
  });

  it("installs Promise.try with synchronous error and promise adoption semantics", async () => {
    const ctor: { try?: unknown } = {};
    installPromiseTry(ctor);
    const promiseTry = ctor.try as (
      callback: (...args: number[]) => number | Promise<number>,
      ...args: number[]
    ) => Promise<number>;

    await expect(promiseTry((left, right) => left + right, 2, 3)).resolves.toBe(5);
    await expect(promiseTry(async (value) => value * 2, 4)).resolves.toBe(8);
    await expect(
      promiseTry(() => {
        throw new Error("dispatch failed");
      }),
    ).rejects.toThrow("dispatch failed");
  });

  it("installs URL.parse with nullable parsing semantics", () => {
    const ctor = function TestURL(input: string | URL, base?: string | URL) {
      return new URL(input, base);
    } as unknown as {
      new (input: string | URL, base?: string | URL): URL;
      parse?: unknown;
    };
    installURLParse(ctor);
    const parse = ctor.parse as (input: string, base?: string) => URL | null;

    expect(parse("/document.pdf", "https://oleafly.com")?.href).toBe(
      "https://oleafly.com/document.pdf",
    );
    expect(parse("not a URL without a base")).toBeNull();
  });

  it("installs non-enumerable Map upsert methods that insert only missing keys", () => {
    const { prototype, store } = mapBackedPrototype();
    installGetOrInsert({ prototype });
    const getOrInsert = prototype.getOrInsert as (key: unknown, value: unknown) => unknown;
    const getOrInsertComputed = prototype.getOrInsertComputed as (
      key: unknown,
      callback: (key: unknown) => unknown,
    ) => unknown;

    expect(Object.getOwnPropertyDescriptor(prototype, "getOrInsert")?.enumerable).toBe(false);
    expect(Object.getOwnPropertyDescriptor(prototype, "getOrInsertComputed")?.enumerable).toBe(false);
    expect(getOrInsert.call(prototype, "page", 1)).toBe(1);
    expect(getOrInsert.call(prototype, "page", 2)).toBe(1);
    const compute = vi.fn((key: unknown) => [key]);
    const listeners = getOrInsertComputed.call(prototype, "textlayerrendered", compute);
    expect(getOrInsertComputed.call(prototype, "textlayerrendered", compute)).toBe(listeners);
    expect(compute).toHaveBeenCalledOnce();
    expect(compute).toHaveBeenCalledWith("textlayerrendered");
    expect([...store]).toEqual([
      ["page", 1],
      ["textlayerrendered", ["textlayerrendered"]],
    ]);
  });

  it("preserves native Map upsert methods", () => {
    const native = () => "native";
    const prototype = { getOrInsert: native, getOrInsertComputed: native };
    installGetOrInsert({ prototype });
    expect(prototype.getOrInsert).toBe(native);
    expect(prototype.getOrInsertComputed).toBe(native);
  });

  it("installs Iterator.prototype.find that stops and closes on the first match", () => {
    const prototype: { find?: unknown } = {};
    installIteratorFind(prototype);
    const find = prototype.find as (
      this: Iterator<number>,
      predicate: (value: number, index: number) => unknown,
    ) => number | undefined;
    expect(Object.getOwnPropertyDescriptor(prototype, "find")?.enumerable).toBe(false);

    const seen: [number, number][] = [];
    const matching = trackedIterator([4, 7, 9], prototype);
    expect(
      find.call(matching, (value, index) => {
        seen.push([value, index]);
        return value > 5;
      }),
    ).toBe(7);
    expect(seen).toEqual([
      [4, 0],
      [7, 1],
    ]);
    expect(matching.closed).toBe(1);

    const exhausted = trackedIterator([1, 2], prototype);
    expect(find.call(exhausted, () => false)).toBeUndefined();
    expect(exhausted.closed).toBe(0);
  });

  it("closes the iterator when the find predicate throws or is not callable", () => {
    const prototype: { find?: unknown } = {};
    installIteratorFind(prototype);
    const find = prototype.find as (this: Iterator<number>, predicate: unknown) => unknown;

    const throwing = trackedIterator([1, 2], prototype);
    expect(() =>
      find.call(throwing, () => {
        throw new Error("predicate failed");
      }),
    ).toThrow("predicate failed");
    expect(throwing.closed).toBe(1);

    const uncallable = trackedIterator([1], prototype);
    expect(() => find.call(uncallable, "not a function")).toThrow(TypeError);
    expect(uncallable.closed).toBe(1);
  });

  it("preserves a native Iterator.prototype.find", () => {
    const native = () => "native";
    const prototype = { find: native };
    installIteratorFind(prototype);
    expect(prototype.find).toBe(native);
  });

  it("installs a global Iterator over the engine's iterator prototype", () => {
    const engine = Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]())) as object;
    const global: { Iterator?: unknown } = {};
    installIteratorConstructor(global, engine);
    const Iterator = global.Iterator as new () => object;

    expect(Object.getOwnPropertyDescriptor(global, "Iterator")?.enumerable).toBe(false);
    expect(Iterator.prototype).toBe(engine);
    expect(Object.getOwnPropertyDescriptor(Iterator, "prototype")?.writable).toBe(false);
    expect([1, 2].values()).toBeInstanceOf(Iterator);
    expect(new Map().keys()).toBeInstanceOf(Iterator);
  });

  it("lets pdf.js add Iterator.prototype.join when its module loads", () => {
    const prototype: { join?: unknown } = {};
    const global: { Iterator?: { prototype: { join?: unknown } } } = {};
    installIteratorConstructor(global, prototype);
    const Iterator = global.Iterator as { prototype: { join?: unknown } };

    // The statement pdf.js 6 runs at the top of pdf.mjs and pdf.worker.mjs.
    if (typeof Iterator.prototype.join !== "function") {
      Iterator.prototype.join = function () {
        return "joined";
      };
    }

    expect(typeof prototype.join).toBe("function");
  });

  it("keeps the installed Iterator abstract while subclasses construct", () => {
    const prototype = {};
    const global: { Iterator?: unknown } = {};
    installIteratorConstructor(global, prototype);
    const Iterator = global.Iterator as new () => object;

    expect(() => (Iterator as unknown as () => unknown)()).toThrow(TypeError);
    expect(() => new Iterator()).toThrow(TypeError);
    class Counter extends Iterator {}
    expect(new Counter()).toBeInstanceOf(Iterator);
    expect(Object.getPrototypeOf(Counter.prototype)).toBe(prototype);
  });

  it("preserves a native Iterator constructor", () => {
    const native = function Iterator() {};
    const global = { Iterator: native };
    installIteratorConstructor(global, {});
    expect(global.Iterator).toBe(native);
  });
});

describe("PDF runtime polyfills on engines without the constructors", () => {
  it("skips installation when the runtime lacks the target", () => {
    expect(() => {
      installGetOrInsert(undefined);
      installIteratorConstructor(undefined, undefined);
      installIteratorConstructor({}, undefined);
      installIteratorFind(undefined);
      installUint8ArrayToHex(undefined);
      installPromiseTry(undefined);
      installURLParse(undefined);
      installBodyBytes(undefined);
    }).not.toThrow();
  });
});

describe("Response and Blob bytes polyfill", () => {
  it("reads a body into a Uint8Array where the engine has no bytes()", async () => {
    class OldResponse {
      constructor(private readonly body: ArrayBuffer) {}
      arrayBuffer() {
        return Promise.resolve(this.body);
      }
    }
    installBodyBytes(OldResponse);
    const bytes = await (new OldResponse(new Uint8Array([1, 2, 3]).buffer) as unknown as Response).bytes();
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect([...bytes]).toEqual([1, 2, 3]);
  });

  it("keeps a native bytes()", () => {
    const native = () => Promise.resolve(new Uint8Array());
    class NewBlob {}
    const prototype = NewBlob.prototype as unknown as { bytes?: unknown };
    prototype.bytes = native;
    installBodyBytes(NewBlob);
    expect(prototype.bytes).toBe(native);
  });
});

describe("ReadableStream async iteration polyfill", () => {
  type StreamPrototype = Record<PropertyKey, unknown>;
  const prototype = ReadableStream.prototype as unknown as StreamPrototype;
  const nativeIterator = Object.getOwnPropertyDescriptor(prototype, Symbol.asyncIterator);
  const nativeValues = Object.getOwnPropertyDescriptor(prototype, "values");

  function restore() {
    if (nativeIterator) Object.defineProperty(prototype, Symbol.asyncIterator, nativeIterator);
    if (nativeValues) Object.defineProperty(prototype, "values", nativeValues);
  }

  async function reinstall({ keepValues }: { keepValues: boolean }) {
    Reflect.deleteProperty(prototype, Symbol.asyncIterator);
    if (!keepValues) Reflect.deleteProperty(prototype, "values");
    vi.resetModules();
    await import("./polyfills");
  }

  function stream(chunks: string[], cancel = vi.fn()) {
    let index = 0;
    const source = new ReadableStream<string>({
      pull(controller) {
        if (index < chunks.length) controller.enqueue(chunks[index++]);
        else controller.close();
      },
      cancel,
    });
    return { source, cancel };
  }

  afterEach(() => {
    restore();
  });

  it("iterates every chunk with for await", async () => {
    await reinstall({ keepValues: false });
    expect(prototype[Symbol.asyncIterator]).not.toBe(nativeIterator?.value);
    const { source } = stream(["a", "b", "c"]);

    const chunks: string[] = [];
    for await (const chunk of source as unknown as AsyncIterable<string>) chunks.push(chunk);

    expect(chunks).toEqual(["a", "b", "c"]);
  });

  it("releases the reader lock once iteration finishes", async () => {
    await reinstall({ keepValues: false });
    const { source } = stream(["a", "b"]);

    for await (const chunk of source as unknown as AsyncIterable<string>) expect(chunk).toBeTypeOf("string");

    expect(source.locked).toBe(false);
  });

  it("cancels the stream when iteration stops early", async () => {
    await reinstall({ keepValues: false });
    const { source, cancel } = stream(["a", "b", "c"]);

    for await (const chunk of source as unknown as AsyncIterable<string>) {
      expect(chunk).toBe("a");
      break;
    }

    expect(cancel).toHaveBeenCalledOnce();
    expect(source.locked).toBe(false);
  });

  it("releases the lock without cancelling when asked to prevent cancel", async () => {
    await reinstall({ keepValues: false });
    const { source, cancel } = stream(["a", "b"]);
    const values = prototype.values as (
      this: ReadableStream<string>,
      options?: { preventCancel?: boolean },
    ) => AsyncIterableIterator<string> & {
      return: (value?: unknown) => Promise<IteratorResult<string>>;
    };

    const iterator = values.call(source, { preventCancel: true });
    expect(iterator[Symbol.asyncIterator]()).toBe(iterator);
    await expect(iterator.next()).resolves.toEqual({ value: "a", done: false });
    await expect(iterator.return("stop")).resolves.toEqual({ value: "stop", done: true });

    expect(cancel).not.toHaveBeenCalled();
    expect(source.locked).toBe(false);
    const reader = source.getReader();
    await expect(reader.read()).resolves.toEqual({ value: "b", done: false });
  });

  it("keeps a native values method", async () => {
    await reinstall({ keepValues: true });

    expect(Object.getOwnPropertyDescriptor(prototype, "values")).toEqual(nativeValues);
    expect(prototype[Symbol.asyncIterator]).not.toBe(nativeIterator?.value);
  });

  describe("on WebKit, whose releaseLock can deadlock its garbage collector", () => {
    const MAC_WKWEBVIEW =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";

    async function reinstallOnWebKit() {
      vi.stubGlobal("navigator", { userAgent: MAC_WKWEBVIEW });
      await reinstall({ keepValues: false });
      return vi.spyOn(ReadableStreamDefaultReader.prototype, "releaseLock");
    }

    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    it("reads every chunk without releasing the lock of the finished stream", async () => {
      const releaseLock = await reinstallOnWebKit();
      const { source } = stream(["a", "b", "c"]);

      const chunks: string[] = [];
      for await (const chunk of source as unknown as AsyncIterable<string>) chunks.push(chunk);

      expect(chunks).toEqual(["a", "b", "c"]);
      expect(releaseLock).not.toHaveBeenCalled();
      expect(source.locked).toBe(true);
    });

    it("cancels an abandoned stream without releasing its lock", async () => {
      const releaseLock = await reinstallOnWebKit();
      const { source, cancel } = stream(["a", "b", "c"]);

      for await (const chunk of source as unknown as AsyncIterable<string>) {
        expect(chunk).toBe("a");
        break;
      }

      expect(cancel).toHaveBeenCalledOnce();
      expect(releaseLock).not.toHaveBeenCalled();
    });

    it("still releases the lock when asked to prevent cancel, so the stream stays readable", async () => {
      const releaseLock = await reinstallOnWebKit();
      const { source, cancel } = stream(["a", "b"]);
      const values = prototype.values as (
        this: ReadableStream<string>,
        options?: { preventCancel?: boolean },
      ) => AsyncIterableIterator<string> & {
        return: (value?: unknown) => Promise<IteratorResult<string>>;
      };

      const iterator = values.call(source, { preventCancel: true });
      await expect(iterator.next()).resolves.toEqual({ value: "a", done: false });
      await expect(iterator.return("stop")).resolves.toEqual({ value: "stop", done: true });

      expect(cancel).not.toHaveBeenCalled();
      expect(releaseLock).toHaveBeenCalledOnce();
      await expect(source.getReader().read()).resolves.toEqual({ value: "b", done: false });
    });
  });
});

describe("settled font face loading", () => {
  function fontFaceCtor() {
    const calls = { loaded: 0, load: 0 };
    class Face {
      status = "loaded";
      get loaded() {
        calls.loaded += 1;
        return Promise.resolve(this);
      }
      load() {
        calls.load += 1;
        return Promise.resolve(this);
      }
    }
    return { Face, calls };
  }

  it("answers for an already loaded face without asking the engine", async () => {
    const { Face, calls } = fontFaceCtor();
    installSettledFontFaceLoad(Face);
    const face = new Face();

    await expect(face.loaded).resolves.toBe(face);
    await expect(face.load()).resolves.toBe(face);
    expect(calls).toEqual({ loaded: 0, load: 0 });
  });

  it("patches the engine prototype when the constructor is a subclass", async () => {
    const { Face, calls } = fontFaceCtor();
    class CountingFace extends Face {}
    installSettledFontFaceLoad(CountingFace);
    const face = new CountingFace();

    await expect(face.loaded).resolves.toBe(face);
    expect(calls).toEqual({ loaded: 0, load: 0 });
  });

  it("leaves faces that are still loading to the engine", async () => {
    const { Face, calls } = fontFaceCtor();
    installSettledFontFaceLoad(Face);
    const face = new Face();
    face.status = "loading";

    await expect(face.loaded).resolves.toBe(face);
    await expect(face.load()).resolves.toBe(face);
    expect(calls).toEqual({ loaded: 1, load: 1 });
  });
});
