// @vitest-environment jsdom

import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Toaster } from "./sonner";
import { toast } from "@/lib/toast";
import { TOAST_DURATION_MS, useToastStore } from "@/store/toast";

const SAVE_FAILED = "Could not save main.tex.";

const shown = () => document.querySelectorAll("[data-sonner-toast]");

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("Toaster timing with sonner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToastStore.getState().reset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("restarts the timer of a repeated toast and keeps one on screen", async () => {
    render(<Toaster />);
    act(() => {
      toast.error(SAVE_FAILED);
    });
    await advance(100);
    expect(shown()).toHaveLength(1);

    await advance(TOAST_DURATION_MS - 1000);
    act(() => {
      toast.error(SAVE_FAILED);
    });
    await advance(TOAST_DURATION_MS - 1000);

    expect(shown()).toHaveLength(1);
    expect(shown()[0]?.textContent).toContain("×2");
    expect(useToastStore.getState().toasts).toHaveLength(1);

    await advance(2000);

    expect(useToastStore.getState().toasts).toEqual([]);
    act(() => {
      toast.error(SAVE_FAILED);
    });
    expect(useToastStore.getState().toasts).toEqual([]);
  });
});
