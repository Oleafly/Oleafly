// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ imageToLatexAvailable: vi.fn() }));

vi.mock("@/features/image-to-latex", () => ({ imageToLatexAvailable: mocks.imageToLatexAvailable }));

import { useToolsImageReady } from "./use-tools-image-ready";

function changed(detail?: unknown) {
  act(() => {
    window.dispatchEvent(new CustomEvent("oleafly:ai-config-changed", { detail }));
  });
}

beforeEach(() => {
  mocks.imageToLatexAvailable.mockReset().mockResolvedValue(false);
});

describe("useToolsImageReady", () => {
  it("starts hidden and checks on mount", async () => {
    mocks.imageToLatexAvailable.mockResolvedValue(true);
    const { result } = renderHook(() => useToolsImageReady());
    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("re-checks when the AI config changes, using the event's config", async () => {
    const { result } = renderHook(() => useToolsImageReady());
    await waitFor(() => expect(mocks.imageToLatexAvailable).toHaveBeenCalledOnce());

    changed({ ai_keys: { ollama: "http://127.0.0.1:11434" } });
    await waitFor(() => expect(result.current).toBe(true));
    expect(mocks.imageToLatexAvailable).toHaveBeenCalledOnce();

    changed({ ai_keys: {}, ai_tools_model: { provider: "anthropic", model: "claude-opus-5-5" } });
    await waitFor(() => expect(result.current).toBe(false));

    mocks.imageToLatexAvailable.mockResolvedValue(true);
    changed();
    await waitFor(() => expect(result.current).toBe(true));
    expect(mocks.imageToLatexAvailable).toHaveBeenCalledTimes(2);
  });

  it("lets the newest check win when an older one answers later", async () => {
    let answerFirst!: (ready: boolean) => void;
    mocks.imageToLatexAvailable.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        answerFirst = resolve;
      }),
    );
    const { result } = renderHook(() => useToolsImageReady());
    changed({ ai_keys: { ollama: "http://127.0.0.1:11434" } });
    await waitFor(() => expect(result.current).toBe(true));
    await act(async () => {
      answerFirst(false);
    });
    expect(result.current).toBe(true);
  });

  it("stops listening after unmount", async () => {
    let answer!: (ready: boolean) => void;
    mocks.imageToLatexAvailable.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        answer = resolve;
      }),
    );
    const { result, unmount } = renderHook(() => useToolsImageReady());
    unmount();
    await act(async () => {
      answer(true);
    });
    changed();
    expect(result.current).toBe(false);
    expect(mocks.imageToLatexAvailable).toHaveBeenCalledOnce();
  });

  it("treats a failed check as hidden", async () => {
    mocks.imageToLatexAvailable.mockRejectedValue(new Error("no backend"));
    const { result } = renderHook(() => useToolsImageReady());
    await waitFor(() => expect(mocks.imageToLatexAvailable).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });
});
