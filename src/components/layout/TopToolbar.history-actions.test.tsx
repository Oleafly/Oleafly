// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "@/store/settings";
import { ProjectHistoryActions } from "./TopToolbar";

beforeEach(() => {
  useSettingsStore.setState({
    versioningOpen: false,
    versioningTab: "checkpoints",
  });
});

describe("ProjectHistoryActions", () => {
  it("opens the versioning window from one button", async () => {
    const user = userEvent.setup();
    render(<ProjectHistoryActions />);

    expect(screen.getAllByRole("button")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Versioning" }));

    expect(useSettingsStore.getState().versioningOpen).toBe(true);
    expect(useSettingsStore.getState().versioningTab).toBe("checkpoints");
  });

  it("reopens on the tab that was last selected", async () => {
    useSettingsStore.setState({ versioningTab: "git" });
    const user = userEvent.setup();
    render(<ProjectHistoryActions />);

    await user.click(screen.getByRole("button", { name: "Versioning" }));

    expect(useSettingsStore.getState().versioningOpen).toBe(true);
    expect(useSettingsStore.getState().versioningTab).toBe("git");
  });
});
