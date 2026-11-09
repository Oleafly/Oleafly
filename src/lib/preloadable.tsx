import { type ComponentProps, type ComponentType, type ElementType, lazy as reactLazy, useState } from "react";
import { scheduleIdle } from "@/lib/idle";

export const IDLE_FALLBACK_MS = 1_200;
export const QUIET_MS = 1_500;
export const STARTUP_MS = 4_000;
export const HEAVY_QUIET_MS = 8_000;
export const MIN_IDLE_MS = 15;
export const LATE_MS = 50;
export const BUSY_PATIENCE_MS = 10_000;
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
let loading = false;
let startedAt = Number.NEGATIVE_INFINITY;
let cancelWait: (() => void) | null = null;
let report: (error: unknown) => void = () => {};
let lastInput = Number.NEGATIVE_INFINITY;
let pressed = false;
let captured = false;
let busySince: number | null = null;
const INPUT_EVENTS = [
  "pointerdown",
  "pointerup",
  "pointercancel",
  "pointermove",
  "gotpointercapture",
  "lostpointercapture",
  "keydown",
  "wheel",
  "scroll",
  "resize",
  "blur",
] as const;

function noteInput(event: Event): void {
  switch (event.type) {
    case "pointermove":
      if ((event as MouseEvent).buttons === 0) {
        pressed = false;
        return;
      }
      break;
    case "pointerdown":
      pressed = true;
      break;
    case "pointerup":
    case "pointercancel":
      pressed = false;
      break;
    case "gotpointercapture":
      captured = true;
      break;
    case "lostpointercapture":
      captured = false;
      break;
    case "blur":
      if (event.target === event.currentTarget) {
        pressed = false;
        captured = false;
      }
      return;
  }
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

function holdOff(warmer: Warmer, now: number): number {
  const quiet = warmer.priority <= HEAVY ? HEAVY_QUIET_MS : QUIET_MS;
  const sinceInput = pressed || captured ? 0 : now - lastInput;
  return Math.max(0, quiet - sinceInput, STARTUP_MS - (now - startedAt));
}

function idleEnough(deadline: IdleDeadline | undefined, due: number): boolean {
  const now = Date.now();
  const roomy = deadline ? !deadline.didTimeout && deadline.timeRemaining() >= MIN_IDLE_MS : now - due <= LATE_MS;
  busySince ??= now;
  if (!roomy && now - busySince < BUSY_PATIENCE_MS) return false;
  busySince = null;
  return true;
}

function take(): void {
  const next = queue.shift();
  if (!next) return;
  if (!next.wanted()) {
    deferred.push(next);
    pump();
    return;
  }
  loading = true;
  next
    .preload()
    .catch(report)
    .finally(() => {
      loading = false;
      pump();
    });
}

function pump(): void {
  if (!started || loading || cancelWait) return;
  const next = queue[0];
  if (!next) return;
  const wait = holdOff(next, Date.now());
  if (wait > 0) {
    const timer = globalThis.setTimeout(() => {
      cancelWait = null;
      pump();
    }, wait);
    cancelWait = () => globalThis.clearTimeout(timer);
    return;
  }
  const due = Date.now() + IDLE_FALLBACK_MS;
  cancelWait = scheduleIdle(
    (deadline) => {
      cancelWait = null;
      const head = queue[0];
      if (head && (holdOff(head, Date.now()) > 0 || !idleEnough(deadline, due))) pump();
      else take();
    },
    { fallbackMs: IDLE_FALLBACK_MS },
  );
}

function reschedule(): void {
  cancelWait?.();
  cancelWait = null;
  pump();
}

export function warmDeferred(): void {
  for (const warmer of deferred.splice(0)) enqueue(warmer);
  reschedule();
}

export function startWarming(onError: (error: unknown) => void): () => void {
  report = onError;
  if (!started) {
    listenForInput(true);
    startedAt = Date.now();
  }
  started = true;
  pump();
  return stopWarming;
}

export function stopWarming(): void {
  if (started) listenForInput(false);
  started = false;
  pressed = false;
  captured = false;
  busySince = null;
  cancelWait?.();
  cancelWait = null;
}

export function warmingQueueLength(): number {
  return queue.length + deferred.length;
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
    reschedule();
  }
  return component;
}
