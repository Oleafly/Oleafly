// @vitest-environment jsdom

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import type { BackgroundHelperStatus } from "@/lib/background-helper";

const api = vi.hoisted(() => ({
  getBackgroundHelperStatus: vi.fn(),
  stopBackgroundHelper: vi.fn(),
  setBackgroundHelperAtLogin: vi.fn(),
  setBackgroundTasksEnabled: vi.fn(),
  revealBackgroundHelperLog: vi.fn(),
  listenForBackgroundHelper: vi.fn(),
}));
const notifyError = vi.hoisted(() => vi.fn());

vi.mock("@/lib/background-helper", () => api);
vi.mock("@/lib/toast", () => ({ notifyError, toast: { error: vi.fn() } }));
vi.mock("@/lib/log", () => ({ logError: vi.fn(async () => {}) }));

import { BackgroundTasksCard } from "./BackgroundTasksCard";

const strings = enSettings.research.background;

function status(patch: Partial<BackgroundHelperStatus> = {}): BackgroundHelperStatus {
  return {
    enabled: true,
    atLogin: { state: "disabled" },
    running: false,
    hung: false,
    phase: null,
    taskCount: 0,
    logPath: "/Users/me/.oleafly/daemon/helper.log",
    ...patch,
  };
}

describe("BackgroundTasksCard", () => {
  beforeEach(() => {
    for (const mock of Object.values(api)) mock.mockReset();
    notifyError.mockReset();
    api.listenForBackgroundHelper.mockResolvedValue(() => {});
    api.getBackgroundHelperStatus.mockResolvedValue(status());
  });

  it("shows the helper status and task count", async () => {
    api.getBackgroundHelperStatus.mockResolvedValue(
      status({ running: true, phase: "ready", taskCount: 2 }),
    );
    render(<BackgroundTasksCard />);
    expect(await screen.findByText("Working on 2 tasks")).toBeTruthy();
    expect(screen.getByTestId("research-background-state").textContent).toBe(strings.status.running);
    expect(screen.getByRole("switch", { name: strings.enabled.label }).getAttribute("aria-checked")).toBe("true");
  });

  it("says when the helper's status could not be read, and reads it again on retry", async () => {
    api.getBackgroundHelperStatus.mockRejectedValueOnce(new Error("The helper socket is busy."));
    render(<BackgroundTasksCard />);

    expect((await screen.findByRole("alert")).textContent).toContain(strings.statusFailed);
    expect(screen.getByRole("switch", { name: strings.enabled.label }).getAttribute("aria-disabled")).toBe("true");

    await userEvent.click(screen.getByRole("button", { name: enCommon.actions.retry }));

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.getByRole("switch", { name: strings.enabled.label }).getAttribute("aria-disabled")).toBeNull();
  });

  it("keeps showing the last status when a later refresh fails", async () => {
    api.getBackgroundHelperStatus.mockResolvedValueOnce(status({ running: true, taskCount: 1 }));
    render(<BackgroundTasksCard />);
    await screen.findByText("Working on 1 task");

    api.getBackgroundHelperStatus.mockRejectedValue(new Error("The helper socket is busy."));
    const onHelperChange = api.listenForBackgroundHelper.mock.calls[0][0] as () => void;
    await act(async () => onHelperChange());
    await waitFor(() => expect(api.getBackgroundHelperStatus).toHaveBeenCalledTimes(2));

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Working on 1 task")).toBeTruthy();
  });

  it("shows a helper that stopped answering", async () => {
    api.getBackgroundHelperStatus.mockResolvedValue(
      status({ running: true, hung: true, phase: "ready", taskCount: 1 }),
    );
    render(<BackgroundTasksCard />);
    await waitFor(() =>
      expect(screen.getByTestId("research-background-state").textContent).toBe(strings.status.notResponding),
    );
  });

  it("Stop asks first, naming the tasks that come back, then calls the command and refreshes", async () => {
    api.getBackgroundHelperStatus.mockResolvedValue(status({ running: true, phase: "ready", taskCount: 2 }));
    api.stopBackgroundHelper.mockResolvedValue(status());
    render(<BackgroundTasksCard />);
    await screen.findByText("Working on 2 tasks");
    await userEvent.click(screen.getByRole("button", { name: strings.stop }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(strings.stopConfirm.title);
    expect(dialog).toHaveTextContent("Its 2 tasks move back to Oleafly and keep running here.");
    expect(api.stopBackgroundHelper).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: new RegExp(`^${strings.stop}`) }));
    expect(api.stopBackgroundHelper).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.getByTestId("research-background-state").textContent).toBe(strings.status.stopped),
    );
    expect(screen.getByRole("button", { name: strings.stop })).toHaveProperty("disabled", true);
  });

  it("keeps the helper running when the stop question is cancelled", async () => {
    api.getBackgroundHelperStatus.mockResolvedValue(status({ running: true, phase: "ready", taskCount: 1 }));
    render(<BackgroundTasksCard />);
    await screen.findByText("Working on 1 task");
    await userEvent.click(screen.getByRole("button", { name: strings.stop }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Its 1 task moves back to Oleafly and keeps running here.");
    await userEvent.click(within(dialog).getByRole("button", { name: new RegExp(`^${enCommon.actions.cancel}`) }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(api.stopBackgroundHelper).not.toHaveBeenCalled();
  });

  it("stops a helper with no tasks without asking, and says what Stop does", async () => {
    api.getBackgroundHelperStatus.mockResolvedValue(status({ running: true, phase: "ready", taskCount: 0 }));
    api.stopBackgroundHelper.mockResolvedValue(status());
    render(<BackgroundTasksCard />);
    const stop = await screen.findByRole("button", { name: strings.stop });
    await waitFor(() => expect(stop).toHaveProperty("disabled", false));
    expect(strings.stopHint).toBe("Its tasks move back to Oleafly and keep running here.");
    await userEvent.click(stop);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(api.stopBackgroundHelper).toHaveBeenCalledTimes(1);
  });

  it("turning on sign-in start calls the command and explains a translocated app", async () => {
    api.setBackgroundHelperAtLogin.mockResolvedValue(status({ atLogin: { state: "move_app" } }));
    render(<BackgroundTasksCard />);
    const toggle = await screen.findByRole("switch", { name: strings.atLogin.label });
    await waitFor(() => expect(toggle.getAttribute("aria-disabled")).toBeNull());
    await userEvent.click(toggle);
    expect(api.setBackgroundHelperAtLogin).toHaveBeenCalledWith(true);
    expect(await screen.findByText(strings.atLogin.moveApp)).toBeTruthy();
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });

  it("keeps sign-in start off while background tasks are off", async () => {
    api.getBackgroundHelperStatus.mockResolvedValue(status({ enabled: false }));
    render(<BackgroundTasksCard />);
    expect(await screen.findByText(strings.atLogin.needsBackground)).toBeTruthy();
    const toggle = screen.getByRole("switch", { name: strings.atLogin.label });
    expect(toggle.getAttribute("aria-disabled")).toBe("true");
    await userEvent.click(toggle);
    expect(api.setBackgroundHelperAtLogin).not.toHaveBeenCalled();
  });

  it("turning background tasks off calls the command and shows the new state", async () => {
    api.setBackgroundTasksEnabled.mockResolvedValue(undefined);
    render(<BackgroundTasksCard />);
    const toggle = await screen.findByRole("switch", { name: strings.enabled.label });
    await waitFor(() => expect(toggle.getAttribute("aria-disabled")).toBeNull());
    api.getBackgroundHelperStatus.mockResolvedValue(status({ enabled: false }));
    await userEvent.click(toggle);
    expect(api.setBackgroundTasksEnabled).toHaveBeenCalledWith(false);
    await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("false"));
  });

  it("a failed toggle shows one error toast", async () => {
    api.setBackgroundTasksEnabled.mockRejectedValue(new Error("config.json is locked"));
    render(<BackgroundTasksCard />);
    const toggle = await screen.findByRole("switch", { name: strings.enabled.label });
    await waitFor(() => expect(toggle.getAttribute("aria-disabled")).toBeNull());
    await userEvent.click(toggle);
    await waitFor(() => expect(notifyError).toHaveBeenCalledTimes(1));
    expect(notifyError.mock.calls[0][2]).toBe(strings.toggleFailed);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });

  it("refreshes when the helper changes", async () => {
    let changed: (() => void) | undefined;
    api.listenForBackgroundHelper.mockImplementation(async (onChange: () => void) => {
      changed = onChange;
      return () => {};
    });
    render(<BackgroundTasksCard />);
    await waitFor(() => expect(changed).toBeTypeOf("function"));
    api.getBackgroundHelperStatus.mockResolvedValue(status({ running: true, phase: "ready", taskCount: 3 }));
    changed?.();
    expect(await screen.findByText("Working on 3 tasks")).toBeTruthy();
  });
});
