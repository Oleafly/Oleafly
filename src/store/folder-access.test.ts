import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyLocale } from "@/i18n";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import type { ProjectTrust } from "@/lib/tauri";

const mocks = vi.hoisted(() => ({
  projectTrustState: vi.fn(),
  projectFolderStatus: vi.fn(),
  trustFolder: vi.fn(),
  notifyError: vi.fn(),
  logError: vi.fn(async () => {}),
}));

vi.mock("@/lib/tauri", () => ({
  projectTrustState: mocks.projectTrustState,
  projectFolderStatus: mocks.projectFolderStatus,
  trustFolder: mocks.trustFolder,
}));
vi.mock("@/lib/toast", () => ({ notifyError: mocks.notifyError }));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

import {
  folderIsReadOnly,
  folderIsRestricted,
  loadFolderAccess,
  readOnlyFolderMessage,
  readOnlyFolderMessageInEnglish,
  refreshFolderStatus,
  terminalNeedsReopen,
  useFolderAccessStore,
} from "./folder-access";

const restricted: ProjectTrust = { trusted: false, source: null, parent: "papers", repository: null };
const trusted: ProjectTrust = { trusted: true, source: "folder", parent: "papers", repository: null };

function declined() {
  return new Error('@oleafly/error:{"code":"trust.declined","params":{},"detail":null}');
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.logError.mockResolvedValue(undefined);
  mocks.projectTrustState.mockResolvedValue(restricted);
  mocks.projectFolderStatus.mockResolvedValue({ read_only: false, synced_with: null });
  useFolderAccessStore.setState({ hiddenBanners: [] });
  useFolderAccessStore.getState().reset(null);
});

afterEach(() => {
  useFolderAccessStore.getState().reset(null);
});

