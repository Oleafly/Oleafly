import { describe, expect, it } from "vitest";
import { createPdfLayerQueue, type PdfLayerQueue } from "./pdfLayerQueue";

function manualTasks() {
  const tasks: Array<() => void> = [];
  return {
    schedule: (run: () => void) => {
      tasks.push(run);
    },
    async drain() {
      for (let guard = 0; guard < 100; guard++) {
        await Promise.resolve();
        await Promise.resolve();
        const next = tasks.shift();
        if (!next) return;
        next();
      }
    },
  };
}

function build(queue: PdfLayerQueue, page: number, order: number[], isCurrent = () => true) {
  return queue.acquire(page, isCurrent).then((release) => {
    if (!release) return;
    order.push(page);
    release();
  });
}

describe("createPdfLayerQueue", () => {
  it("gives one page at a time its turn, nearest page first", async () => {
    const tasks = manualTasks();
    const order: number[] = [];
    const queue = createPdfLayerQueue((page) => Math.abs(page - 5), tasks.schedule);
    for (const page of [1, 9, 5, 4]) void build(queue, page, order);
    expect(order).toEqual([]);
    await tasks.drain();
    expect(order).toEqual([5, 4, 1, 9]);
  });

  it("waits while paused and resumes in priority order", async () => {
    const tasks = manualTasks();
    const order: number[] = [];
    const queue = createPdfLayerQueue((page) => page, tasks.schedule);
    queue.setPaused(true);
    void build(queue, 3, order);
    void build(queue, 2, order);
    await tasks.drain();
    expect(order).toEqual([]);
    queue.setPaused(false);
    await tasks.drain();
    expect(order).toEqual([2, 3]);
  });

  it("turns away pages that are no longer current", async () => {
    const tasks = manualTasks();
    const order: number[] = [];
    let current = true;
    const queue = createPdfLayerQueue((page) => page, tasks.schedule);
    const dropped = queue.acquire(1, () => current);
    void build(queue, 2, order);
    current = false;
    await tasks.drain();
    await expect(dropped).resolves.toBeNull();
    expect(order).toEqual([2]);
  });

  it("holds the next page until the current one releases its turn", async () => {
    const tasks = manualTasks();
    const order: number[] = [];
    const queue = createPdfLayerQueue((page) => page, tasks.schedule);
    let release: (() => void) | null = null;
    void queue.acquire(1, () => true).then((granted) => {
      release = granted;
    });
    void build(queue, 2, order);
    await tasks.drain();
    expect(release).not.toBeNull();
    expect(order).toEqual([]);
    release!();
    release!();
    await tasks.drain();
    expect(order).toEqual([2]);
  });

  it("answers every waiting page with no turn when cleared", async () => {
    const tasks = manualTasks();
    const queue = createPdfLayerQueue((page) => page, tasks.schedule);
    queue.setPaused(true);
    const waiting = queue.acquire(1, () => true);
    queue.clear();
    await expect(waiting).resolves.toBeNull();
    expect(queue.size()).toBe(0);
  });

  it("runs each turn in a task of its own by default", async () => {
    const order: string[] = [];
    const queue = createPdfLayerQueue((page) => page);
    const granted = queue.acquire(1, () => true).then((release) => {
      order.push("granted");
      release?.();
    });
    await Promise.resolve();
    order.push("same task");
    await granted;
    expect(order).toEqual(["same task", "granted"]);
  });
});
