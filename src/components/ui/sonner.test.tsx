// @vitest-environment jsdom

import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  dismiss: vi.fn(),
}));

vi.mock("sonner", () => ({
  Toaster: () => null,
  toast: mocks,
}));

import { Toaster } from "./sonner";
import { toast } from "@/lib/toast";
import { getNativeWebviewOccluded } from "@/lib/native-webview-occlusion";
import { useToastStore } from "@/store/toast";

describe("Toaster keyed updates", () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
    vi.clearAllMocks();
  });

  it("refreshes only the changed toast when a keyed action is replaced", async () => {
    const firstAction = vi.fn();
    const latestAction = vi.fn();
    render(<Toaster />);

    act(() => {
      toast.infoUnique("unrelated", "Keep me");
      toast.infoUnique(
        "engine-compatibility:project-1",
        "Choose a compatible engine",
        { label: "Choose engine…", onClick: firstAction },
        true,
      );
    });
    await waitFor(() => expect(mocks.info).toHaveBeenCalledTimes(2));
    mocks.info.mockClear();

    act(() => {
      toast.infoUnique(
        "engine-compatibility:project-1",
        "Choose a compatible engine",
        { label: "Choose engine…", onClick: latestAction },
        true,
      );
    });

    await waitFor(() => expect(mocks.info).toHaveBeenCalledTimes(1));
    expect(mocks.info).toHaveBeenCalledWith(
      "Choose a compatible engine",
      expect.objectContaining({
        action: { label: "Choose engine…", onClick: latestAction },
        duration: Number.POSITIVE_INFINITY,
      }),
    );
    expect(mocks.info).not.toHaveBeenCalledWith("Keep me", expect.anything());
  });

  it("occludes native webviews while a toast is visible", async () => {
    render(<Toaster />);
    expect(getNativeWebviewOccluded()).toBe(false);

    let id = 0;
    act(() => {
      id = useToastStore.getState().push("info", "Saved");
    });
    await waitFor(() => expect(getNativeWebviewOccluded()).toBe(true));

    act(() => useToastStore.getState().dismiss(id));
    await waitFor(() => expect(getNativeWebviewOccluded()).toBe(false));
  });
});