describe("folder access", () => {
  it("loads trust and folder status together for the opened project", async () => {
    await loadFolderAccess("linked-a");
    const state = useFolderAccessStore.getState();
    expect(state.projectId).toBe("linked-a");
    expect(state.loaded).toBe(true);
    expect(folderIsRestricted(state, "linked-a")).toBe(true);
    expect(folderIsRestricted(state, "linked-b")).toBe(false);
    expect(folderIsReadOnly(state, "linked-a")).toBe(false);
    expect(mocks.projectTrustState).toHaveBeenCalledWith("linked-a");
    expect(mocks.projectFolderStatus).toHaveBeenCalledWith("linked-a");
  });

  it("never rejects and reports nothing when the backend cannot answer", async () => {
    mocks.projectTrustState.mockRejectedValue(new Error("offline"));
    mocks.projectFolderStatus.mockRejectedValue(new Error("offline"));
    await expect(loadFolderAccess("linked-a")).resolves.toBeUndefined();
    const state = useFolderAccessStore.getState();
    expect(state.loaded).toBe(true);
    expect(folderIsRestricted(state, "linked-a")).toBe(false);
    expect(folderIsReadOnly(state, "linked-a")).toBe(false);
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });

  it("drops an answer that arrives after another project opened", async () => {
    let answer: (value: unknown) => void = () => {};
    mocks.projectTrustState.mockImplementationOnce(
      () => new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const first = loadFolderAccess("linked-a");
    mocks.projectTrustState.mockResolvedValue(trusted);
    await loadFolderAccess("linked-b");
    answer(restricted);
    await first;
    const state = useFolderAccessStore.getState();
    expect(state.projectId).toBe("linked-b");
    expect(state.trust).toEqual(trusted);
  });

  it("turns capabilities on as soon as the folder is trusted", async () => {
    await loadFolderAccess("linked-a");
    mocks.trustFolder.mockResolvedValue(trusted);
    await expect(useFolderAccessStore.getState().grant("folder")).resolves.toBe(true);
    expect(mocks.trustFolder).toHaveBeenCalledWith("linked-a", "folder");
    expect(folderIsRestricted(useFolderAccessStore.getState(), "linked-a")).toBe(false);
    expect(useFolderAccessStore.getState().trusting).toBeNull();
  });

  it("stays quiet when the user cancels the trust confirmation", async () => {
    await loadFolderAccess("linked-a");
    mocks.trustFolder.mockRejectedValue(declined());
    await expect(useFolderAccessStore.getState().grant("parent")).resolves.toBe(false);
    expect(mocks.notifyError).not.toHaveBeenCalled();
    expect(folderIsRestricted(useFolderAccessStore.getState(), "linked-a")).toBe(true);
  });

  it("reports a failed grant once", async () => {
    await loadFolderAccess("linked-a");
    mocks.trustFolder.mockRejectedValue(new Error("disk full"));
    await useFolderAccessStore.getState().grant("folder");
    expect(mocks.notifyError).toHaveBeenCalledTimes(1);
    expect(mocks.notifyError.mock.calls[0]?.[2]).toBe(enShell.openedFolder.trust.failed);
  });

  it("ignores a second grant while one is waiting for confirmation", async () => {
    await loadFolderAccess("linked-a");
    let finish: (value: unknown) => void = () => {};
    mocks.trustFolder.mockImplementation(
      () => new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const first = useFolderAccessStore.getState().grant("folder");
    await expect(useFolderAccessStore.getState().grant("parent")).resolves.toBe(false);
    finish(trusted);
    await first;
    expect(mocks.trustFolder).toHaveBeenCalledTimes(1);
  });

  it("refreshes trust in place when the backend says it changed", async () => {
    await loadFolderAccess("linked-a");
    mocks.projectTrustState.mockResolvedValue(trusted);
    await useFolderAccessStore.getState().refreshTrust("linked-b");
    expect(folderIsRestricted(useFolderAccessStore.getState(), "linked-a")).toBe(true);
    await useFolderAccessStore.getState().refreshTrust("linked-a");
    expect(folderIsRestricted(useFolderAccessStore.getState(), "linked-a")).toBe(false);
  });

  it("remembers a hidden banner for the rest of the session", async () => {
    await loadFolderAccess("linked-a");
    useFolderAccessStore.getState().hideBanner();
    expect(useFolderAccessStore.getState().bannerHidden).toBe(true);
    await loadFolderAccess("linked-b");
    expect(useFolderAccessStore.getState().bannerHidden).toBe(false);
    await loadFolderAccess("linked-a");
    expect(useFolderAccessStore.getState().bannerHidden).toBe(true);
  });

  it("remembers a terminal that started before the folder was trusted", async () => {
    await loadFolderAccess("linked-a");
    const store = useFolderAccessStore.getState();
    store.noteTerminalStarted("linked-a", "early");
    expect(terminalNeedsReopen(useFolderAccessStore.getState(), "linked-a", "early")).toBe(false);
    mocks.trustFolder.mockResolvedValue(trusted);
    await useFolderAccessStore.getState().grant("folder");
    expect(terminalNeedsReopen(useFolderAccessStore.getState(), "linked-a", "early")).toBe(true);
    useFolderAccessStore.getState().noteTerminalStarted("linked-a", "late");
    expect(terminalNeedsReopen(useFolderAccessStore.getState(), "linked-a", "late")).toBe(false);
    useFolderAccessStore.getState().forgetTerminal("early");
    expect(terminalNeedsReopen(useFolderAccessStore.getState(), "linked-a", "early")).toBe(false);
  });

  it("settles a terminal that started before the folder's trust was known", async () => {
    useFolderAccessStore.getState().reset("linked-a");
    useFolderAccessStore.getState().noteTerminalStarted("linked-a", "a-early");
    mocks.projectTrustState.mockResolvedValue(trusted);
    await loadFolderAccess("linked-a");
    expect(terminalNeedsReopen(useFolderAccessStore.getState(), "linked-a", "a-early")).toBe(false);

    useFolderAccessStore.getState().reset("linked-b");
    useFolderAccessStore.getState().noteTerminalStarted("linked-b", "b-early");
    mocks.projectTrustState.mockResolvedValue(restricted);
    await loadFolderAccess("linked-b");
    mocks.projectTrustState.mockResolvedValue(trusted);
    await useFolderAccessStore.getState().refreshTrust("linked-b");
    expect(terminalNeedsReopen(useFolderAccessStore.getState(), "linked-b", "b-early")).toBe(true);
    await loadFolderAccess("linked-b");
    expect(terminalNeedsReopen(useFolderAccessStore.getState(), "linked-b", "b-early")).toBe(true);
    await loadFolderAccess("linked-c");
    expect(terminalNeedsReopen(useFolderAccessStore.getState(), "linked-b", "b-early")).toBe(false);
    expect(useFolderAccessStore.getState().limitedTerminals).toEqual({});
  });

  it("marks a read-only folder", async () => {
    mocks.projectFolderStatus.mockResolvedValue({ read_only: true, synced_with: "dropbox" });
    await loadFolderAccess("linked-a");
    const state = useFolderAccessStore.getState();
    expect(folderIsReadOnly(state, "linked-a")).toBe(true);
    expect(state.status?.synced_with).toBe("dropbox");
  });
});

describe("read-only folder status", () => {
  const readOnly = { read_only: true, synced_with: null };
  const writable = { read_only: false, synced_with: null };

  function pending() {
    let answer: (value: unknown) => void = () => {};
    mocks.projectFolderStatus.mockImplementationOnce(
      () => new Promise((resolve) => {
        answer = resolve;
      }),
    );
    return (value: unknown) => answer(value);
  }

  it("keeps the folder read-only while the same folder reloads its access", async () => {
    mocks.projectFolderStatus.mockResolvedValue(readOnly);
    await loadFolderAccess("linked-a");
    const seen: boolean[] = [];
    const stop = useFolderAccessStore.subscribe((state) => seen.push(folderIsReadOnly(state, "linked-a")));
    const answer = pending();
    const reload = loadFolderAccess("linked-a");
    expect(folderIsReadOnly(useFolderAccessStore.getState(), "linked-a")).toBe(true);
    answer(writable);
    await reload;
    stop();
    expect(seen).toEqual([true, false]);
  });

  it("keeps the last known status when a reload cannot read it", async () => {
    mocks.projectFolderStatus.mockResolvedValue(readOnly);
    await loadFolderAccess("linked-a");
    mocks.projectFolderStatus.mockRejectedValue(new Error("offline"));
    await loadFolderAccess("linked-a");
    expect(folderIsReadOnly(useFolderAccessStore.getState(), "linked-a")).toBe(true);
  });

  it("never carries a status over to another folder", async () => {
    mocks.projectFolderStatus.mockResolvedValue(readOnly);
    await loadFolderAccess("linked-a");
    const answer = pending();
    const next = loadFolderAccess("linked-b");
    expect(useFolderAccessStore.getState().status).toBeNull();
    answer(writable);
    await next;
    expect(folderIsReadOnly(useFolderAccessStore.getState(), "linked-b")).toBe(false);
  });

  it("rereads the status in place and unlocks a folder that became writable", async () => {
    mocks.projectFolderStatus.mockResolvedValue(readOnly);
    await loadFolderAccess("linked-a");
    mocks.projectFolderStatus.mockResolvedValue(writable);
    await refreshFolderStatus("linked-a");
    const state = useFolderAccessStore.getState();
    expect(folderIsReadOnly(state, "linked-a")).toBe(false);
    expect(state.loaded).toBe(true);
  });

  it("asks the backend once for overlapping rechecks of the same folder", async () => {
    mocks.projectFolderStatus.mockResolvedValue(writable);
    await loadFolderAccess("linked-a");
    mocks.projectFolderStatus.mockClear();
    const answer = pending();
    const first = refreshFolderStatus("linked-a");
    const second = refreshFolderStatus("linked-a");
    answer(readOnly);
    await Promise.all([first, second]);
    expect(mocks.projectFolderStatus).toHaveBeenCalledTimes(1);
    expect(folderIsReadOnly(useFolderAccessStore.getState(), "linked-a")).toBe(true);
  });

  it("drops a recheck that answers after another folder opened", async () => {
    mocks.projectFolderStatus.mockResolvedValue(writable);
    await loadFolderAccess("linked-a");
    const answer = pending();
    const late = refreshFolderStatus("linked-a");
    await loadFolderAccess("linked-b");
    answer(readOnly);
    await late;
    expect(useFolderAccessStore.getState().projectId).toBe("linked-b");
    expect(useFolderAccessStore.getState().status).toEqual(writable);
  });

  it("keeps the model's message in English whatever the interface language", async () => {
    await applyLocale("de");
    try {
      expect(readOnlyFolderMessageInEnglish()).toBe(enShell.openedFolder.readOnly.banner);
      expect(readOnlyFolderMessage()).not.toBe(enShell.openedFolder.readOnly.banner);
    } finally {
      await applyLocale("en");
    }
  });
});
