import { describe, expect, it, vi } from "vitest";
import { DeltaQueues, MAX_BATCH, ManualScheduler } from "./delta-queues";

describe("DeltaQueues", () => {
  it("applies text deltas in order when a frame runs", () => {
    const scheduler = new ManualScheduler();
    const queues = new DeltaQueues(scheduler);
    const seen: string[] = [];
    queues.enqueueFrameText(() => seen.push("a"));
    queues.enqueueFrameText(() => seen.push("b"));
    expect(seen).toEqual([]);
    scheduler.runFrame();
    expect(seen).toEqual(["a", "b"]);
    expect(queues.pendingFrameText()).toBe(0);
  });

  it("applies output deltas on the interval cadence and stops the timer once empty", () => {
    const scheduler = new ManualScheduler();
    const queues = new DeltaQueues(scheduler);
    const seen: string[] = [];
    queues.enqueueOutput(() => seen.push("x"));
    queues.enqueueOutput(() => seen.push("y"));
    scheduler.runInterval();
    expect(seen).toEqual(["x", "y"]);
    // The interval canceled itself once the queue drained.
    scheduler.runInterval();
    expect(seen).toEqual(["x", "y"]);
  });

  it("drains both queues before a terminal event", () => {
    const scheduler = new ManualScheduler();
    const queues = new DeltaQueues(scheduler);
    const order: string[] = [];
    queues.enqueueFrameText(() => order.push("text"));
    queues.enqueueOutput(() => order.push("output"));

    const deferred = queues.drainBeforeTerminal(() => order.push("terminal"));
    expect(deferred).toBeNull();
    expect(order).toEqual(["text", "output", "terminal"]);
  });

  it("returns a replay closure when a flush is still pending", () => {
    const scheduler = new ManualScheduler();
    const queues = new DeltaQueues(scheduler);
    const order: string[] = [];
    // Over the batch cap: leftovers stay queued after the drain.
    for (let i = 0; i < 600; i += 1) {
      queues.enqueueFrameText(() => order.push(`t${i}`));
    }
    const deferred = queues.drainBeforeTerminal(() => order.push("terminal"));
    expect(deferred).toBeInstanceOf(Function);
    expect(order[order.length - 1]).not.toBe("terminal");
    expect(queues.pendingFrameText()).toBeGreaterThan(0);
    // The host drains again and replays the terminal event.
    const replay = deferred as () => void;
    const second = queues.drainBeforeTerminal(replay);
    expect(second).toBeNull();
    expect(order[order.length - 1]).toBe("terminal");
  });

  it("does not let a queued callback recursively bypass the frame batch cap", () => {
    const scheduler = new ManualScheduler();
    const queues = new DeltaQueues(scheduler);
    let applied = 0;
    for (let index = 0; index < 1_000; index += 1) {
      queues.enqueueFrameText(() => {
        applied += 1;
        queues.flushFrameText();
      });
    }

    scheduler.runFrame();

    expect(applied).toBe(512);
    expect(queues.pendingFrameText()).toBe(488);
    scheduler.runFrame();
    expect(applied).toBe(1_000);
    expect(queues.pendingFrameText()).toBe(0);
  });

  it("dispose cancels scheduled work and clears the queues", () => {
    const scheduler = new ManualScheduler();
    const queues = new DeltaQueues(scheduler);
    const seen: string[] = [];
    queues.enqueueFrameText(() => seen.push("a"));
    queues.enqueueOutput(() => seen.push("b"));
    queues.dispose();
    scheduler.runFrame();
    scheduler.runInterval();
    expect(seen).toEqual([]);
  });
});

describe("DeltaQueues terminal and output edges", () => {
  it("applies a terminal event at once when nothing is queued or scheduled", () => {
    const queues = new DeltaQueues(new ManualScheduler());
    const terminal = vi.fn();
    expect(queues.drainBeforeTerminal(terminal)).toBeNull();
    expect(terminal).toHaveBeenCalledOnce();
  });

  it("still drains through a scheduled frame whose queue was already flushed", () => {
    const scheduler = new ManualScheduler();
    const queues = new DeltaQueues(scheduler);
    const order: string[] = [];
    queues.enqueueFrameText(() => order.push("text"));
    expect(queues.flushFrameText()).toBe("flushed");
    expect(queues.flushFrameText()).toBe("empty");

    expect(queues.drainBeforeTerminal(() => order.push("terminal"))).toBeNull();
    expect(order).toEqual(["text", "terminal"]);
  });

  it("keeps the output interval running while output is over the batch cap", () => {
    const scheduler = new ManualScheduler();
    const queues = new DeltaQueues(scheduler);
    let applied = 0;
    for (let index = 0; index < MAX_BATCH + 10; index += 1) {
      queues.enqueueOutput(() => {
        applied += 1;
      });
    }

    const terminal = vi.fn();
    const deferred = queues.drainBeforeTerminal(terminal);
    expect(deferred).toBe(terminal);
    expect(terminal).not.toHaveBeenCalled();
    expect(applied).toBe(MAX_BATCH);
    expect(queues.pendingOutput()).toBe(10);

    scheduler.runInterval();
    expect(applied).toBe(MAX_BATCH + 10);
    expect(queues.pendingOutput()).toBe(0);
    expect(queues.drainBeforeTerminal(terminal)).toBeNull();
    expect(terminal).toHaveBeenCalledOnce();
  });

  it("ignores an output flush requested from inside an output delta", () => {
    const scheduler = new ManualScheduler();
    const queues = new DeltaQueues(scheduler);
    const nested: string[] = [];
    queues.enqueueOutput(() => nested.push(queues.flushOutput()));
    queues.enqueueOutput(() => nested.push("second"));
    scheduler.runInterval();
    expect(nested).toEqual(["empty", "second"]);
  });

  it("reports the visibility a test sets on the manual scheduler", () => {
    const scheduler = new ManualScheduler();
    expect(scheduler.isVisible()).toBe(true);
    scheduler.visible = false;
    expect(scheduler.isVisible()).toBe(false);
  });
});
