// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { clearExpansionState, usePersistentExpansion } from "./expansion-state";

beforeEach(clearExpansionState);

function toggle(key: string | undefined, initial = false) {
  const hook = renderHook(() => usePersistentExpansion(key, initial));
  act(() => hook.result.current[1]((value) => !value));
  return hook;
}

describe("usePersistentExpansion", () => {
  it("remembers a keyed card across remounts and leaves unkeyed ones local", () => {
    toggle("chat:a").unmount();
    toggle(undefined).unmount();

    expect(renderHook(() => usePersistentExpansion("chat:a")).result.current[0]).toBe(true);
    expect(renderHook(() => usePersistentExpansion(undefined)).result.current[0]).toBe(false);
    expect(renderHook(() => usePersistentExpansion("chat:b", true)).result.current[0]).toBe(true);
  });

  it("forgets the oldest card once it has remembered two thousand", () => {
    const hook = renderHook(({ key }) => usePersistentExpansion(key), { initialProps: { key: "card-0" } });
    for (let index = 0; index <= 2_000; index++) {
      hook.rerender({ key: `card-${index}` });
      act(() => hook.result.current[1](true));
    }
    hook.unmount();

    expect(renderHook(() => usePersistentExpansion("card-0")).result.current[0]).toBe(false);
    expect(renderHook(() => usePersistentExpansion("card-1")).result.current[0]).toBe(true);
    expect(renderHook(() => usePersistentExpansion("card-2000")).result.current[0]).toBe(true);
  });
});
