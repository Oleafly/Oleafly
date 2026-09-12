// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ appVersion: vi.fn(async () => "0.4.0") }));

vi.mock("@/lib/tauri", () => ({ appVersion: mocks.appVersion }));
vi.mock("@/components/settings/CiteOleaflyCard", () => ({
  CiteOleaflyCard: ({ version }: { version: string }) => (
    <div data-testid="cite-card" data-version={version} />
  ),
}));

import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import { useCiteOleaflyStore } from "@/store/cite-oleafly";
import { useSettingsStore } from "@/store/settings";
import { CiteOleaflyDialog } from "./CiteOleaflyDialog";

const copy = enShell.citeOleafly;

beforeEach(() => {
  mocks.appVersion.mockReset().mockResolvedValue("0.4.0");
  useCiteOleaflyStore.setState({ open: false });
  useSettingsStore.setState({
    settingsOpen: false,
    settingsInitialSection: null,
  } as unknown as ReturnType<typeof useSettingsStore.getState>);
});

describe("CiteOleaflyDialog", () => {
  it("stays shut until the store opens it", () => {
    render(<CiteOleaflyDialog />);
    expect(screen.queryByTestId("cite-oleafly-dialog")).not.toBeInTheDocument();
    expect(mocks.appVersion).not.toHaveBeenCalled();
  });

  it("reads the app version into the citation card", async () => {
    useCiteOleaflyStore.setState({ open: true });
    render(<CiteOleaflyDialog />);
    expect(screen.getByText(copy.title)).toBeInTheDocument();
    expect(screen.getByText(copy.description)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("cite-card")).toHaveAttribute(
        "data-version",
        "0.4.0",
      ),
    );
  });

  it("leaves the version blank when it cannot be read", async () => {
    mocks.appVersion.mockRejectedValue(new Error("no bridge"));
    useCiteOleaflyStore.setState({ open: true });
    render(<CiteOleaflyDialog />);
    await waitFor(() =>
      expect(screen.getByTestId("cite-card")).toHaveAttribute("data-version", ""),
    );
  });

  it("hands the reader to the help settings", async () => {
    useCiteOleaflyStore.setState({ open: true });
    render(<CiteOleaflyDialog />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: copy.openHelp }));
    await waitFor(() => expect(useCiteOleaflyStore.getState().open).toBe(false));
    expect(useSettingsStore.getState().settingsOpen).toBe(true);
    expect(useSettingsStore.getState().settingsInitialSection).toBe("help");
  });

  it("closes from the done button", async () => {
    useCiteOleaflyStore.setState({ open: true });
    render(<CiteOleaflyDialog />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: enCommon.actions.done }));
    await waitFor(() => expect(useCiteOleaflyStore.getState().open).toBe(false));
  });
});
