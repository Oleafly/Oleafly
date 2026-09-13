// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "@/store/settings";

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
  useSettingsStore.setState({ versioningOpen: true });
});

describe("VersioningModal", () => {
  it("stays closed until the store opens it", () => {
    act(() => useSettingsStore.setState({ versioningOpen: false }));
    render(<VersioningModal />);

    expect(screen.queryByRole("dialog")).toBeNull();

    act(() => useSettingsStore.getState().openVersioning());

    expect(screen.getByRole("dialog")).toHaveAttribute("aria-labelledby", "versioning-title");
    expect(screen.getByRole("heading", { name: "Versioning" })).toBeInTheDocument();
    expect(screen.getByRole("dialog").querySelector("svg.lucide-history")).not.toBeNull();
  });

  it("shows checkpoints without a Git tab", () => {
    render(<VersioningModal />);

    expect(screen.getByTestId("versioning-panel-checkpoints")).toBeVisible();
    expect(screen.getByTestId("checkpoints-panel")).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByTestId("versioning-tab-git")).toBeNull();
    expect(screen.queryByTestId("versioning-panel-git")).toBeNull();
  });

  it("blocks closing while a checkpoint action is busy", async () => {
    const user = userEvent.setup();
    render(<VersioningModal />);

    act(() => busyControl.report?.(true));

    expect(screen.getByRole("button", { name: "Close versioning" })).toBeDisabled();
    await user.keyboard("{Escape}");
    fireEvent.mouseDown(screen.getByRole("button", { name: "Dismiss versioning" }));
    expect(useSettingsStore.getState().versioningOpen).toBe(true);

    act(() => busyControl.report?.(false));

    expect(screen.getByRole("button", { name: "Close versioning" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Close versioning" }));
    expect(useSettingsStore.getState().versioningOpen).toBe(false);
  });

  it("closes from the header button and from the backdrop", async () => {
    const user = userEvent.setup();
    render(<VersioningModal />);

    await user.click(screen.getByRole("button", { name: "Close versioning" }));
    expect(useSettingsStore.getState().versioningOpen).toBe(false);

    act(() => useSettingsStore.getState().openVersioning());
    expect(screen.getByTestId("checkpoints-panel")).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole("button", { name: "Dismiss versioning" }));
    expect(useSettingsStore.getState().versioningOpen).toBe(false);
  });
});
