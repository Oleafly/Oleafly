// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { check, collabError } from "./tests/fixtures";

const mocks = vi.hoisted(() => ({ collabServerTest: vi.fn() }));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  ...mocks,
}));

import { useConnectionTest } from "./use-connection-test";

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useConnectionTest", () => {
  it("runs the checks against the address and keeps the results", async () => {
    mocks.collabServerTest.mockResolvedValue([check("reachable", "pass")]);
    const { result } = renderHook(() => useConnectionTest("https://collab.uni.edu"));
    expect(result.current.test).toEqual({ state: "idle" });
    act(() => void result.current.run());
    expect(result.current.test).toEqual({ state: "running" });
    await waitFor(() => expect(result.current.test).toEqual({ state: "done", checks: [check("reachable", "pass")] }));
    expect(mocks.collabServerTest).toHaveBeenCalledWith("https://collab.uni.edu");
  });

  it("forgets the result once reset, even one that arrives after", async () => {
    let answer: (checks: unknown[]) => void = () => undefined;
    mocks.collabServerTest
      .mockResolvedValueOnce([check("reachable", "fail")])
      .mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    const { result } = renderHook(() => useConnectionTest("https://collab.uni.edu"));
    await act(() => result.current.run());
    expect(result.current.test).toEqual({ state: "done", checks: [check("reachable", "fail")] });
    act(() => result.current.reset());
    expect(result.current.test).toEqual({ state: "idle" });
    act(() => void result.current.run());
    act(() => result.current.reset());
    await act(async () => answer([check("reachable", "pass")]));
    expect(result.current.test).toEqual({ state: "idle" });
  });

  it("explains a test that could not run", async () => {
    mocks.collabServerTest.mockRejectedValue(collabError("not_https"));
    const { result } = renderHook(() => useConnectionTest("http://collab.uni.edu"));
    await act(() => result.current.run());
    expect(result.current.test).toEqual({ state: "failed", message: enCollab.errors.not_https });
  });
});
