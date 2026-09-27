// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };

const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  set: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  claimQuickActionOffer: mocks.claim,
  setSystemIntegration: mocks.set,
}));

vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

import { offerQuickActionOnce } from "@/features/quick-action-offer";
import { useQuickActionOfferStore } from "@/store/quick-action-offer";
import { QuickActionOffer } from "./QuickActionOffer";

const copy = enShell.quickActionOffer;

function installed(quickActionsMenu: boolean | null) {
  return {
    id: "quick_action",
    state: "installed",
    packaged: false,
    attention: null,
    quick_actions_menu: quickActionsMenu,
    menu_title: "Open in Oleafly",
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  act(() => useQuickActionOfferStore.getState().setPhase("hidden"));
});

describe("QuickActionOffer", () => {
  it("appears once on macOS when the Quick Action is missing", async () => {
    mocks.claim.mockResolvedValueOnce(true).mockResolvedValue(false);
    render(<QuickActionOffer />);
    expect(screen.queryByTestId("quick-action-offer")).toBeNull();

    await act(() => offerQuickActionOnce(true));
    expect(screen.getByRole("heading", { name: copy.title })).toBeInTheDocument();
    expect(screen.getByText(copy.body)).toBeInTheDocument();
    expect(copy.body).toContain("Services menu right away");
    expect(copy.body).toContain("Quick Actions once you turn it on");

    await userEvent.setup().click(screen.getByRole("button", { name: copy.notNow }));
    expect(screen.queryByTestId("quick-action-offer")).toBeNull();

    await act(() => offerQuickActionOnce(true));
    expect(screen.queryByTestId("quick-action-offer")).toBeNull();
    expect(mocks.claim).toHaveBeenCalledTimes(2);
  });

  it("never asks outside macOS", async () => {
    render(<QuickActionOffer />);
    await act(() => offerQuickActionOnce(false));
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(screen.queryByTestId("quick-action-offer")).toBeNull();
  });

  it("adds the Quick Action and says how to turn it on under Quick Actions", async () => {
    for (const quickActionsMenu of [false, null]) {
      mocks.claim.mockResolvedValue(true);
      mocks.set.mockResolvedValue(installed(quickActionsMenu));
      const user = userEvent.setup();
      const { unmount } = render(<QuickActionOffer />);
      await act(() => offerQuickActionOnce(true));

      await user.click(screen.getByRole("button", { name: copy.add }));

      expect(mocks.set).toHaveBeenCalledWith("quick_action", true);
      expect(await screen.findByRole("status")).toHaveTextContent(copy.added);
      expect(copy.added).toContain("Quick Actions › Customize");
      expect(screen.queryByRole("button", { name: copy.add })).toBeNull();
      await user.click(screen.getByRole("button", { name: enCommon.actions.close }));
      expect(screen.queryByTestId("quick-action-offer")).toBeNull();
      unmount();
    }
  });

  it("never says to turn it on when Quick Actions already shows it from an earlier install", async () => {
    mocks.claim.mockResolvedValue(true);
    mocks.set.mockResolvedValue(installed(true));
    const user = userEvent.setup();
    render(<QuickActionOffer />);
    await act(() => offerQuickActionOnce(true));

    await user.click(screen.getByRole("button", { name: copy.add }));

    const message = await screen.findByRole("status");
    expect(message).toHaveTextContent(copy.addedInQuickActions);
    expect(message).not.toHaveTextContent(copy.added);
    expect(screen.getByTestId("quick-action-offer")).not.toHaveTextContent(/Customize|turn it on/);
    expect(copy.addedInQuickActions).toContain("Quick Actions");
  });

  it("points to Settings when adding fails", async () => {
    mocks.claim.mockResolvedValue(true);
    mocks.set.mockRejectedValue(new Error("read-only home"));
    const user = userEvent.setup();
    render(<QuickActionOffer />);
    await act(() => offerQuickActionOnce(true));

    await user.click(screen.getByRole("button", { name: copy.add }));

    expect(await screen.findByRole("alert")).toHaveTextContent(copy.failed);
    expect(mocks.logError).toHaveBeenCalled();
  });

  it("points to Settings when the Quick Action is written but does not read as installed", async () => {
    mocks.claim.mockResolvedValue(true);
    mocks.set.mockResolvedValue({ ...installed(null), state: "needs_attention", attention: "outdated" });
    const user = userEvent.setup();
    render(<QuickActionOffer />);
    await act(() => offerQuickActionOnce(true));

    await user.click(screen.getByRole("button", { name: copy.add }));

    expect(await screen.findByRole("alert")).toHaveTextContent(copy.failed);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("stays quiet when the offer cannot be checked", async () => {
    mocks.claim.mockRejectedValue(new Error("no bridge"));
    render(<QuickActionOffer />);
    await act(() => offerQuickActionOnce(true));
    expect(screen.queryByTestId("quick-action-offer")).toBeNull();
    expect(mocks.logError).toHaveBeenCalled();
  });
});
