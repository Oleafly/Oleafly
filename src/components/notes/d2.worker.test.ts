import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { D2Reply, D2Request } from "./d2.worker";

vi.mock("@terrastruct/d2/wasm-exec", () => ({}));
vi.mock("@terrastruct/d2/wasm?url", () => ({ default: "/assets/d2.wasm" }));

interface Scope {
  Go?: unknown;
  d2?: unknown;
  onmessage?: ((event: { data: D2Request }) => void) | null;
  postMessage?: (reply: D2Reply) => void;
}

const scope = globalThis as unknown as Scope;
const replies: D2Reply[] = [];
const rendered: unknown[] = [];
const runs = vi.fn();

const fakeD2 = {
  compile: vi.fn(async (input: string) => {
    const { fs, options } = JSON.parse(input) as { fs: { index: string }; options: Record<string, unknown> };
    if (fs.index === "silent") return JSON.stringify({ error: {} });
    if (fs.index.includes("{")) {
      return JSON.stringify({ error: { message: JSON.stringify([{ errmsg: "index:1:6: maps must be terminated with }" }]) } });
    }
    const own = fs.index.includes("own") ? { n1: null, n7: "#123456" } : null;
    return JSON.stringify({ data: { diagram: { name: fs.index }, renderOptions: { ...options, themeOverrides: own } } });
  }),
  render: vi.fn((input: string) => {
    rendered.push(JSON.parse(input));
    return JSON.stringify({ data: btoa("<svg>ok</svg>") });
  }),
};

function send(request: D2Request): Promise<D2Reply> {
  const before = replies.length;
  scope.onmessage?.({ data: request });
  return vi.waitFor(() => {
    const reply = replies[before];
    if (!reply) throw new Error(`no reply to ${request.id} yet`);
    return reply;
  });
}

beforeAll(async () => {
  scope.Go = class {
    importObject = {};
    run() {
      runs();
      scope.d2 = fakeD2;
      return new Promise(() => undefined);
    }
  };
  scope.postMessage = (reply) => replies.push(reply);
  vi.stubGlobal("fetch", vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(8) })));
  vi.spyOn(WebAssembly, "instantiateStreaming").mockRejectedValue(new TypeError("Incorrect response MIME type"));
  vi.spyOn(WebAssembly, "instantiate").mockResolvedValue({ instance: {} } as never);
  await import("./d2.worker");
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const name of ["Go", "d2", "onmessage", "postMessage"] as const) Reflect.deleteProperty(scope, name);
});

beforeEach(() => {
  rendered.length = 0;
});

describe("the D2 worker", () => {
  it("starts the Go runtime once, falling back from streaming, and answers with the SVG", async () => {
    expect(await send({ id: 1, source: "a -> b", theme: 0, background: null })).toEqual({ id: 1, svg: "<svg>ok</svg>" });
    expect(await send({ id: 2, source: "b -> c", theme: 200, background: null })).toEqual({ id: 2, svg: "<svg>ok</svg>" });
    expect(runs).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith("/assets/d2.wasm");
    expect(JSON.parse(fakeD2.compile.mock.calls[1][0])).toEqual({
      fs: { index: "b -> c" },
      options: { themeID: 200, pad: 16, scale: 1, noXMLTag: true },
    });
  });

  it("paints the canvas in the app's background unless the diagram sets its own", async () => {
    await send({ id: 3, source: "a -> b", theme: 200, background: "#0a0a0a" });
    expect(rendered[0]).toMatchObject({ diagram: { name: "a -> b" }, options: { themeID: 200, noXMLTag: true, themeOverrides: { n7: "#0a0a0a" } } });
    await send({ id: 4, source: "own -> colours", theme: 0, background: "#0a0a0a" });
    expect(rendered[1]).toMatchObject({ options: { themeOverrides: { n7: "#123456" } } });
    await send({ id: 5, source: "x -> y", theme: 0, background: null });
    expect((rendered[2] as { options: { themeOverrides: unknown } }).options.themeOverrides).toBeNull();
  });

  it("passes D2's error list back as the message", async () => {
    const reply = await send({ id: 6, source: "a -> {", theme: 0, background: null });
    expect(reply).toEqual({ id: 6, error: JSON.stringify([{ errmsg: "index:1:6: maps must be terminated with }" }]) });
    expect(rendered).toEqual([]);
  });

  it("answers with a failure code when D2 fails without a message", async () => {
    expect(await send({ id: 7, source: "silent", theme: 0, background: null })).toEqual({ id: 7, failure: "failed" });
  });
});
