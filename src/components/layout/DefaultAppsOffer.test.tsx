// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import type { DefaultAppItemId, SystemIntegrationItem } from "@/lib/tauri";

const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  claimQuickAction: vi.fn(),
  set: vi.fn(),
  logError: vi.fn(),
  mac: { value: true },
}));

vi.mock("@/lib/tauri", () => ({
  claimDefaultAppsOffer: mocks.claim,
  claimQuickActionOffer: mocks.claimQuickAction,
  setSystemIntegration: mocks.set,
}));

vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

vi.mock("@/lib/utils", async (load) => ({
  ...(await load<typeof import("@/lib/utils")>()),
  get isMac() {
    return mocks.mac.value;
  },
}));

import { offerDefaultAppsOnce } from "@/features/default-apps-offer";
import { offerQuickActionOnce } from "@/features/quick-action-offer";
import { useDefaultAppsOfferStore } from "@/store/default-apps-offer";
import { useQuickActionOfferStore } from "@/store/quick-action-offer";
import { DefaultAppsOffer } from "./DefaultAppsOffer";
import { QuickActionOffer } from "./QuickActionOffer";

const copy = enShell.defaultAppsOffer;

function result(id: DefaultAppItemId, state: SystemIntegrationItem["state"]): SystemIntegrationItem {
  return { id, state, packaged: false, attention: null, quick_actions_menu: null, menu_title: null };
}

const ALL: DefaultAppItemId[] = ["default_latex", "default_typst", "default_markdown", "default_quarto"];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.mac.value = true;
  act(() => {
    useDefaultAppsOfferStore.getState().setPhase("hidden");
    useQuickActionOfferStore.getState().setPhase("hidden");
  });
});

describe("DefaultAppsOffer", () => {
  it("asks once, with every type but Markdown ticked, and never again after Keep my apps", async () => {
    mocks.claim.mockResolvedValueOnce(ALL).mockResolvedValue([]);
    render(<DefaultAppsOffer />);
    expect(screen.queryByTestId("default-apps-offer")).toBeNull();

    await act(() => offerDefaultAppsOnce());
    expect(screen.getByRole("heading", { name: copy.title })).toBeInTheDocument();
    expect(screen.getByText(copy.body)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: copy.types.latex })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: copy.types.typst })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: copy.types.quarto })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: copy.types.markdown })).not.toBeChecked();

    await userEvent.setup().click(screen.getByRole("button", { name: copy.keep }));
    expect(screen.queryByTestId("default-apps-offer")).toBeNull();
    expect(mocks.set).not.toHaveBeenCalled();

    await act(() => offerDefaultAppsOnce());
    expect(screen.queryByTestId("default-apps-offer")).toBeNull();
  });

  it("lists only the types Oleafly does not open yet and makes the ticked ones default", async () => {
    mocks.claim.mockResolvedValue(["default_typst", "default_markdown"]);
    mocks.set.mockImplementation(async (id: DefaultAppItemId) => result(id, "installed"));
    render(<DefaultAppsOffer />);
    await act(() => offerDefaultAppsOnce());
    expect(screen.queryByRole("checkbox", { name: copy.types.latex })).toBeNull();
    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: copy.types.markdown }));
    await user.click(screen.getByRole("checkbox", { name: copy.types.typst }));
    await user.click(screen.getByRole("checkbox", { name: copy.types.typst }));

    await user.click(screen.getByRole("button", { name: copy.use }));
    expect(mocks.set.mock.calls).toEqual([
      ["default_typst", true],
      ["default_markdown", true],
    ]);
    expect(screen.getByText(copy.doneMac)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("says Done without the macOS note elsewhere, and disables Use Oleafly with nothing ticked", async () => {
    mocks.mac.value = false;
    mocks.claim.mockResolvedValue(["default_markdown", "default_latex"]);
    mocks.set.mockImplementation(async (id: DefaultAppItemId) => result(id, "installed"));
    render(<DefaultAppsOffer />);
    await act(() => offerDefaultAppsOnce());
    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: copy.types.latex }));
    expect(screen.getByRole("button", { name: copy.use })).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: copy.types.latex }));
    await user.click(screen.getByRole("button", { name: copy.use }));
    expect(mocks.set.mock.calls).toEqual([["default_latex", true]]);
    expect(screen.getByText(copy.done)).toBeInTheDocument();
  });

  it("reports a type the system could not change, and an error while changing it", async () => {
    mocks.claim.mockResolvedValue(["default_latex", "default_quarto"]);
    mocks.set
      .mockResolvedValueOnce(result("default_latex", "needs_attention"))
      .mockRejectedValueOnce(new Error("busy"));
    render(<DefaultAppsOffer />);
    await act(() => offerDefaultAppsOnce());
    await userEvent.setup().click(screen.getByRole("button", { name: copy.use }));
    expect(screen.getByRole("alert")).toHaveTextContent(copy.failed);
    expect(mocks.logError).toHaveBeenCalledWith("make Oleafly the default for default_quarto", expect.any(Error));
  });

  it("logs a failed check and stays hidden", async () => {
    mocks.claim.mockRejectedValue(new Error("no prefs"));
    render(<DefaultAppsOffer />);
    await act(() => offerDefaultAppsOnce());
    expect(screen.queryByTestId("default-apps-offer")).toBeNull();
    expect(mocks.logError).toHaveBeenCalledWith("offer to open documents with Oleafly", expect.any(Error));
  });

  it("holds the Finder offer back while it asks, so the two cards never stack", async () => {
    mocks.claim.mockResolvedValue(["default_latex"]);
    mocks.claimQuickAction.mockResolvedValue(true);
    render(
      <>
        <DefaultAppsOffer />
        <QuickActionOffer />
      </>,
    );
    await act(() => offerDefaultAppsOnce());
    await act(() => offerQuickActionOnce(true));
    expect(screen.getByTestId("default-apps-offer")).toBeInTheDocument();
    expect(screen.queryByTestId("quick-action-offer")).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: copy.keep }));
    expect(screen.getByTestId("quick-action-offer")).toBeInTheDocument();
  });
});
