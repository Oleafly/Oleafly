// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  events: new Map<string, (event: { payload: unknown }) => void>(),
  listen: vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
    mocks.events.set(name, handler);
    return () => mocks.events.delete(name);
  }),
  isTauri: vi.fn(() => true),
  confirmQuitDuringInstall: vi.fn(async () => {}),
  cancelQuitFlush: vi.fn(async () => {}),
  notifyError: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: mocks.isTauri }));
vi.mock("@/lib/tauri", () => ({
  confirmQuitDuringInstall: mocks.confirmQuitDuringInstall,
  cancelQuitFlush: mocks.cancelQuitFlush,
}));
vi.mock("@/lib/toast", () => ({ notifyError: mocks.notifyError }));

import { TinytexGuards } from "./TinytexGuards";
import { useEngineStore } from "@/store/engine";

beforeEach(() => {
  mocks.events.clear();
  mocks.listen.mockClear();
  mocks.confirmQuitDuringInstall.mockClear();
  mocks.cancelQuitFlush.mockClear();
  useEngineStore.setState({ installing: true, installWaitNoticeOpen: false });
});

describe("TinytexGuards quit interception", () => {
  it("re-arms the quit flush gate when the install finishes while the dialog is up", async () => {
    render(<TinytexGuards />);
    await waitFor(() => expect(mocks.events.has("tinytex-quit-blocked")).toBe(true));
    act(() => {
      mocks.events.get("tinytex-quit-blocked")?.({ payload: undefined });
    });
    await screen.findByText(/still installing/i);

    // The install completes: quitting is no longer destructive, the dialog
    // hides — and the flush confirmation from the earlier quit attempt must
    // be forgotten, or the NEXT quit would skip saving new edits.
    act(() => {
      useEngineStore.setState({ installing: false });
    });

    await waitFor(() => expect(mocks.cancelQuitFlush).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/still installing/i)).toBeNull();
  });

  it("re-arms the quit flush gate when the user cancels the dialog", async () => {
    render(<TinytexGuards />);
    await waitFor(() => expect(mocks.events.has("tinytex-quit-blocked")).toBe(true));
    act(() => {
      mocks.events.get("tinytex-quit-blocked")?.({ payload: undefined });
    });
    await screen.findByText(/still installing/i);

    // The first /cancel/i match is the backdrop (mousedown-only); the real
    // Cancel is the footer button.
    const cancelButtons = screen.getAllByRole("button", { name: /cancel/i });
    fireEvent.click(cancelButtons[cancelButtons.length - 1]);

    await waitFor(() => expect(mocks.cancelQuitFlush).toHaveBeenCalledTimes(1));
  });
});
