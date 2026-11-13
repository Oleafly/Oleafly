// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enErrors from "@/i18n/locales/en/errors.json" with { type: "json" };
import { describeError } from "@/lib/app-error";
import type { D2Reply, D2Request } from "./d2.worker";
import { cachedD2, D2_IDLE_MS, D2_THEMES, d2Problems, renderD2, resetD2ForTest } from "./d2-render";

class FakeWorker {
  static made: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<D2Reply>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly requests: D2Request[] = [];
  terminated = false;

  constructor(
    readonly url: URL,
    readonly options: WorkerOptions,
  ) {
    FakeWorker.made.push(this);
  }

  postMessage(request: D2Request): void {
    this.requests.push(request);
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(reply: D2Reply): void {
    this.onmessage?.({ data: reply } as MessageEvent<D2Reply>);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeWorker.made = [];
  vi.stubGlobal("Worker", FakeWorker);
});

afterEach(() => {
  resetD2ForTest();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("D2 rendering", () => {
  it("starts one module worker lazily and matches replies to requests", async () => {
    const first = renderD2("a -> b", "light");
    const second = renderD2("x -> y", "dark");
    const [worker] = FakeWorker.made;
    expect(FakeWorker.made).toHaveLength(1);
    expect(worker.options).toEqual({ type: "module" });
    expect(worker.url.pathname).toMatch(/d2\.worker\.ts$/u);
    expect(worker.requests).toEqual([
      { id: 1, source: "a -> b", theme: D2_THEMES.light, background: null },
      { id: 2, source: "x -> y", theme: D2_THEMES.dark, background: null },
    ]);
    worker.reply({ id: 2, svg: "<svg>xy</svg>" });
    worker.reply({ id: 1, svg: "<svg>ab</svg>" });
    await expect(first).resolves.toBe("<svg>ab</svg>");
    await expect(second).resolves.toBe("<svg>xy</svg>");
    expect(cachedD2("a -> b", "light")).toBe("<svg>ab</svg>");
    expect(cachedD2("a -> b", "dark")).toBeUndefined();
  });

  it("keeps drawings for different canvas colours apart", async () => {
    const dark = renderD2("a -> b", "dark", "#0a0a0a");
    const dim = renderD2("a -> b", "dark", "#181818");
    expect(FakeWorker.made[0].requests.map((request) => request.background)).toEqual(["#0a0a0a", "#181818"]);
    FakeWorker.made[0].reply({ id: 1, svg: "<svg>black</svg>" });
    FakeWorker.made[0].reply({ id: 2, svg: "<svg>grey</svg>" });
    await Promise.all([dark, dim]);
    expect(cachedD2("a -> b", "dark", "#181818")).toBe("<svg>grey</svg>");
    expect(cachedD2("a -> b", "dark")).toBeUndefined();
  });

  it("shares a running render and answers repeats from the cache", async () => {
    const one = renderD2("a -> b", "light");
    expect(renderD2("a -> b", "light")).toBe(one);
    FakeWorker.made[0].reply({ id: 1, svg: "<svg/>" });
    await one;
    await expect(renderD2("a -> b", "light")).resolves.toBe("<svg/>");
    expect(FakeWorker.made[0].requests).toHaveLength(1);
  });

  it("rejects with the compiler's message and tries again next time", async () => {
    const failed = renderD2("a -> {", "light");
    FakeWorker.made[0].reply({ id: 1, error: "bad" });
    await expect(failed).rejects.toThrow("bad");
    const again = renderD2("a -> {", "light");
    expect(FakeWorker.made[0].requests).toHaveLength(2);
    FakeWorker.made[0].reply({ id: 2, svg: "<svg/>" });
    await expect(again).resolves.toBe("<svg/>");
  });

  it("stops the worker after a quiet spell and starts a new one when needed", async () => {
    const one = renderD2("a", "light");
    FakeWorker.made[0].reply({ id: 1, svg: "<svg/>" });
    await one;
    await vi.advanceTimersByTimeAsync(D2_IDLE_MS - 1);
    expect(FakeWorker.made[0].terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeWorker.made[0].terminated).toBe(true);
    void renderD2("b", "light");
    expect(FakeWorker.made).toHaveLength(2);
  });

  it("fails every waiting render when the worker crashes", async () => {
    const one = renderD2("a", "light");
    const two = renderD2("b", "light");
    const worker = FakeWorker.made[0];
    const event = { message: "out of memory", preventDefault: vi.fn() } as unknown as ErrorEvent;
    worker.onerror?.(event);
    await expect(one).rejects.toThrow("out of memory");
    await expect(two).rejects.toThrow("out of memory");
    expect(worker.terminated).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("explains a worker that fails without a message in the reader's language", async () => {
    const started = renderD2("a", "light");
    FakeWorker.made[0].reply({ id: 1, failure: "not_started" });
    const notStarted = await started.catch((error: unknown) => error);
    expect(describeError(notStarted)).toBe(enErrors.notes.d2_not_started);
    expect(d2Problems(notStarted)).toEqual([]);
    const silent = renderD2("b", "light");
    FakeWorker.made[0].reply({ id: 2, failure: "failed" });
    expect(describeError(await silent.catch((error: unknown) => error))).toBe(enErrors.notes.d2_failed);
    const crashed = renderD2("c", "light");
    FakeWorker.made[0].onerror?.({ message: "", preventDefault: vi.fn() } as unknown as ErrorEvent);
    expect(describeError(await crashed.catch((error: unknown) => error))).toBe(enErrors.notes.d2_stopped);
  });

  it("drops older drawings once the kept SVGs grow too large", async () => {
    const big = `<svg>${"x".repeat(2_500_000)}</svg>`;
    const first = renderD2("a", "light");
    FakeWorker.made[0].reply({ id: 1, svg: big });
    await first;
    const second = renderD2("b", "light");
    FakeWorker.made[0].reply({ id: 2, svg: big });
    await second;
    expect(cachedD2("a", "light")).toBeUndefined();
    expect(cachedD2("b", "light")).toBe(big);
  });
});

describe("d2Problems", () => {
  it("reads D2's located error list and plain messages", () => {
    expect(
      d2Problems(
        new Error(
          JSON.stringify([
            { range: "index,0:0:0-0:5:5", errmsg: "index:1:1: connection missing destination" },
            { range: "index,0:5:5-0:6:6", errmsg: "index:2:6: maps must be terminated with }" },
          ]),
        ),
      ),
    ).toEqual([
      { line: 1, message: "connection missing destination" },
      { line: 2, message: "maps must be terminated with }" },
    ]);
    expect(d2Problems(new Error("failed to ELK layout"))).toEqual([{ line: null, message: "failed to ELK layout" }]);
    expect(d2Problems("[1, {}]")).toEqual([]);
  });
});
