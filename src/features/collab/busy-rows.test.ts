// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useBusyRows } from "./busy-rows";
import { deferred } from "./tests/fixtures";

describe("useBusyRows", () => {
  it("keeps each row busy until its own action ends", async () => {
    const { result } = renderHook(() => useBusyRows());
    const first = deferred<void>();
    const second = deferred<void>();
    let a: Promise<boolean> = Promise.resolve(false);
    let b: Promise<boolean> = Promise.resolve(false);
    act(() => {
      a = result.current.run("a", () => first.promise);
      b = result.current.run("b", () => second.promise);
    });
    expect([...result.current.busy].sort()).toEqual(["a", "b"]);
    await act(async () => {
      first.resolve();
      await a;
    });
    expect([...result.current.busy]).toEqual(["b"]);
    await act(async () => {
      second.resolve();
      await b;
    });
    expect(result.current.busy.size).toBe(0);
  });

  it("sends nothing for a second click on a busy row", async () => {
    const { result } = renderHook(() => useBusyRows());
    const pending = deferred<void>();
    const action = vi.fn(() => pending.promise);
    let first: Promise<boolean> = Promise.resolve(false);
    let again: Promise<boolean> = Promise.resolve(true);
    act(() => {
      first = result.current.run("a", action);
      again = result.current.run("a", action);
    });
    expect(await again).toBe(false);
    await act(async () => {
      pending.resolve();
      expect(await first).toBe(true);
    });
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("frees the row and passes the error on when the action fails", async () => {
    const { result } = renderHook(() => useBusyRows());
    let outcome: Promise<boolean> = Promise.resolve(true);
    act(() => {
      outcome = result.current.run("a", () => Promise.reject(new Error("refused")));
    });
    await act(async () => {
      await expect(outcome).rejects.toThrow("refused");
    });
    expect(result.current.busy.size).toBe(0);
  });
});
