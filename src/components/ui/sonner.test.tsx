// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
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
import { useToastStore } from "@/store/toast";

const KEEP_MESSAGE = "Keep me";
const CHOOSE_MESSAGE = "Choose a compatible engine";
const SAVE_FAILED = "Could not save main.tex.";
const CHOOSE_ENGINE = "Choose an engine";
const COMPILING = "Compiling…";
const ADDED_ENTRY = "Added the entry to refs.bib";
const UNDO = "Undo";

interface ShownOptions {
  id: number;
  duration: number;
  action?: { label: string; onClick: () => void };
  onDismiss: () => void;
  onAutoClose: () => void;
}

function lastShown(mock: typeof mocks.error): [ReactNode, ShownOptions] {
  const call = mock.mock.calls.at(-1);
  if (!call) throw new Error("no toast was shown");
  return call as [ReactNode, ShownOptions];
}

beforeEach(() => {
  useToastStore.getState().reset();
  vi.clearAllMocks();
});

describe("Toaster keyed updates", () => {
  it("refreshes only the changed toast when a keyed action is replaced", async () => {
    const firstAction = vi.fn();
    const latestAction = vi.fn();
    render(<Toaster />);

    act(() => {
      toast.infoUnique("unrelated", KEEP_MESSAGE);
      toast.infoUnique(
        "engine-compatibility:project-1",
        CHOOSE_MESSAGE,
        { label: "Choose engine…", onClick: firstAction },
        true,
      );
    });
    await waitFor(() => expect(mocks.info).toHaveBeenCalledTimes(2));
    mocks.info.mockClear();

    act(() => {
      toast.infoUnique(
        "engine-compatibility:project-1",
        CHOOSE_MESSAGE,
        { label: "Choose engine…", onClick: latestAction },
        true,
      );
    });

    await waitFor(() => expect(mocks.info).toHaveBeenCalledTimes(1));
    expect(mocks.info).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: expect.objectContaining({ label: "Choose engine…" }),
        duration: Number.POSITIVE_INFINITY,
      }),
    );
    const [, options] = lastShown(mocks.info);
    act(() => {
      options.action?.onClick();
    });
    expect(latestAction).toHaveBeenCalledOnce();
    expect(firstAction).not.toHaveBeenCalled();
    expect(mocks.info).not.toHaveBeenCalledWith(KEEP_MESSAGE, expect.anything());
  });
});

describe("Toaster repeats", () => {
  it("shows a first toast with its plain text", async () => {
    render(<Toaster />);

    act(() => {
      toast.error(SAVE_FAILED);
    });

    await waitFor(() => expect(mocks.error).toHaveBeenCalledTimes(1));
    expect(mocks.error).toHaveBeenCalledWith(
      SAVE_FAILED,
      expect.objectContaining({ duration: 5000 }),
    );
  });

  it("refreshes the same toast id with a small repeat count", async () => {
    render(<Toaster />);

    act(() => {
      toast.error(SAVE_FAILED);
    });
    await waitFor(() => expect(mocks.error).toHaveBeenCalledTimes(1));
    const [, first] = lastShown(mocks.error);

    act(() => {
      toast.error(SAVE_FAILED);
      toast.error(SAVE_FAILED);
    });

    await waitFor(() => expect(mocks.error).toHaveBeenCalledTimes(2));
    const [title, options] = lastShown(mocks.error);
    expect(options.id).toBe(first.id);
    expect(mocks.dismiss).not.toHaveBeenCalled();
    render(<div>{title}</div>);
    expect(screen.getByText(SAVE_FAILED)).toBeInTheDocument();
    expect(screen.getByText("×3")).toBeInTheDocument();
  });

  it("keeps the same text quiet for a moment after it closes on screen", async () => {
    render(<Toaster />);
    act(() => {
      toast.error(SAVE_FAILED);
    });
    await waitFor(() => expect(mocks.error).toHaveBeenCalledTimes(1));
    const [, options] = lastShown(mocks.error);

    act(() => {
      options.onAutoClose();
      toast.error(SAVE_FAILED);
    });

    expect(useToastStore.getState().toasts).toEqual([]);
    expect(mocks.error).toHaveBeenCalledTimes(1);
  });

  it("treats the close button like an automatic close", async () => {
    render(<Toaster />);
    act(() => {
      toast.info(CHOOSE_ENGINE, undefined, true);
    });
    await waitFor(() => expect(mocks.info).toHaveBeenCalledTimes(1));
    const [, options] = lastShown(mocks.info);

    act(() => {
      options.onDismiss();
      toast.info(CHOOSE_ENGINE, undefined, true);
    });

    expect(useToastStore.getState().toasts).toEqual([]);
    expect(mocks.info).toHaveBeenCalledTimes(1);
  });

  it("lets code dismiss a toast without holding back the next one", async () => {
    render(<Toaster />);
    let id = 0;
    act(() => {
      id = toast.info(COMPILING, undefined, true);
    });
    await waitFor(() => expect(mocks.info).toHaveBeenCalledTimes(1));
    const [, options] = lastShown(mocks.info);

    act(() => {
      toast.dismiss(id);
    });
    await waitFor(() => expect(mocks.dismiss).toHaveBeenCalledWith(id));
    act(() => {
      options.onDismiss();
      toast.info(COMPILING, undefined, true);
    });

    await waitFor(() => expect(mocks.info).toHaveBeenCalledTimes(2));
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });
});

describe("Toaster actions", () => {
  it("removes the toast from the store when its action runs", async () => {
    const undo = vi.fn();
    render(<Toaster />);
    act(() => {
      toast.success(ADDED_ENTRY, { label: UNDO, onClick: undo });
    });
    await waitFor(() => expect(mocks.success).toHaveBeenCalledTimes(1));
    const [, first] = lastShown(mocks.success);

    act(() => {
      first.action?.onClick();
    });

    expect(undo).toHaveBeenCalledOnce();
    expect(useToastStore.getState().toasts).toEqual([]);

    act(() => {
      toast.success(ADDED_ENTRY, { label: UNDO, onClick: undo });
    });

    await waitFor(() => expect(mocks.success).toHaveBeenCalledTimes(2));
    const [title, second] = lastShown(mocks.success);
    expect(second.id).not.toBe(first.id);
    expect(title).toBe(ADDED_ENTRY);
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });
});
