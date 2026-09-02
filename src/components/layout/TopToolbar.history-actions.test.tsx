// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "@/store/settings";
import { ProjectHistoryActions } from "./TopToolbar";

beforeEach(() => {
  useSettingsStore.setState({
    historyOpen: false,
    checkpointsOpen: false,
  });
});

describe("ProjectHistoryActions", () => {
  it("opens Git history and Checkpoints as separate surfaces", async () => {
    const user = userEvent.setup();
    render(<ProjectHistoryActions />);

    await user.click(screen.getByRole("button", { name: "Checkpoints" }));
    expect(useSettingsStore.getState().checkpointsOpen).toBe(true);
    expect(useSettingsStore.getState().historyOpen).toBe(false);

    await user.click(screen.getByRole("button", { name: "Git history" }));
    expect(useSettingsStore.getState().historyOpen).toBe(true);
  });
});
