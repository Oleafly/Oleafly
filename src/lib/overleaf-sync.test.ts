import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

import {
  overleafGitTokenClear,
  overleafGitTokenSet,
  overleafGitTokenStatus,
  overleafSyncCheck,
  overleafSyncLink,
  overleafSyncNow,
  overleafSyncSetAuto,
  overleafSyncStatus,
  overleafSyncUnlink,
  overleafTokenPage,
} from "./overleaf-sync";

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.invoke.mockResolvedValue({});
});

describe("overleaf sync bridge", () => {
  it("names every command and argument", async () => {
    await overleafSyncStatus("p1");
    await overleafSyncLink("p1", 4, " https://latex.uni.edu ", "abc", "remote");
    await overleafSyncLink("p1", 5, null, "abc", null);
    await overleafSyncNow("p1", 6, { "main.tex": "local" });
    await overleafSyncNow("p1", 7, null, true);
    await overleafSyncCheck("p1");
    await overleafSyncUnlink("p1");
    await overleafSyncSetAuto("p1", false);
    await overleafGitTokenStatus("");
    await overleafGitTokenSet("https://www.overleaf.com", "olp_x");
    await overleafGitTokenClear(null);
    expect(mocks.invoke.mock.calls).toEqual([
      ["overleaf_sync_status", { projectId: "p1" }],
      ["overleaf_sync_link", { projectId: "p1", expectedGeneration: 4, server: "https://latex.uni.edu", remoteId: "abc", prefer: "remote" }],
      ["overleaf_sync_link", { projectId: "p1", expectedGeneration: 5, server: null, remoteId: "abc", prefer: null }],
      ["overleaf_sync_now", { projectId: "p1", expectedGeneration: 6, resolutions: { "main.tex": "local" }, fetched: false }],
      ["overleaf_sync_now", { projectId: "p1", expectedGeneration: 7, resolutions: null, fetched: true }],
      ["overleaf_sync_check", { projectId: "p1" }],
      ["overleaf_sync_unlink", { projectId: "p1" }],
      ["overleaf_sync_set_auto", { projectId: "p1", auto: false }],
      ["overleaf_git_token_status", { server: null }],
      ["overleaf_git_token_set", { server: "https://www.overleaf.com", token: "olp_x" }],
      ["overleaf_git_token_clear", { server: null }],
    ]);
  });

  it("points at the account settings page without doubled slashes", () => {
    expect(overleafTokenPage("https://www.overleaf.com")).toBe("https://www.overleaf.com/user/settings");
    expect(overleafTokenPage("https://latex.uni.edu/sl//")).toBe("https://latex.uni.edu/sl/user/settings");
  });
});
