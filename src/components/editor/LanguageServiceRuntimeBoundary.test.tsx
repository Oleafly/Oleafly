// @vitest-environment jsdom
import {
  act,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ logError: vi.fn(async () => {}) }));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));
import { LATEX_ENGINE, UNKNOWN_ENGINE } from "@/lib/document-engine";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";
import { useToastStore } from "@/store/toast";
import {
  LanguageServiceKeeper,
  type LanguageServiceKeeperController,
} from "./LanguageServiceKeeper";
import {
  createLanguageServiceRuntimeBoundary,
  LanguageServiceRuntimeUnavailable,
  silentRetryDelay,
  useLanguageServiceRuntimeUnavailable,
  useSilentRetry,
  type LanguageServiceRuntimeModule,
  type SilentRetryPolicy,
} from "./LanguageServiceRuntimeBoundary";

const RUNTIME_SCOPE = "language service runtime";
const HARNESS_SCOPE = "harness";
const RUNTIME_MARKER = "language-runtime";
const FAST_POLICY: SilentRetryPolicy = { baseMs: 100, maxMs: 400, limit: 3 };

beforeEach(() => {
  useToastStore.getState().reset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  useFilesStore.setState({
    projectId: null,
    mainDoc: "main.tex",
    engine: UNKNOWN_ENGINE,
    engineLoaded: false,
    tree: [],
    files: {},
    openTabs: [],
    activePath: null,
  });
  useIndexStore.getState().reset();
});

function deferredRuntimeModule() {
  let resolve!: (module: LanguageServiceRuntimeModule) => void;
  const promise = new Promise<LanguageServiceRuntimeModule>(
    (resolvePromise) => {
      resolve = resolvePromise;
    },
  );
  return { promise, resolve };
}

function MarkerRuntime() {
  return <span data-testid={RUNTIME_MARKER} />;
}

const UNAVAILABLE_MARKER = "runtime-unavailable";

function AvailabilityProbe() {
  const unavailable = useLanguageServiceRuntimeUnavailable();
  return unavailable ? <span data-testid={UNAVAILABLE_MARKER} /> : null;
}

function crashingRuntime(shouldCrash: () => boolean) {
  return function CrashingRuntime() {
    useEffect(() => {
      if (shouldCrash()) throw new Error("runtime crashed");
    }, []);
    return <MarkerRuntime />;
  };
}

function crashesFirst(count: number) {
  let mounts = 0;
  return () => {
    mounts += 1;
    return mounts <= count;
  };
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function advanceInSteps(steps: number, ms: number) {
  for (let step = 0; step < steps; step += 1) {
    await advance(ms);
  }
}

function quietReactErrors() {
  vi.spyOn(console, "error").mockImplementation(() => {});
}

describe("silentRetryDelay", () => {
  it("doubles from the base, keeps half the window as jitter and never passes the cap", () => {
    const policy: SilentRetryPolicy = { baseMs: 1_000, maxMs: 8_000, limit: 10 };

    expect(silentRetryDelay(0, policy, () => 0)).toBe(500);
    expect(silentRetryDelay(0, policy, () => 1)).toBe(1_000);
    expect(silentRetryDelay(2, policy, () => 1)).toBe(4_000);
    expect(silentRetryDelay(9, policy, () => 1)).toBe(8_000);
    expect(silentRetryDelay(9, policy, () => 0)).toBe(4_000);
    expect(silentRetryDelay(5_000, policy, () => 1)).toBe(8_000);
  });
});

function RetryHarness({
  failing,
  recovered,
  retry,
  detail,
  resetKey,
}: {
  failing: boolean;
  recovered: boolean;
  retry: () => void;
  detail?: string;
  resetKey?: string;
}) {
  useSilentRetry({
    failing,
    recovered,
    retry,
    policy: { baseMs: 100, maxMs: 1_000, limit: Number.POSITIVE_INFINITY },
    scope: HARNESS_SCOPE,
    detail,
    resetKey,
  });
  return null;
}

describe("useSilentRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(1);
  });

  it("backs off exponentially while the failure lasts and starts over after a recovery", async () => {
    const retry = vi.fn();
    const view = render(
      <RetryHarness failing recovered={false} retry={retry} detail="down" />,
    );

    await advance(99);
    expect(retry).not.toHaveBeenCalled();
    await advance(1);
    expect(retry).toHaveBeenCalledTimes(1);
    await advance(199);
    expect(retry).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(retry).toHaveBeenCalledTimes(2);

    view.rerender(
      <RetryHarness failing={false} recovered retry={retry} detail="down" />,
    );
    await advance(5_000);
    expect(retry).toHaveBeenCalledTimes(2);

    view.rerender(
      <RetryHarness failing recovered={false} retry={retry} detail="down" />,
    );
    await advance(100);
    expect(retry).toHaveBeenCalledTimes(3);
  });

  it("logs a failure once per episode, however many retries run", async () => {
    const retry = vi.fn();
    const view = render(
      <RetryHarness failing recovered={false} retry={retry} detail="down" />,
    );
    await advanceInSteps(40, 50);
    expect(retry).toHaveBeenCalledTimes(4);
    expect(mocks.logError).toHaveBeenCalledTimes(1);
    expect(mocks.logError).toHaveBeenCalledWith(HARNESS_SCOPE, "down");

    view.rerender(
      <RetryHarness failing={false} recovered retry={retry} detail="down" />,
    );
    view.rerender(
      <RetryHarness failing recovered={false} retry={retry} detail="down" />,
    );
    expect(mocks.logError).toHaveBeenCalledTimes(2);
  });

  it("stops retrying when the owner unmounts", async () => {
    const retry = vi.fn();
    const view = render(
      <RetryHarness failing recovered={false} retry={retry} />,
    );
    view.unmount();
    await advance(10_000);
    expect(retry).not.toHaveBeenCalled();
  });

  it("starts the backoff over for a new reset key", async () => {
    const retry = vi.fn();
    const view = render(
      <RetryHarness failing recovered={false} retry={retry} resetKey="a" />,
    );
    await advanceInSteps(14, 50);
    expect(retry).toHaveBeenCalledTimes(3);

    view.rerender(
      <RetryHarness failing={false} recovered={false} retry={retry} resetKey="b" />,
    );
    view.rerender(
      <RetryHarness failing recovered={false} retry={retry} resetKey="b" />,
    );
    await advance(100);
    expect(retry).toHaveBeenCalledTimes(4);
  });
});

