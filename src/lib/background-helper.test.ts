import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
const listen = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen }));

import {
  BACKGROUND_HELPER_CHANGED,
  getBackgroundHelperStatus,
  listenForBackgroundHelper,
  revealBackgroundHelperLog,
  setBackgroundHelperAtLogin,
  setBackgroundTasksEnabled,
  stopBackgroundHelper,
} from "./background-helper";

describe("background helper wrappers", () => {
  beforeEach(() => {
    invoke.mockReset().mockResolvedValue(undefined);
    listen.mockReset().mockResolvedValue(() => {});
  });

  it("wrappers call the right commands", async () => {
    await getBackgroundHelperStatus();
    await stopBackgroundHelper();
    await setBackgroundHelperAtLogin(true);
    await setBackgroundTasksEnabled(false);
    await revealBackgroundHelperLog();
    expect(invoke.mock.calls).toEqual([
      ["background_helper_status"],
      ["background_helper_stop"],
      ["background_helper_set_login_item", { enabled: true }],
      ["background_tasks_set_enabled", { enabled: false }],
      ["background_helper_reveal_log"],
    ]);
  });

  it("listens for helper changes and calls back without the payload", async () => {
    const onChange = vi.fn();
    await listenForBackgroundHelper(onChange);
    expect(listen).toHaveBeenCalledWith(BACKGROUND_HELPER_CHANGED, expect.any(Function));
    const handler = listen.mock.calls[0][1] as (event: unknown) => void;
    handler({ payload: null });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(BACKGROUND_HELPER_CHANGED).toBe("background-helper-changed");
  });
});
