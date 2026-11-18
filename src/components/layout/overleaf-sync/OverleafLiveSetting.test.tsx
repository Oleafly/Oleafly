// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };

vi.mock("@/lib/log", () => ({ logError: vi.fn(async () => {}) }));

import { installOverleafLiveActions, useLiveBackend } from "@/lib/collab-live-bridge";
import { useSettingsStore } from "@/store/settings";
import { OverleafLiveSetting } from "./OverleafLiveSetting";

const card = enShell.settings.experimentation.overleafLive;
const dialog = enShell.overleafLive.pauseDialog;
const pause = vi.fn();

beforeEach(() => {
  localStorage.clear();
  pause.mockReset();
  installOverleafLiveActions({ pause, resume: vi.fn(), unlink: vi.fn() });
  useLiveBackend.setState({ projectId: null, backend: null, overleaf: null, pendingPaths: [] });
});

function toggle() {
  return screen.getByRole("switch", { name: card.label });
}

describe("the Experimentation card for live editing with Overleaf", () => {
  it("turns the pref on and off and keeps it", async () => {
    render(<OverleafLiveSetting />);
    const user = userEvent.setup();
    await user.click(toggle());
    expect(useSettingsStore.getState().overleafLive).toBe(true);
    expect(localStorage.getItem("oleafly.overleafLive")).toBe("1");
    await user.click(toggle());
    expect(useSettingsStore.getState().overleafLive).toBe(false);
    expect(localStorage.getItem("oleafly.overleafLive")).toBe("0");
    expect(pause).not.toHaveBeenCalled();
  });

  it("pauses the live project first when turned off, and offers Pause anyway for unsent changes", async () => {
    useSettingsStore.getState().setOverleafLive(true);
    useLiveBackend.setState({ projectId: "p1", backend: "overleaf" });
    pause.mockResolvedValueOnce({ paused: false, unsent: ["main.tex"] });
    pause.mockResolvedValueOnce({ paused: true, unsent: [] });
    render(<OverleafLiveSetting />);
    const user = userEvent.setup();
    await user.click(toggle());
    const shown = await screen.findByTestId("overleaf-pause-dialog");
    expect(pause).toHaveBeenCalledWith("p1", false);
    expect(useSettingsStore.getState().overleafLive).toBe(true);
    await user.click(within(shown).getByRole("button", { name: dialog.pauseAnyway }));
    await waitFor(() => expect(useSettingsStore.getState().overleafLive).toBe(false));
    expect(pause).toHaveBeenLastCalledWith("p1", true);
  });

  it("stays on when you keep editing live", async () => {
    useSettingsStore.getState().setOverleafLive(true);
    useLiveBackend.setState({ projectId: "p1", backend: "overleaf" });
    pause.mockResolvedValueOnce({ paused: false, unsent: ["main.tex"] });
    render(<OverleafLiveSetting />);
    const user = userEvent.setup();
    await user.click(toggle());
    const shown = await screen.findByTestId("overleaf-pause-dialog");
    await user.click(within(shown).getByRole("button", { name: dialog.keepLive }));
    expect(useSettingsStore.getState().overleafLive).toBe(true);
  });
});
