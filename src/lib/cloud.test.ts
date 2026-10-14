import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn(async () => null));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import * as cloud from "./cloud";

beforeEach(() => invoke.mockClear());

describe("cloud bridge", () => {
  it("calls each backend command with its arguments", async () => {
    const calls: [() => Promise<unknown>, string, Record<string, unknown> | undefined][] = [
      [() => cloud.cloudState(), "cloud_state", undefined],
      [() => cloud.cloudDetails(), "cloud_details", undefined],
      [() => cloud.cloudConnectBegin(true), "cloud_connect_begin", { paste: true }],
      [() => cloud.cloudConnectWait("f1"), "cloud_connect_wait", { flowId: "f1" }],
      [() => cloud.cloudConnectPaste("f1", "code"), "cloud_connect_paste", { flowId: "f1", code: "code" }],
      [() => cloud.cloudConnectCancel("f1"), "cloud_connect_cancel", { flowId: "f1" }],
      [() => cloud.cloudDisconnect(), "cloud_disconnect", undefined],
      [() => cloud.cloudSetEnabled(false), "cloud_set_enabled", { on: false }],
      [() => cloud.cloudSetDeviceName("Desk"), "cloud_set_device_name", { name: "Desk" }],
      [
        () => cloud.cloudSyncNow([{ localId: "thesis", path: "main.tex" }]),
        "cloud_sync_now",
        { dirty: [{ localId: "thesis", path: "main.tex" }] },
      ],
      [() => cloud.cloudProjectSetMode("thesis", "pause"), "cloud_project_set_mode", { localId: "thesis", mode: "pause" }],
      [
        () => cloud.cloudProjectResolveHold("thesis", "restore"),
        "cloud_project_resolve_hold",
        { localId: "thesis", choice: "restore" },
      ],
      [() => cloud.cloudProjectRemove("thesis"), "cloud_project_remove", { localId: "thesis" }],
      [() => cloud.cloudDownloadProject("c1"), "cloud_download_project", { cloudId: "c1" }],
      [() => cloud.cloudSettingsSync({ a: 1 }), "cloud_settings_sync", { values: { a: 1 } }],
      [() => cloud.cloudSettingsDownload(), "cloud_settings_download", undefined],
      [() => cloud.cloudSettingsApplied("123", { a: 1 }), "cloud_settings_applied", { stamp: "123", values: { a: 1 } }],
      [() => cloud.cloudSettingsKeepLocal({ a: 2 }), "cloud_settings_keep_local", { values: { a: 2 } }],
    ];
    for (const [call, command, args] of calls) {
      invoke.mockClear();
      await call();
      if (args === undefined) {
        expect(invoke).toHaveBeenCalledWith(command);
      } else {
        expect(invoke).toHaveBeenCalledWith(command, args);
      }
    }
  });
});
