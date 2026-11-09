import { type ComponentProps, type ComponentType, type ElementType, lazy as reactLazy, useState } from "react";

export const IDLE_FALLBACK_MS = 1_200;
export const QUIET_MS = 1_500;
export const HEAVY = -1;

export interface LazyOptions {
  warm?: boolean | (() => boolean);
  priority?: number;
}

export type PreloadableComponent<P> = ComponentType<P> & {
  preload(): Promise<void>;
  loaded(): boolean;
};

interface Warmer {
  preload(): Promise<void>;
  wanted(): boolean;
  priority: number;
}

const queue: Warmer[] = [];
const deferred: Warmer[] = [];
let started = false;
let busy = false;
let waiting: Warmer | null = null;
let stopIdle: (() => void) | null = null;
let report: (error: unknown) => void = () => {};
let lastInput = Number.NEGATIVE_INFINITY;
const INPUT_EVENTS = ["pointerdown", "keydown", "wheel"] as const;

function noteInput(): void {
  lastInput = Date.now();
}

function listenForInput(on: boolean): void {
  if (typeof window === "undefined") return;
  for (const type of INPUT_EVENTS) {
    if (on) window.addEventListener(type, noteInput, { capture: true, passive: true });
    else window.removeEventListener(type, noteInput, { capture: true });
  }
}

function enqueue(warmer: Warmer): void {
  const at = queue.findIndex((queued) => queued.priority < warmer.priority);
  if (at < 0) queue.push(warmer);
  else queue.splice(at, 0, warmer);
}

function pump(): void {
  if (!started || busy) return;
  const next = queue.shift();
  if (!next) return;
  busy = true;
  waiting = next;
  stopIdle = whenIdle(() => {
    stopIdle = null;
    waiting = null;
    if (Date.now() - lastInput < QUIET_MS) {
      queue.unshift(next);
      busy = false;
      const timer = globalThis.setTimeout(() => {
        stopIdle = null;
        pump();
      }, QUIET_MS);
      stopIdle = () => globalThis.clearTimeout(timer);
      return;
    }
    if (!next.wanted()) {
      deferred.push(next);
      busy = false;
      pump();
      return;
    }
    next
      .preload()
      .catch(report)
      .finally(() => {
        busy = false;
        pump();
      });
  });
}

export function warmDeferred(): void {
  for (const warmer of deferred.splice(0)) enqueue(warmer);
  pump();
}

export function startWarming(onError: (error: unknown) => void): () => void {
  report = onError;
  if (!started) listenForInput(true);
  started = true;
  pump();
  return stopWarming;
}

export function stopWarming(): void {
  if (started) listenForInput(false);
  started = false;
  stopIdle?.();
  stopIdle = null;
  if (waiting) {
    queue.unshift(waiting);
    waiting = null;
    busy = false;
  }
}

export function warmingQueueLength(): number {
  return queue.length + deferred.length + (waiting ? 1 : 0);
}

export function lazy<T extends ElementType>(
  load: () => Promise<{ default: T }>,
  options: LazyOptions = {},
): PreloadableComponent<ComponentProps<T>> {
  type P = ComponentProps<T>;
  let ready: ComponentType<P> | null = null;
  let pending: Promise<ComponentType<P>> | null = null;
  const start = () => {
    pending ??= load().then(
      (module) => {
        const component = module.default as unknown as ComponentType<P>;
        ready = component;
        return component;
      },
      (error: unknown) => {
        pending = null;
        throw error;
      },
    );
    return pending;
  };
  const Lazy = reactLazy(() => start().then((component) => ({ default: component })));
  function Preloadable(props: P) {
    const [Chosen] = useState<ComponentType<P>>(() => ready ?? Lazy);
    return <Chosen {...props} />;
  }
  const preload = () => start().then(() => undefined);
  const component = Object.assign(Preloadable, { preload, loaded: () => ready !== null });
  const { warm, priority = 0 } = options;
  if (warm) {
    enqueue({ preload, wanted: typeof warm === "function" ? warm : () => true, priority });
    pump();
  }
  return component;
}

export function whenIdle(run: () => void): () => void {
  if (typeof globalThis.requestIdleCallback === "function") {
    const id = globalThis.requestIdleCallback(() => run());
    return () => globalThis.cancelIdleCallback(id);
  }
  const id = globalThis.setTimeout(run, IDLE_FALLBACK_MS);
  return () => globalThis.clearTimeout(id);
}
