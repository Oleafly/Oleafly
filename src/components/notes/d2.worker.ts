import "@/lib/polyfills";
import "@terrastruct/d2/wasm-exec";
import wasmUrl from "@terrastruct/d2/wasm?url";
import { base64ToBytes } from "@/lib/base64";

interface GoRuntime {
  importObject: WebAssembly.Imports;
  run(instance: WebAssembly.Instance): Promise<void>;
}

interface D2Exports {
  compile(input: string): string | Promise<string>;
  render(input: string): string | Promise<string>;
}

interface Compiled {
  diagram: unknown;
  renderOptions: Record<string, unknown>;
}

export interface D2Request {
  id: number;
  source: string;
  theme: number;
  background: string | null;
}

export type D2Failure = "not_started" | "failed";

export type D2Reply = { id: number; svg: string } | { id: number; error: string } | { id: number; failure: D2Failure };

const scope = globalThis as unknown as {
  Go: new () => GoRuntime;
  d2?: D2Exports;
  onmessage: ((event: MessageEvent<D2Request>) => void) | null;
  postMessage(reply: D2Reply): void;
};

let runtime: Promise<D2Exports> | null = null;

class Failure extends Error {
  constructor(readonly failure: D2Failure) {
    super(failure);
  }
}

async function instantiate(go: GoRuntime): Promise<WebAssembly.Instance> {
  try {
    return (await WebAssembly.instantiateStreaming(fetch(wasmUrl), go.importObject)).instance;
  } catch {
    const bytes = await (await fetch(wasmUrl)).arrayBuffer();
    return (await WebAssembly.instantiate(bytes, go.importObject)).instance;
  }
}

function start(): Promise<D2Exports> {
  runtime ??= (async () => {
    const go = new scope.Go();
    void go.run(await instantiate(go));
    if (!scope.d2) throw new Failure("not_started");
    return scope.d2;
  })();
  runtime.catch(() => {
    runtime = null;
  });
  return runtime;
}

async function call<T>(run: (input: string) => string | Promise<string>, input: unknown): Promise<T> {
  const reply = JSON.parse(await run(JSON.stringify(input))) as { data?: T; error?: { message?: string } };
  if (reply.error) throw reply.error.message ? new Error(reply.error.message) : new Failure("failed");
  return reply.data as T;
}

function decoded(base64: string): string {
  return new TextDecoder().decode(base64ToBytes(base64));
}

function canvas(own: unknown, background: string | null): unknown {
  const overrides = own && typeof own === "object" ? (own as Record<string, unknown>) : null;
  if (!background || overrides?.n7) return own;
  return { ...overrides, n7: background };
}

scope.onmessage = async ({ data: { id, source, theme, background } }) => {
  try {
    const d2 = await start();
    const options = { themeID: theme, pad: 16, scale: 1, noXMLTag: true };
    const compiled = await call<Compiled>(d2.compile, { fs: { index: source }, options });
    const rendering = { ...compiled.renderOptions, noXMLTag: true, themeOverrides: canvas(compiled.renderOptions.themeOverrides, background) };
    const svg = await call<string>(d2.render, { diagram: compiled.diagram, options: rendering });
    scope.postMessage({ id, svg: decoded(svg) });
  } catch (error) {
    scope.postMessage(error instanceof Failure ? { id, failure: error.failure } : { id, error: error instanceof Error ? error.message : String(error) });
  }
};
