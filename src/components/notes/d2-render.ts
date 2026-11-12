import { RenderCache } from "@/components/ui/render-cache";
import { AppError, decodeAppError } from "@/lib/app-error";
import type { D2Failure, D2Reply, D2Request } from "./d2.worker";

export const D2_THEMES = { light: 0, dark: 200 } as const;
export const D2_IDLE_MS = 120_000;
const CACHE_ENTRIES = 32;
const CACHE_CHARS = 4_000_000;
const LOCATION = /^index:(\d+):(\d+):\s*/u;

type D2Theme = keyof typeof D2_THEMES;

interface Waiting {
  resolve: (svg: string) => void;
  reject: (error: Error) => void;
}

interface D2Problem {
  line: number | null;
  message: string;
}

const rendered = new RenderCache<string>(CACHE_ENTRIES, CACHE_CHARS);
const pending = new Map<string, Promise<string>>();
const waiting = new Map<number, Waiting>();
let worker: Worker | null = null;
let idle: number | undefined;
let sequence = 0;

function key(source: string, theme: D2Theme, background: string | null): string {
  return `${theme}\n${background ?? ""}\n${source}`;
}

function stop(): void {
  window.clearTimeout(idle);
  idle = undefined;
  worker?.terminate();
  worker = null;
}

function failure(code: D2Failure | "stopped"): AppError {
  return new AppError(`notes.d2_${code}`, {}, null);
}

function settle(reply: D2Reply): void {
  const entry = waiting.get(reply.id);
  if (!entry) return;
  waiting.delete(reply.id);
  if ("svg" in reply) entry.resolve(reply.svg);
  else entry.reject("failure" in reply ? failure(reply.failure) : new Error(reply.error));
  if (waiting.size === 0) idle = window.setTimeout(stop, D2_IDLE_MS);
}

function failAll(error: Error): void {
  const entries = [...waiting.values()];
  waiting.clear();
  stop();
  for (const entry of entries) entry.reject(error);
}

function connection(): Worker {
  window.clearTimeout(idle);
  idle = undefined;
  if (worker) return worker;
  const next = new Worker(new URL("./d2.worker.ts", import.meta.url), { type: "module" });
  next.onmessage = (event: MessageEvent<D2Reply>) => settle(event.data);
  next.onerror = (event) => {
    event.preventDefault();
    failAll(event.message ? new Error(event.message) : failure("stopped"));
  };
  worker = next;
  return next;
}

export function cachedD2(source: string, theme: D2Theme, background: string | null = null): string | undefined {
  return rendered.get(key(source, theme, background));
}

export function renderD2(source: string, theme: D2Theme, background: string | null = null): Promise<string> {
  const id = key(source, theme, background);
  const cached = rendered.get(id);
  if (cached) return Promise.resolve(cached);
  const running = pending.get(id);
  if (running) return running;
  const request: D2Request = { id: ++sequence, source, theme: D2_THEMES[theme], background };
  const result = new Promise<string>((resolve, reject) => {
    waiting.set(request.id, { resolve, reject });
    connection().postMessage(request);
  }).then((svg) => {
    rendered.set(id, svg, svg.length);
    return svg;
  });
  pending.set(id, result);
  const forget = () => {
    if (pending.get(id) === result) pending.delete(id);
  };
  result.then(forget, forget);
  return result;
}

export function d2Problems(error: unknown): D2Problem[] {
  if (decodeAppError(error)) return [];
  const text = error instanceof Error ? error.message : String(error);
  let listed: unknown;
  try {
    listed = JSON.parse(text);
  } catch {
    listed = null;
  }
  const messages = Array.isArray(listed)
    ? listed.flatMap((item: unknown) => {
        const message = (item as { errmsg?: unknown } | null)?.errmsg;
        return typeof message === "string" ? [message] : [];
      })
    : [text];
  return messages.map((message) => {
    const located = LOCATION.exec(message);
    return located
      ? { line: Number(located[1]), message: message.slice(located[0].length).trim() }
      : { line: null, message: message.trim() };
  });
}

export function resetD2ForTest(): void {
  failAll(new Error("reset"));
  rendered.clear();
  pending.clear();
  sequence = 0;
}