describe("LanguageServiceRuntimeBoundary", () => {
  it("keeps the fallback silent and marks the runtime unavailable in place", () => {
    const { container } = render(<LanguageServiceRuntimeUnavailable />);
    render(<AvailabilityProbe />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.getByTestId(UNAVAILABLE_MARKER)).toBeInTheDocument();
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it("does not retry a runtime chunk that failed to load and reports it in place", async () => {
    vi.useFakeTimers();
    quietReactErrors();
    const loadRuntime = vi
      .fn<() => Promise<LanguageServiceRuntimeModule>>()
      .mockRejectedValue(new Error("chunk failed"));
    const Boundary = createLanguageServiceRuntimeBoundary(loadRuntime, FAST_POLICY);
    render(
      <>
        <Boundary />
        <AvailabilityProbe />
      </>,
    );

    await advanceInSteps(20, FAST_POLICY.maxMs);
    expect(loadRuntime).toHaveBeenCalledTimes(1);
    expect(mocks.logError).toHaveBeenCalledWith(
      RUNTIME_SCOPE,
      expect.objectContaining({ message: "chunk failed" }),
    );
    expect(screen.getByTestId(UNAVAILABLE_MARKER)).toBeInTheDocument();
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it("retries a runtime that crashed while rendering and mounts it again", async () => {
    vi.useFakeTimers();
    quietReactErrors();
    const Runtime = crashingRuntime(crashesFirst(1));
    const loadRuntime = vi
      .fn<() => Promise<LanguageServiceRuntimeModule>>()
      .mockResolvedValue({ LanguageServiceRuntime: Runtime });
    const Boundary = createLanguageServiceRuntimeBoundary(loadRuntime, FAST_POLICY);
    render(
      <>
        <Boundary />
        <AvailabilityProbe />
      </>,
    );

    await advance(0);
    expect(screen.queryByTestId(RUNTIME_MARKER)).toBeNull();
    expect(mocks.logError).toHaveBeenCalledWith(
      RUNTIME_SCOPE,
      expect.objectContaining({ message: "runtime crashed" }),
    );

    await advance(FAST_POLICY.baseMs);
    expect(loadRuntime).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId(RUNTIME_MARKER)).toBeInTheDocument();
    await advance(FAST_POLICY.maxMs);
    expect(loadRuntime).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId(UNAVAILABLE_MARKER)).toBeNull();
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it("starts the retry budget over once the runtime has stayed up", async () => {
    vi.useFakeTimers();
    quietReactErrors();
    let crash = true;
    let rerenderRuntime: (() => void) | null = null;
    function FlakyRuntime() {
      const [, setTick] = useState(0);
      useEffect(() => {
        rerenderRuntime = () => setTick((tick) => tick + 1);
      }, []);
      if (crash) throw new Error("runtime crashed");
      return <MarkerRuntime />;
    }
    const loadRuntime = vi
      .fn<() => Promise<LanguageServiceRuntimeModule>>()
      .mockResolvedValue({ LanguageServiceRuntime: FlakyRuntime });
    const Boundary = createLanguageServiceRuntimeBoundary(loadRuntime, FAST_POLICY);
    render(<Boundary />);

    await advance(0);
    await advance(FAST_POLICY.baseMs);
    await advance(FAST_POLICY.baseMs * 2);
    expect(loadRuntime).toHaveBeenCalledTimes(3);
    crash = false;
    await advanceInSteps(4, FAST_POLICY.maxMs);
    expect(screen.getByTestId(RUNTIME_MARKER)).toBeInTheDocument();
    const loadsBeforeSecondCrash = loadRuntime.mock.calls.length;

    crash = true;
    act(() => rerenderRuntime?.());
    await advanceInSteps(20, FAST_POLICY.maxMs);
    expect(loadRuntime.mock.calls.length - loadsBeforeSecondCrash).toBe(FAST_POLICY.limit);
  });

  it("gives up quietly after the retry limit and reports it in place", async () => {
    vi.useFakeTimers();
    quietReactErrors();
    const loadRuntime = vi
      .fn<() => Promise<LanguageServiceRuntimeModule>>()
      .mockResolvedValue({ LanguageServiceRuntime: crashingRuntime(() => true) });
    const Boundary = createLanguageServiceRuntimeBoundary(
      loadRuntime,
      FAST_POLICY,
    );
    render(
      <>
        <Boundary />
        <AvailabilityProbe />
      </>,
    );

    await advanceInSteps(20, FAST_POLICY.maxMs);
    expect(loadRuntime).toHaveBeenCalledTimes(1 + FAST_POLICY.limit);
    expect(mocks.logError).toHaveBeenCalledWith(
      RUNTIME_SCOPE,
      `stopped retrying after ${FAST_POLICY.limit} attempts`,
    );
    await advanceInSteps(20, FAST_POLICY.maxMs);
    expect(loadRuntime).toHaveBeenCalledTimes(1 + FAST_POLICY.limit);
    expect(screen.getByTestId(UNAVAILABLE_MARKER)).toBeInTheDocument();
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it("cancels a pending retry when the boundary unmounts", async () => {
    vi.useFakeTimers();
    quietReactErrors();
    const loadRuntime = vi
      .fn<() => Promise<LanguageServiceRuntimeModule>>()
      .mockResolvedValue({ LanguageServiceRuntime: crashingRuntime(() => true) });
    const Boundary = createLanguageServiceRuntimeBoundary(
      loadRuntime,
      FAST_POLICY,
    );
    const view = render(<Boundary />);
    await advance(0);
    view.unmount();

    await advanceInSteps(20, FAST_POLICY.maxMs);
    expect(loadRuntime).toHaveBeenCalledTimes(1);
  });

  it("publishes the latest project snapshot after a deferred module resolves", async () => {
    useFilesStore.setState({
      projectId: "project-a",
      mainDoc: "main.tex",
      engine: LATEX_ENGINE,
      engineLoaded: true,
      tree: [{ path: "main.tex", is_dir: false }],
      files: {
        "main.tex": { content: "Initial", dirty: false },
      },
    });
    const controller: LanguageServiceKeeperController = {
      update: vi.fn(),
      dispose: vi.fn(async () => {}),
    };
    const deferred = deferredRuntimeModule();
    const loadRuntime = vi.fn(() => deferred.promise);
    const Boundary =
      createLanguageServiceRuntimeBoundary(loadRuntime);
    const Runtime = () => (
      <LanguageServiceKeeper controller={controller} />
    );
    const rendered = render(<Boundary />);

    expect(loadRuntime).toHaveBeenCalledTimes(1);
    expect(controller.update).not.toHaveBeenCalled();

    act(() => {
      useFilesStore.setState((state) => ({
        files: {
          ...state.files,
          "main.tex": { content: "Unsaved", dirty: true },
        },
      }));
    });
    await act(async () => {
      deferred.resolve({ LanguageServiceRuntime: Runtime });
      await deferred.promise;
    });

    await waitFor(() => {
      expect(controller.update).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "project-a",
          files: {
            "main.tex": { content: "Unsaved", dirty: true },
          },
        }),
      );
    });
    expect(controller.update).toHaveBeenCalledTimes(1);

    rendered.unmount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(controller.dispose).toHaveBeenCalledTimes(1);
  });

  it("does not mount a late runtime after the boundary unmounts", async () => {
    const controller: LanguageServiceKeeperController = {
      update: vi.fn(),
      dispose: vi.fn(async () => {}),
    };
    const deferred = deferredRuntimeModule();
    const Boundary = createLanguageServiceRuntimeBoundary(
      () => deferred.promise,
    );
    const Runtime = () => (
      <LanguageServiceKeeper controller={controller} />
    );
    const rendered = render(<Boundary />);

    rendered.unmount();
    act(() => {
      useFilesStore.setState({
        projectId: "project-after-unmount",
        engine: LATEX_ENGINE,
        engineLoaded: true,
      });
    });
    await act(async () => {
      deferred.resolve({ LanguageServiceRuntime: Runtime });
      await deferred.promise;
      await Promise.resolve();
    });

    expect(controller.update).not.toHaveBeenCalled();
    expect(controller.dispose).not.toHaveBeenCalled();
  });
});
