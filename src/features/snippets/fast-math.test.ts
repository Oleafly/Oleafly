// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ notifyError: vi.fn() }));

vi.mock("@/lib/toast", () => ({ notifyError: mocks.notifyError }));

import { FAST_MATH_COLLECTIONS, fastMathEnabled, setFastMath, toggleFastMath, useFastMath } from "./fast-math";
import { useSnippetStore } from "./store";
import { useSettingsStore } from "@/store/settings";

const initial = useSnippetStore.getState();
const setCollectionEnabled = vi.fn(async (collection: string, enabled: boolean) => {
  const others = useSnippetStore.getState().state.disabledCollections.filter((name) => name !== collection);
  useSnippetStore.setState({ state: { ...useSnippetStore.getState().state, disabledCollections: enabled ? others : [...others, collection] } });
});

function ready(disabledCollections: string[]): void {
  useSnippetStore.setState({ status: "ready", state: { disabledCollections, knownCollections: [], overrides: [], disabledRegex: [] } });
}

beforeEach(() => {
  vi.clearAllMocks();
  useSnippetStore.setState({ ...initial, setCollectionEnabled }, true);
});

afterEach(() => {
  useSnippetStore.setState(initial, true);
});

describe("Fast math", () => {
  it("switches expansion as you type back on when it is turned on, and leaves it alone when turned off", async () => {
    ready(["fast-math-latex", "fast-math-typst"]);
    useSettingsStore.getState().setSnippetsAuto(false);
    await setFastMath("latex", false);
    expect(useSettingsStore.getState().snippetsAuto).toBe(false);
    await setFastMath("latex", true);
    expect(useSettingsStore.getState().snippetsAuto).toBe(true);
    expect(fastMathEnabled("latex")).toBe(true);
  });

  it("is off until the snippets are loaded, then follows its collection", () => {
    expect(fastMathEnabled("latex")).toBe(false);
    ready(["fast-math-typst"]);
    expect(fastMathEnabled("latex")).toBe(true);
    expect(fastMathEnabled("typst")).toBe(false);
  });

  it("turns the pack collection for the language on and off", async () => {
    await setFastMath("typst", true);
    expect(setCollectionEnabled).toHaveBeenCalledWith(FAST_MATH_COLLECTIONS.typst, true);
    await setFastMath("latex", false);
    expect(setCollectionEnabled).toHaveBeenCalledWith("fast-math-latex", false);
  });

  it("toggles after the snippets have loaded", async () => {
    const load = vi.fn(async () => ready(["fast-math-latex", "fast-math-typst"]));
    useSnippetStore.setState({ load });
    await toggleFastMath("latex");
    expect(load).toHaveBeenCalledOnce();
    expect(fastMathEnabled("latex")).toBe(true);
    await toggleFastMath("latex");
    expect(load).toHaveBeenCalledOnce();
    expect(fastMathEnabled("latex")).toBe(false);
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });

  it("tells the user when the change could not be saved", async () => {
    ready([]);
    const failure = new Error("disk full");
    setCollectionEnabled.mockRejectedValueOnce(failure);
    await toggleFastMath("typst");
    expect(mocks.notifyError).toHaveBeenCalledWith("toggle Fast math", failure);
  });

  it("re-renders a toolbar that reads it when the collection changes", async () => {
    ready(["fast-math-latex"]);
    const { result } = renderHook(() => useFastMath("latex"));
    expect(result.current).toBe(false);
    await act(() => setFastMath("latex", true));
    expect(result.current).toBe(true);
  });
});
