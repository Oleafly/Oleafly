// @vitest-environment jsdom

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "@/store/settings";

vi.mock("@/components/editor/GitHistoryPanel", () => ({
  GitHistoryPanel: () => <div data-testid="git-history-panel" />,
}));

const busyControl: { report: ((busy: boolean) => void) | null } = { report: null };

vi.mock("@/components/editor/CheckpointsPanel", async () => {
  const { useEffect } = await import("react");
  return {
    CheckpointsPanel: ({ onBusyChange }: { onBusyChange?: (busy: boolean) => void }) => {
      useEffect(() => {
        busyControl.report = onBusyChange ?? null;
        return () => {
          busyControl.report = null;
          onBusyChange?.(false);
        };
      }, [onBusyChange]);
      return <div data-testid="checkpoints-panel" />;
    },
  };
});

import { VersioningModal } from "./VersioningModal";

beforeEach(() => {
  useSettingsStore.setState({ versioningOpen: true, versioningTab: "checkpoints" });
});

describe("VersioningModal", () => {
  it("stays closed until the store opens it", () => {
    act(() => useSettingsStore.setState({ versioningOpen: false }));
    render(<VersioningModal />);

    expect(screen.queryByRole("dialog")).toBeNull();

    act(() => useSettingsStore.getState().openVersioning());

    expect(screen.getByRole("dialog")).toHaveAttribute("aria-labelledby", "versioning-title");
    expect(screen.getByRole("heading", { name: "Versioning" })).toBeInTheDocument();
  });

  it("opens on the remembered tab and switches panels", async () => {
    const user = userEvent.setup();
    render(<VersioningModal />);

    const gitTab = screen.getByTestId("versioning-tab-git");
    const checkpointsTab = screen.getByTestId("versioning-tab-checkpoints");
    expect(gitTab).toHaveTextContent("Git History");
    expect(checkpointsTab).toHaveTextContent("Saved Checkpoints");
    expect(checkpointsTab).toHaveAttribute("aria-selected", "true");
    expect(gitTab).toHaveAttribute("aria-selected", "false");
    expect(screen.getByTestId("versioning-panel-checkpoints")).toBeVisible();
    expect(screen.getByTestId("checkpoints-panel")).toBeInTheDocument();
    expect(screen.getByTestId("versioning-panel-git")).not.toBeVisible();
    expect(screen.queryByTestId("git-history-panel")).toBeNull();

    await user.click(gitTab);

    expect(useSettingsStore.getState().versioningTab).toBe("git");
    expect(gitTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("versioning-panel-git")).toBeVisible();
    expect(screen.getByTestId("git-history-panel")).toBeInTheDocument();
    expect(screen.getByTestId("versioning-panel-checkpoints")).not.toBeVisible();
    expect(screen.queryByTestId("checkpoints-panel")).toBeNull();
  });

  it("labels the tablist and orders Git History before Saved Checkpoints", () => {
    render(<VersioningModal />);

    const tablist = screen.getByRole("tablist", { name: "Versioning views" });
    expect(within(tablist).getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Git History",
      "Saved Checkpoints",
    ]);
  });

  it("blocks closing and tab switching while a checkpoint action is busy", async () => {
    const user = userEvent.setup();
    render(<VersioningModal />);

    act(() => busyControl.report?.(true));

    expect(screen.getByRole("button", { name: "Close versioning" })).toBeDisabled();
    expect(screen.getByTestId("versioning-tab-git")).toBeDisabled();
    await user.keyboard("{Escape}");
    fireEvent.mouseDown(screen.getByRole("button", { name: "Dismiss versioning" }));
    expect(useSettingsStore.getState().versioningOpen).toBe(true);
    expect(useSettingsStore.getState().versioningTab).toBe("checkpoints");

    act(() => busyControl.report?.(false));

    expect(screen.getByRole("button", { name: "Close versioning" })).toBeEnabled();
    expect(screen.getByTestId("versioning-tab-git")).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Close versioning" }));
    expect(useSettingsStore.getState().versioningOpen).toBe(false);
  });

  it("closes from the header button and from the backdrop", async () => {
    const user = userEvent.setup();
    render(<VersioningModal />);

    await user.click(screen.getByRole("button", { name: "Close versioning" }));
    expect(useSettingsStore.getState().versioningOpen).toBe(false);

    act(() => useSettingsStore.getState().openVersioning("git"));
    expect(useSettingsStore.getState().versioningTab).toBe("git");

    fireEvent.mouseDown(screen.getByRole("button", { name: "Dismiss versioning" }));
    expect(useSettingsStore.getState().versioningOpen).toBe(false);
  });
});
