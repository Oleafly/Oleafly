// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { createRef, forwardRef, Suspense } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { lazy, stopWarming } from "./preloadable";

const WAITING = "Waiting";
const FAILED = "Failed";
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
  vi.restoreAllMocks();
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

  it("surfaces a failed load to the error boundary once, then tries the import again on a later mount", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const load = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ default: Hello });
    const View = lazy(load);
    const failed = render(
      <ErrorBoundary fallback={<p>{FAILED}</p>}>
        <Suspense fallback={<p>{WAITING}</p>}>
          <View name="Ada" />
        </Suspense>
      </ErrorBoundary>,
    );
    expect(await screen.findByText(FAILED)).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);
    failed.unmount();
    vi.setSystemTime(Date.now() + 60_000);
    shown(<View name="Ada" />);
    expect(await screen.findByText("Hello Ada")).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
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


type Warming = typeof import("./preloadable");

async function fresh(idle?: (run: IdleRequestCallback) => number): Promise<Warming> {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubGlobal("requestIdleCallback", idle);
  vi.stubGlobal("cancelIdleCallback", idle ? vi.fn() : undefined);
  return import("./preloadable");
}

async function pastStartup(warming: Warming) {
  await vi.advanceTimersByTimeAsync(warming.STARTUP_MS);
}

function input(type: string, init: MouseEventInit = {}) {
  act(() => void window.dispatchEvent(new MouseEvent(type, init)));
}

