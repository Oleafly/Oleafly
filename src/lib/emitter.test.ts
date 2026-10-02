import { describe, expect, it, vi } from "vitest";
import { createEmitter } from "./emitter";

describe("createEmitter", () => {
  it("calls every subscriber with the emitted arguments", () => {
    const emitter = createEmitter<[name: string, count: number]>();
    const first = vi.fn();
    const second = vi.fn();
    emitter.subscribe(first);
    emitter.subscribe(second);

    emitter.emit("main.tex", 2);

    expect(first).toHaveBeenCalledExactlyOnceWith("main.tex", 2);
    expect(second).toHaveBeenCalledExactlyOnceWith("main.tex", 2);
  });

  it("stops calling a listener once it unsubscribes", () => {
    const emitter = createEmitter();
    const listener = vi.fn();
    const unsubscribe = emitter.subscribe(listener);

    emitter.emit();
    unsubscribe();
    unsubscribe();
    emitter.emit();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("calls a listener added twice only once", () => {
    const emitter = createEmitter();
    const listener = vi.fn();
    emitter.subscribe(listener);
    emitter.subscribe(listener);

    emitter.emit();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("skips a listener that an earlier listener removed during the same emit", () => {
    const emitter = createEmitter();
    const later = vi.fn();
    let removeLater = () => {};
    emitter.subscribe(() => removeLater());
    removeLater = emitter.subscribe(later);

    emitter.emit();

    expect(later).not.toHaveBeenCalled();
  });
});
