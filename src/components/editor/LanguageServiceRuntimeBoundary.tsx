import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from "react";
import { logError } from "@/lib/log";
import { randomFraction } from "@/lib/random";

export interface LanguageServiceRuntimeModule {
  LanguageServiceRuntime: ComponentType;
}

export type LanguageServiceRuntimeLoader =
  () => Promise<LanguageServiceRuntimeModule>;

export interface SilentRetryPolicy {
  readonly baseMs: number;
  readonly maxMs: number;
  readonly limit: number;
}

export const LANGUAGE_SERVICE_RUNTIME_RETRY_POLICY: SilentRetryPolicy = {
  baseMs: 2_000,
  maxMs: 30_000,
  limit: 5,
};

export function silentRetryDelay(
  attempt: number,
  policy: SilentRetryPolicy,
  random: () => number = randomFraction,
): number {
  const ceiling = Math.min(policy.maxMs, policy.baseMs * 2 ** attempt);
  return Math.round(ceiling / 2 + random() * (ceiling / 2));
}

export interface SilentRetryOptions {
  failing: boolean;
  recovered: boolean;
  retry: () => void;
  policy: SilentRetryPolicy;
  scope: string;
  detail?: unknown;
  resetKey?: unknown;
  onGiveUp?: () => void;
}

function failureSignature(detail: unknown): string {
  if (detail instanceof Error) return `${detail.name}: ${detail.message}`;
  if (typeof detail === "string") return detail;
  return "unknown";
}

export function useSilentRetry({
  failing,
  recovered,
  retry,
  policy,
  scope,
  detail,
  resetKey,
  onGiveUp,
}: SilentRetryOptions): void {
  const [attempt, setAttempt] = useState(0);
  const logged = useRef<string | null>(null);
  const gaveUp = useRef(false);
  const episode = useRef<unknown>(resetKey);
  const latestRetry = useRef(retry);
  const latestGiveUp = useRef(onGiveUp);

  useEffect(() => {
    latestRetry.current = retry;
    latestGiveUp.current = onGiveUp;
  });

  useEffect(() => {
    if (Object.is(episode.current, resetKey) && !recovered) return;
    episode.current = resetKey;
    logged.current = null;
    gaveUp.current = false;
    setAttempt(0);
  }, [recovered, resetKey]);

  useEffect(() => {
    if (!failing) return;
    const signature = failureSignature(detail);
    if (logged.current === signature) return;
    logged.current = signature;
    void logError(scope, detail ?? signature);
  }, [detail, failing, scope]);

  useEffect(() => {
    if (!failing) return;
    if (attempt >= policy.limit) {
      if (gaveUp.current) return;
      gaveUp.current = true;
      void logError(scope, `stopped retrying after ${attempt} attempts`);
      latestGiveUp.current?.();
      return;
    }
    const timer = setTimeout(() => {
      setAttempt((value) => value + 1);
      latestRetry.current();
    }, silentRetryDelay(attempt, policy));
    return () => clearTimeout(timer);
  }, [attempt, failing, policy, scope]);
}

let runtimeUnavailable = false;
let setupOffer: (() => void) | null = null;
const runtimeListeners = new Set<() => void>();

function notifyRuntimeListeners(): void {
  for (const listener of runtimeListeners) listener();
}

function setRuntimeUnavailable(value: boolean): void {
  if (runtimeUnavailable === value) return;
  runtimeUnavailable = value;
  notifyRuntimeListeners();
}

function subscribeRuntimeAvailability(listener: () => void): () => void {
  runtimeListeners.add(listener);
  return () => runtimeListeners.delete(listener);
}

export function useLanguageServiceRuntimeUnavailable(): boolean {
  return useSyncExternalStore(
    subscribeRuntimeAvailability,
    () => runtimeUnavailable,
    () => false,
  );
}

export function offerLanguageServiceSetup(open: () => void): () => void {
  setupOffer = open;
  notifyRuntimeListeners();
  return () => {
    if (setupOffer !== open) return;
    setupOffer = null;
    notifyRuntimeListeners();
  };
}

export function useLanguageServiceSetupOffer(): (() => void) | null {
  return useSyncExternalStore(
    subscribeRuntimeAvailability,
    () => setupOffer,
    () => null,
  );
}

export function LanguageServiceRuntimeUnavailable() {
  useEffect(() => {
    setRuntimeUnavailable(true);
  }, []);
  return null;
}

class RuntimeLoadError extends Error {
  constructor(readonly original: unknown) {
    super(original instanceof Error ? original.message : String(original));
    this.name = "RuntimeLoadError";
  }
}

function RuntimeMounted({
  onMount,
  onStable,
  stableMs,
}: Readonly<{ onMount: () => void; onStable: () => void; stableMs: number }>) {
  useEffect(() => {
    onMount();
    const timer = setTimeout(onStable, stableMs);
    return () => clearTimeout(timer);
  }, [onMount, onStable, stableMs]);
  return null;
}

interface RuntimeErrorBoundaryProps {
  children: ReactNode;
  onError: (error: Error) => void;
}

class RuntimeErrorBoundary extends Component<
  RuntimeErrorBoundaryProps,
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    this.props.onError(error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function createLanguageServiceRuntimeBoundary(
  loadRuntime: LanguageServiceRuntimeLoader,
  policy: SilentRetryPolicy = LANGUAGE_SERVICE_RUNTIME_RETRY_POLICY,
) {
  const createRuntime = () =>
    lazy(async () => {
      let module: LanguageServiceRuntimeModule;
      try {
        module = await loadRuntime();
      } catch (error) {
        throw new RuntimeLoadError(error);
      }
      return { default: module.LanguageServiceRuntime };
    });

  return function DeferredLanguageServiceRuntime() {
    const [runtime, setRuntime] = useState(() => ({
      generation: 0,
      Runtime: createRuntime(),
    }));
    const [failure, setFailure] = useState<Error | null>(null);
    const [stableGeneration, setStableGeneration] = useState<number | null>(null);
    const retry = useCallback(() => {
      setFailure(null);
      setRuntime((current) => ({
        generation: current.generation + 1,
        Runtime: createRuntime(),
      }));
    }, []);
    const reportFailure = useCallback((error: Error) => {
      if (error instanceof RuntimeLoadError) {
        void logError("language service runtime", error.original);
        setRuntimeUnavailable(true);
        return;
      }
      setFailure(error);
    }, []);
    const giveUp = useCallback(() => setRuntimeUnavailable(true), []);
    const { generation, Runtime } = runtime;
    const markMounted = useCallback(() => setRuntimeUnavailable(false), []);
    const markStable = useCallback(() => setStableGeneration(generation), [generation]);
    useSilentRetry({
      failing: failure !== null,
      recovered: failure === null && stableGeneration === generation,
      retry,
      policy,
      scope: "language service runtime",
      detail: failure,
      onGiveUp: giveUp,
    });

    return (
      <RuntimeErrorBoundary key={generation} onError={reportFailure}>
        <Suspense fallback={null}>
          <Runtime />
          <RuntimeMounted onMount={markMounted} onStable={markStable} stableMs={policy.maxMs} />
        </Suspense>
      </RuntimeErrorBoundary>
    );
  };
}

export const LanguageServiceRuntimeBoundary =
  createLanguageServiceRuntimeBoundary(() =>
    import("./LanguageServiceRuntime"),
  );