describe("warming views ahead of time", () => {
  it("waits for the start and a quiet startup, then loads one wanted view per idle moment and skips the rest", async () => {
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
    await vi.advanceTimersByTimeAsync(warming.STARTUP_MS * 2);
    expect(order).toEqual([]);
    const onError = vi.fn();
    warming.startWarming(onError);
    await vi.advanceTimersByTimeAsync(warming.STARTUP_MS - 1);
    expect(order).toEqual([]);
    await vi.advanceTimersByTimeAsync(warming.IDLE_FALLBACK_MS + 1);
    expect(order).toEqual(["first"]);
    expect(First.loaded()).toBe(true);
    await vi.advanceTimersByTimeAsync(warming.IDLE_FALLBACK_MS * 2);
    expect(order).toEqual(["first", "broken"]);
    expect(Skipped.loaded()).toBe(false);
    expect(Broken.loaded()).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "missing chunk" }));
    const Later = warming.lazy(loading(order, "later"), { warm: true });
    await vi.advanceTimersByTimeAsync(warming.IDLE_FALLBACK_MS);
    expect(Later.loaded()).toBe(true);
    expect(warming.warmingQueueLength()).toBe(1);
  });

  it("waits for a quiet moment after input, warms higher priorities first and rewarms skipped views on request", async () => {
    const warming = await fresh();
    const order: string[] = [];
    let wanted = false;
    warming.lazy(loading(order, "later"), { warm: () => wanted });
    warming.lazy(loading(order, "second"), { warm: true });
    warming.lazy(loading(order, "first"), { warm: true, priority: 1 });
    warming.startWarming(vi.fn());
    await pastStartup(warming);
    input("keydown");
    await vi.advanceTimersByTimeAsync(warming.QUIET_MS - 1);
    expect(order).toEqual([]);
    await vi.advanceTimersByTimeAsync(warming.IDLE_FALLBACK_MS + 1);
    expect(order).toEqual(["first"]);
    await vi.advanceTimersByTimeAsync(warming.IDLE_FALLBACK_MS * 3);
    expect(order).toEqual(["first", "second"]);
    wanted = true;
    warming.warmDeferred();
    await vi.advanceTimersByTimeAsync(warming.IDLE_FALLBACK_MS);
    expect(order).toEqual(["first", "second", "later"]);
  });

  it("loads an intent-only view at once on intent and never on the timer, then warms the views gated on that intent", async () => {
    const warming = await fresh();
    const order: string[] = [];
    const Heavy = warming.lazy(loading(order, "heavy"), { intent: "composer" });
    warming.lazy(loading(order, "tab"), { warm: () => warming.intended("composer") });
    warming.startWarming(vi.fn());
    await vi.advanceTimersByTimeAsync(warming.STARTUP_MS * 10);
    expect(order).toEqual([]);
    expect(warming.intended("composer")).toBe(false);
    const { onPointerEnter, onFocus } = warming.intentProps("composer");
    onPointerEnter();
    onFocus();
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(["heavy"]);
    expect(Heavy.loaded()).toBe(true);
    expect(warming.intended("composer")).toBe(true);
    await vi.advanceTimersByTimeAsync(warming.IDLE_FALLBACK_MS);
    expect(order).toEqual(["heavy", "tab"]);
    warming.preloadIntent("unknown");
    await vi.advanceTimersByTimeAsync(warming.IDLE_FALLBACK_MS);
    expect(order).toEqual(["heavy", "tab"]);
  });

  it.each([
    ["a drag with the button held", "pointermove", { buttons: 1 }],
    ["a window resize", "resize", {}],
    ["a scroll", "scroll", {}],
    ["a wheel turn", "wheel", {}],
    ["typing that arrives without a key press", "beforeinput", {}],
    ["an edit event", "input", {}],
  ])("counts %s as input", async (_name, type, init) => {
    const warming = await fresh();
    const order: string[] = [];
    warming.lazy(loading(order, "view"), { warm: true });
    warming.startWarming(vi.fn());
    await pastStartup(warming);
    for (let step = 0; step < 4; step++) {
      input(type, init);
      await vi.advanceTimersByTimeAsync(warming.QUIET_MS / 2);
    }
    expect(order).toEqual([]);
    await vi.advanceTimersByTimeAsync(warming.QUIET_MS + warming.IDLE_FALLBACK_MS);
    expect(order).toEqual(["view"]);
  });

  it("ignores a hover with no button held", async () => {
    const warming = await fresh();
    const order: string[] = [];
    warming.lazy(loading(order, "view"), { warm: true });
    warming.startWarming(vi.fn());
    await pastStartup(warming);
    input("pointermove", { buttons: 0 });
    await vi.advanceTimersByTimeAsync(warming.IDLE_FALLBACK_MS);
    expect(order).toEqual(["view"]);
  });

  it("waits while a button is held still or the pointer is captured", async () => {
    const warming = await fresh();
    const order: string[] = [];
    warming.lazy(loading(order, "first"), { warm: true });
    warming.lazy(loading(order, "second"), { warm: true });
    warming.startWarming(vi.fn());
    await pastStartup(warming);
    input("pointerdown", { buttons: 1 });
    await vi.advanceTimersByTimeAsync(warming.QUIET_MS * 4);
    expect(order).toEqual([]);
    input("pointerup");
    await vi.advanceTimersByTimeAsync(warming.QUIET_MS + warming.IDLE_FALLBACK_MS);
    expect(order).toEqual(["first"]);
    input("gotpointercapture");
    await vi.advanceTimersByTimeAsync(warming.QUIET_MS * 4);
    expect(order).toEqual(["first"]);
    input("lostpointercapture");
    await vi.advanceTimersByTimeAsync(warming.QUIET_MS + warming.IDLE_FALLBACK_MS);
    expect(order).toEqual(["first", "second"]);
  });

  it("lets go of a held button when the window loses focus", async () => {
    const warming = await fresh();
    const order: string[] = [];
    warming.lazy(loading(order, "view"), { warm: true });
    warming.startWarming(vi.fn());
    await pastStartup(warming);
    input("pointerdown", { buttons: 1 });
    input("gotpointercapture");
    const field = document.createElement("input");
    document.body.append(field);
    act(() => void field.dispatchEvent(new FocusEvent("blur")));
    await vi.advanceTimersByTimeAsync(warming.QUIET_MS * 4);
    expect(order).toEqual([]);
    act(() => void window.dispatchEvent(new FocusEvent("blur")));
    await vi.advanceTimersByTimeAsync(warming.QUIET_MS + warming.IDLE_FALLBACK_MS);
    expect(order).toEqual(["view"]);
    field.remove();
  });

  it("waits again when the fallback timer fires late behind a long task", async () => {
    const warming = await fresh();
    const order: string[] = [];
    warming.lazy(loading(order, "view"), { warm: true });
    warming.startWarming(vi.fn());
    await vi.advanceTimersByTimeAsync(warming.STARTUP_MS - 1);
    await vi.advanceTimersByTimeAsync(1);
    vi.setSystemTime(Date.now() + warming.LATE_MS * 4);
    await vi.advanceTimersByTimeAsync(warming.IDLE_FALLBACK_MS);
    expect(order).toEqual([]);
    await vi.advanceTimersByTimeAsync(warming.IDLE_FALLBACK_MS);
    expect(order).toEqual(["view"]);
  });

  it("needs a roomy idle deadline, however long the thread stays busy", async () => {
    const idle: IdleRequestCallback[] = [];
    const warming = await fresh((run) => idle.push(run));
    const order: string[] = [];
    warming.lazy(loading(order, "first"), { warm: true });
    warming.lazy(loading(order, "second"), { warm: true });
    warming.startWarming(vi.fn());
    await pastStartup(warming);
    const offer = async (left: number, didTimeout = false) => {
      const run = idle.shift();
      await act(async () => run?.({ didTimeout, timeRemaining: () => left }));
    };
    await offer(warming.MIN_IDLE_MS - 1);
    await offer(warming.MIN_IDLE_MS + 30, true);
    expect(order).toEqual([]);
    await offer(warming.MIN_IDLE_MS);
    expect(order).toEqual(["first"]);
    for (let tick = 0; tick < 20; tick++) {
      vi.setSystemTime(Date.now() + warming.STARTUP_MS);
      await offer(1);
    }
    expect(order).toEqual(["first"]);
    await offer(warming.MIN_IDLE_MS);
    expect(order).toEqual(["first", "second"]);
  });

  it("keeps a waiting view when stopped and starts there again after a fresh startup delay", async () => {
    const warming = await fresh();
    const order: string[] = [];
    warming.startWarming(vi.fn());
    warming.lazy(loading(order, "kept"), { warm: true });
    warming.stopWarming();
    await vi.advanceTimersByTimeAsync(warming.STARTUP_MS * 2);
    expect(order).toEqual([]);
    expect(warming.warmingQueueLength()).toBe(1);
    warming.startWarming(vi.fn());
    await vi.advanceTimersByTimeAsync(warming.STARTUP_MS + warming.IDLE_FALLBACK_MS);
    expect(order).toEqual(["kept"]);
  });

  it("stops before the next view and stops listening for input", async () => {
    const warming = await fresh();
    warming.startWarming(vi.fn());
    const First = warming.lazy(async () => ({ default: Hello }), { warm: true });
    const Second = warming.lazy(async () => ({ default: Hello }), { warm: true });
    await vi.advanceTimersByTimeAsync(warming.STARTUP_MS + warming.IDLE_FALLBACK_MS);
    warming.stopWarming();
    input("pointerdown", { buttons: 1 });
    await vi.advanceTimersByTimeAsync(warming.STARTUP_MS * 3);
    expect(First.loaded()).toBe(true);
    expect(Second.loaded()).toBe(false);
    warming.startWarming(vi.fn());
    await vi.advanceTimersByTimeAsync(warming.STARTUP_MS + warming.IDLE_FALLBACK_MS);
    expect(Second.loaded()).toBe(true);
  });
});
