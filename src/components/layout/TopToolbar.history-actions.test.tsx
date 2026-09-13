// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "@/store/settings";
import { ProjectHistoryActions } from "./TopToolbar";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };

beforeEach(() => {
  useSettingsStore.setState({
    versioningOpen: false,
  });
});

describe("ProjectHistoryActions", () => {
  it("opens the versioning window from one button", async () => {
    const user = userEvent.setup();
    render(<ProjectHistoryActions />);

    expect(screen.getAllByRole("button")).toHaveLength(1);

    const versioning = screen.getByRole("button", { name: enShell.toolbar.versioning });
    expect(versioning.querySelector("svg.lucide-history")).not.toBeNull();

    await user.click(versioning);

    expect(useSettingsStore.getState().versioningOpen).toBe(true);
  });

  it("reopens the checkpoints window after it was closed", async () => {
    const user = userEvent.setup();
    render(<ProjectHistoryActions />);

    await user.click(screen.getByRole("button", { name: enShell.toolbar.versioning }));
    useSettingsStore.getState().closeVersioning();
    await user.click(screen.getByRole("button", { name: enShell.toolbar.versioning }));

    expect(useSettingsStore.getState().versioningOpen).toBe(true);
  });
});
