// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { installIntersectionObserverStub } from "./test-intersection-observer";

const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "IntersectionObserver");

afterEach(() => {
  if (originalDescriptor) Object.defineProperty(globalThis, "IntersectionObserver", originalDescriptor);
  else delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
});

describe("intersection observer stub", () => {
  it("reports observed targets as visible by default and on demand", () => {
    const stub = installIntersectionObserverStub();
    const callback = vi.fn();
    const observer = new IntersectionObserver(callback);
    const first = document.createElement("div");
    const second = document.createElement("div");

    observer.observe(first);
    observer.observe(second);

    expect(callback.mock.calls.map(([entries]) => entries[0].isIntersecting)).toEqual([true, true]);
    expect(stub.observed()).toEqual([first, second]);
    expect(observer.takeRecords()).toEqual([]);

    observer.unobserve(first);
    stub.setVisible((target) => target !== second);
    expect(callback.mock.calls.at(-1)?.[0]).toEqual([{ target: second, isIntersecting: false }]);

    observer.disconnect();
    expect(stub.observed()).toEqual([]);
    stub.setVisible(() => true);
    expect(callback).toHaveBeenCalledTimes(3);
    stub.restore();
  });

  it("puts back the previous observer when restored", () => {
    class Previous {}
    Object.defineProperty(globalThis, "IntersectionObserver", { configurable: true, writable: true, value: Previous });
    const stub = installIntersectionObserverStub(() => false);
    expect(globalThis.IntersectionObserver).not.toBe(Previous);

    stub.restore();

    expect(globalThis.IntersectionObserver).toBe(Previous);
  });

  it("removes the stub when there was no observer before", () => {
    delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
    const stub = installIntersectionObserverStub();

    stub.restore();

    expect("IntersectionObserver" in globalThis).toBe(false);
  });
});
