// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { createRef, forwardRef, Suspense } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IDLE_FALLBACK_MS, lazy, stopWarming, whenIdle } from "./preloadable";

const WAITING = "Waiting";
const FIELD = "field";

function loading(order: string[], name: string) {
  return async () => {
    order.push(name);
    return { default: Hello };
  };
}

function Hello({ name }: Readonly<{ name: string }>) {
  return <p>{`Hello ${name}`}</p>;
}

function shown(element: React.ReactNode) {
  return render(<Suspense fallback={<p>{WAITING}</p>}>{element}</Suspense>);
}

afterEach(() => {
  stopWarming();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("lazy", () => {
  it("renders directly once preloaded, with no fallback", async () => {
    const load = vi.fn(async () => ({ default: Hello }));
    const View = lazy(load);
    expect(View.loaded()).toBe(false);
    await View.preload();
    await View.preload();
    expect(load).toHaveBeenCalledTimes(1);
    expect(View.loaded()).toBe(true);
    shown(<View name="Ada" />);
    expect(screen.getByText("Hello Ada")).toBeInTheDocument();
    expect(screen.queryByText(WAITING)).toBeNull();
  });

  it("suspends until the code arrives when it was not preloaded, and keeps that choice", async () => {
    let finish: (module: { default: typeof Hello }) => void = () => {};
    const View = lazy(() => new Promise<{ default: typeof Hello }>((resolve) => (finish = resolve)));
    const view = shown(<View name="Ada" />);
    expect(screen.getByText(WAITING)).toBeInTheDocument();
    await act(async () => finish({ default: Hello }));
    expect(await screen.findByText("Hello Ada")).toBeInTheDocument();
    view.rerender(
      <Suspense fallback={<p>{WAITING}</p>}>
        <View name="Grace" />
      </Suspense>,
    );
    expect(screen.getByText("Hello Grace")).toBeInTheDocument();
  });

  it("loads again after a failed load", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ default: Hello });
    const View = lazy(load);
    await expect(View.preload()).rejects.toThrow("offline");
    expect(View.loaded()).toBe(false);
    await View.preload();
    expect(load).toHaveBeenCalledTimes(2);
    expect(View.loaded()).toBe(true);
  });

  it("passes a ref through to the loaded component", async () => {
    const Field = forwardRef<HTMLInputElement>((_props, ref) => <input ref={ref} aria-label={FIELD} />);
    const View = lazy(async () => ({ default: Field }));
    await View.preload();
    const ref = createRef<HTMLInputElement>();
    shown(<View ref={ref} />);
    expect(ref.current).toBe(screen.getByLabelText(FIELD));
  });
});

describe("warming views ahead of time", () => {
  async function fresh() {
    vi.resetModules();
    vi.useFakeTimers();
    vi.stubGlobal("requestIdleCallback", undefined);
    return import("./preloadable");
  }

  it("waits for the start, then loads one wanted view per idle moment and skips the rest", async () => {
    const warming = await fresh();
    const order: string[] = [];
    const First = warming.lazy(loading(order, "first"), { warm: true });
    const Skipped = warming.lazy(loading(order, "skipped"), { warm: () => false });
    const Broken = warming.lazy(
      async () => {
        order.push("broken");
        throw new Error("missing chunk");
      },
      { warm: true },
    );
    expect(warming.warmingQueueLength()).toBe(3);
    await vi.advanceTimersByTimeAsync(IDLE_FALLBACK_MS * 2);
    expect(order).toEqual([]);
    const onError = vi.fn();
    warming.startWarming(onError);
    await vi.advanceTimersByTimeAsync(IDLE_FALLBACK_MS);
    expect(order).toEqual(["first"]);
    expect(First.loaded()).toBe(true);
    await vi.advanceTimersByTimeAsync(IDLE_FALLBACK_MS * 2);
    expect(order).toEqual(["first", "broken"]);
    expect(Skipped.loaded()).toBe(false);
    expect(Broken.loaded()).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "missing chunk" }));
    const Later = warming.lazy(loading(order, "later"), { warm: true });
    await vi.advanceTimersByTimeAsync(IDLE_FALLBACK_MS);
    expect(Later.loaded()).toBe(true);
    warming.stopWarming();
  });

  it("waits for a quiet moment after input, warms higher priorities first and rewarms skipped views on request", async () => {
    const warming = await fresh();
    const order: string[] = [];
    let wanted = false;
    warming.lazy(loading(order, "heavy"), { warm: true, priority: warming.HEAVY });
    warming.lazy(loading(order, "later"), { warm: () => wanted });
    warming.lazy(loading(order, "first"), { warm: true, priority: 1 });
    warming.startWarming(vi.fn());
    window.dispatchEvent(new KeyboardEvent("keydown"));
    await vi.advanceTimersByTimeAsync(IDLE_FALLBACK_MS);
    expect(order).toEqual([]);
    await vi.advanceTimersByTimeAsync(warming.QUIET_MS + IDLE_FALLBACK_MS);
    expect(order).toEqual(["first"]);
    await vi.advanceTimersByTimeAsync(IDLE_FALLBACK_MS * 3);
    expect(order).toEqual(["first", "heavy"]);
    wanted = true;
    warming.warmDeferred();
    await vi.advanceTimersByTimeAsync(IDLE_FALLBACK_MS);
    expect(order).toEqual(["first", "heavy", "later"]);
    warming.stopWarming();
  });

  it("keeps the view it had taken when stopped and starts there again", async () => {
    const warming = await fresh();
    const order: string[] = [];
    warming.startWarming(vi.fn());
    warming.lazy(loading(order, "kept"), { warm: true });
    warming.stopWarming();
    await vi.advanceTimersByTimeAsync(IDLE_FALLBACK_MS * 2);
    expect(order).toEqual([]);
    warming.startWarming(vi.fn());
    await vi.advanceTimersByTimeAsync(IDLE_FALLBACK_MS);
    expect(order).toEqual(["kept"]);
    warming.stopWarming();
  });

  it("stops before the next view", async () => {
    const warming = await fresh();
    warming.startWarming(vi.fn());
    const First = warming.lazy(async () => ({ default: Hello }), { warm: true });
    const Second = warming.lazy(async () => ({ default: Hello }), { warm: true });
    await vi.advanceTimersByTimeAsync(IDLE_FALLBACK_MS);
    warming.stopWarming();
    await vi.advanceTimersByTimeAsync(IDLE_FALLBACK_MS * 3);
    expect(First.loaded()).toBe(true);
    expect(Second.loaded()).toBe(false);
  });
});

describe("whenIdle", () => {
  it("waits for an idle moment when the webview has idle callbacks", () => {
    const request = vi.fn((_run: () => void, _options: { timeout: number }) => 7);
    const cancel = vi.fn();
    vi.stubGlobal("requestIdleCallback", request);
    vi.stubGlobal("cancelIdleCallback", cancel);
    const run = vi.fn();
    const stop = whenIdle(run);
    expect(request).toHaveBeenCalledTimes(1);
    request.mock.calls[0][0]();
    expect(run).toHaveBeenCalledTimes(1);
    stop();
    expect(cancel).toHaveBeenCalledWith(7);
  });

  it("falls back to a short timer and can be cancelled", () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestIdleCallback", undefined);
    const run = vi.fn();
    whenIdle(run);
    vi.advanceTimersByTime(IDLE_FALLBACK_MS);
    expect(run).toHaveBeenCalledTimes(1);
    const later = vi.fn();
    const stop = whenIdle(later);
    stop();
    vi.advanceTimersByTime(IDLE_FALLBACK_MS);
    expect(later).not.toHaveBeenCalled();
  });
});
