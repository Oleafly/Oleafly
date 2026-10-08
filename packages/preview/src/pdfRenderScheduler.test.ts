// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPdfRenderScheduler,
  type PdfContinue,
  type PdfSchedulableTask,
} from "./pdfRenderScheduler";

interface FakeTask extends PdfSchedulableTask {
  continueChunk: () => void;
  settle: () => void;
  slices: number;
}

let frames: Array<FrameRequestCallback | null> = [];

function runFrame(): void {
  const pending = frames;
  frames = [];
  for (const callback of pending) callback?.(performance.now());
}

function fakeTask(): FakeTask {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  const task: FakeTask = {
    onContinue: null,
    promise,
    slices: 0,
    continueChunk() {
      (task.onContinue as PdfContinue | null)?.(() => {
        requestAnimationFrame(() => {
          task.slices++;
        });
      });
    },
    settle() {
      resolve();
    },
  };
  return task;
}

beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frames[id - 1] = null;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createPdfRenderScheduler", () => {
  it("lets at most one render slice run per animation frame", () => {
    const scheduler = createPdfRenderScheduler(() => 0);
    const tasks = [fakeTask(), fakeTask(), fakeTask()];
    tasks.forEach((task, index) => scheduler.add(task, index + 1, "base"));
    for (const task of tasks) task.continueChunk();

    runFrame();
    expect(tasks.reduce((sum, task) => sum + task.slices, 0)).toBe(1);
    runFrame();
    expect(tasks.reduce((sum, task) => sum + task.slices, 0)).toBe(2);
    runFrame();
    expect(tasks.reduce((sum, task) => sum + task.slices, 0)).toBe(3);
  });

  it("grants the next slice to the highest-priority waiting render", () => {
    const priority = new Map([
      [7, 50],
      [3, 0],
      [9, 10],
    ]);
    const scheduler = createPdfRenderScheduler((page) => priority.get(page) ?? 99);
    const first = fakeTask();
    const low = fakeTask();
    const visible = fakeTask();
    const near = fakeTask();
    scheduler.add(first, 1, "base");
    scheduler.add(low, 7, "base");
    scheduler.add(visible, 3, "base");
    scheduler.add(near, 9, "base");
    first.continueChunk();
    low.continueChunk();
    near.continueChunk();
    visible.continueChunk();

    runFrame();
    expect(first.slices).toBe(1);
    runFrame();
    expect(visible.slices).toBe(1);
    expect(near.slices + low.slices).toBe(0);
    runFrame();
    expect(near.slices).toBe(1);
    expect(low.slices).toBe(0);
    runFrame();
    expect(low.slices).toBe(1);
  });

  it("re-reads priorities when it grants, so a page scrolled into view jumps ahead", () => {
    const priority = new Map([
      [1, 0],
      [2, 5],
      [3, 9],
    ]);
    const scheduler = createPdfRenderScheduler((page) => priority.get(page) ?? 99);
    const [a, b, c] = [fakeTask(), fakeTask(), fakeTask()];
    scheduler.add(a, 1, "base");
    scheduler.add(b, 2, "base");
    scheduler.add(c, 3, "base");
    a.continueChunk();
    b.continueChunk();
    c.continueChunk();
    priority.set(3, -1);
    runFrame();
    runFrame();
    expect(c.slices).toBe(1);
    expect(b.slices).toBe(0);
  });

  it("drops a waiting render once its task settles", async () => {
    const scheduler = createPdfRenderScheduler(() => 0);
    const running = fakeTask();
    const cancelled = fakeTask();
    const next = fakeTask();
    scheduler.add(running, 1, "base");
    scheduler.add(cancelled, 2, "base");
    scheduler.add(next, 3, "base");
    running.continueChunk();
    cancelled.continueChunk();
    next.continueChunk();
    cancelled.settle();
    await Promise.resolve();
    await Promise.resolve();
    expect(scheduler.waiting()).toBe(1);

    runFrame();
    runFrame();
    expect(cancelled.slices).toBe(0);
    expect(next.slices).toBe(1);
  });

  it("lets a task that never asks to continue run untouched", async () => {
    const scheduler = createPdfRenderScheduler(() => 0);
    const task = fakeTask();
    scheduler.add(task, 1, "base");
    task.settle();
    await Promise.resolve();
    await Promise.resolve();
    expect(scheduler.waiting()).toBe(0);
  });

  it("lets every render continue unscheduled once destroyed, so none can hang", () => {
    const scheduler = createPdfRenderScheduler(() => 0);
    const [a, b, c] = [fakeTask(), fakeTask(), fakeTask()];
    scheduler.add(a, 1, "base");
    scheduler.add(b, 2, "base");
    a.continueChunk();
    b.continueChunk();
    scheduler.destroy();
    expect(scheduler.waiting()).toBe(0);
    scheduler.add(c, 3, "base");
    c.continueChunk();
    runFrame();
    expect(a.slices + b.slices + c.slices).toBe(3);
  });
});
