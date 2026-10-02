// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenedFolder } from "@/lib/folder-detection";
import type { PendingOpenRequest } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { useCompileStore } from "@/store/compile";
import { useHomeViewStore } from "@/store/home-view";
import { useOpenFolderStore } from "@/store/open-folder";
import { useOpenFolderFlowStore } from "@/store/open-folder-flow";
import { useTourStore } from "@/store/tours";
import { beginChatRun, endChatRun } from "@/components/ai/chat-run-registry";
import { bootSplashHeld } from "@/lib/boot-telemetry";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };

const mocks = vi.hoisted(() => ({
  pendingOpenRequests: vi.fn(),
  beginOpenSession: vi.fn(),
  prepareOpenRequest: vi.fn(),
  discardOpenRequest: vi.fn(),
  openFolderRequest: vi.fn(),
  pickOpenFolder: vi.fn(),
  setRecentProjects: vi.fn(),
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
  toastErrorUnique: vi.fn(),
  logError: vi.fn(),
  offerQuickActionOnce: vi.fn(async () => {}),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  pendingOpenRequests: mocks.pendingOpenRequests,
  beginOpenSession: mocks.beginOpenSession,
  prepareOpenRequest: mocks.prepareOpenRequest,
  discardOpenRequest: mocks.discardOpenRequest,
  openFolderRequest: mocks.openFolderRequest,
  pickOpenFolder: mocks.pickOpenFolder,
  setRecentProjects: mocks.setRecentProjects,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (event: string, handler: (event: { payload: unknown }) => void) => {
    mocks.listeners.set(event, handler);
    return () => mocks.listeners.delete(event);
  }),
}));

vi.mock("@/lib/log", () => ({ logError: mocks.logError }));
vi.mock("@/features/quick-action-offer", () => ({
  offerQuickActionOnce: mocks.offerQuickActionOnce,
}));
vi.mock("@/lib/toast", () => ({
  toast: { errorUnique: mocks.toastErrorUnique, error: vi.fn(), success: vi.fn() },
  notifyError: vi.fn(),
}));

import {
  drainOpenRequests,
  openFolderWithPicker,
  openPendingRequest,
  openRecentProject,
  prepareColdOpen,
  startOpenRequestIntake,
  startRecentProjectsMenuSync,
} from "./open-folder";

const THESIS_ID = "linked-0123456789abcdef0123456789abcdef";
const NOTES_ID = "linked-fedcba9876543210fedcba9876543210";
const SESSION = 7;
const PERMISSION_HINTS = Object.values(enShell.openFolder.permissionHint);

function request(token: string, display_name: string): PendingOpenRequest {
  return { token, display_name, source: "forwarded" };
}

function opened(project_id: string, decision: "auto" | "ask" = "auto"): OpenedFolder {
  return {
    project_id,
    detection: {
      main: decision === "auto" ? "main.tex" : null,
      decision,
      source: "scan",
      candidates: [],
      truncated: false,
      compile_dir: null,
    },
  };
}

const openProject = vi.fn(async (id: string) => {
  useFilesStore.setState({ projectId: id, projectName: id, loading: false });
});
const refreshProjects = vi.fn(async () => {});
const stopCompile = vi.fn(async () => {});

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function settled() {
  for (let index = 0; index < 5; index += 1) await flush();
}

function mountSplash() {
  document.body.innerHTML =
    '<div id="oleafly-splash"><div id="oleafly-splash-stage">Initializing Oleafly</div></div>';
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listeners.clear();
  mocks.pendingOpenRequests.mockResolvedValue([]);
  mocks.beginOpenSession.mockResolvedValue(SESSION);
  mocks.discardOpenRequest.mockResolvedValue(undefined);
  useFilesStore.setState({
    projectId: null,
    projectName: "",
    saveBlocked: null,
    loading: false,
    projects: [],
    openProject,
    refreshProjects,
  });
  useCompileStore.setState({ status: "idle", stopCompile });
  useHomeViewStore.setState({ page: "library" });
  useOpenFolderStore.getState().dismiss();
  useOpenFolderFlowStore.setState({ prompt: null, refusal: null, opening: false });
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("open requests from the OS", () => {
  it("drains the cold-start request behind the splash and presents the folder once the editor switched", async () => {
    mountSplash();
    const thesis = request("t1", "thesis");
    prepareColdOpen([thesis]);
    expect(bootSplashHeld()).toBe(true);
    expect(document.getElementById("oleafly-splash-stage")?.textContent).toBe("Opening thesis…");
    mocks.pendingOpenRequests.mockResolvedValue([thesis]);
    mocks.openFolderRequest.mockResolvedValue(opened(THESIS_ID));

    const stop = await startOpenRequestIntake();
    await settled();

    expect(mocks.beginOpenSession).toHaveBeenCalledTimes(1);
    expect(mocks.beginOpenSession.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.pendingOpenRequests.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mocks.openFolderRequest).toHaveBeenCalledWith("t1", SESSION);
    expect(openProject).toHaveBeenCalledWith(THESIS_ID);
    expect(useOpenFolderStore.getState().opened).toEqual(opened(THESIS_ID));
    expect(bootSplashHeld()).toBe(false);
    expect(document.getElementById("oleafly-splash")).toBeNull();
    stop();
  });

  it("opens a warm arrival when the open-request event fires", async () => {
    const stop = await startOpenRequestIntake();
    await settled();
    expect(mocks.openFolderRequest).not.toHaveBeenCalled();

    mocks.pendingOpenRequests.mockResolvedValue([request("w1", "notes")]);
    mocks.openFolderRequest.mockResolvedValue(opened(NOTES_ID));
    mocks.listeners.get("open-request")?.({ payload: request("w1", "notes") });
    await settled();

    expect(mocks.beginOpenSession).not.toHaveBeenCalled();
    expect(mocks.openFolderRequest).toHaveBeenCalledWith("w1", SESSION);
    expect(openProject).toHaveBeenCalledWith(NOTES_ID);
    expect(useOpenFolderStore.getState().opened?.project_id).toBe(NOTES_ID);
    stop();
  });

  it("ignores File > Open Folder while a tour is running", async () => {
    const stop = await startOpenRequestIntake();
    await settled();
    useTourStore.setState({ activeTourId: "welcome" } as never);
    try {
      mocks.listeners.get("menu://open-folder")?.({ payload: null });
      await settled();
      expect(mocks.pickOpenFolder).not.toHaveBeenCalled();
    } finally {
      useTourStore.setState({ activeTourId: null } as never);
    }
    mocks.pickOpenFolder.mockResolvedValue(null);
    mocks.listeners.get("menu://open-folder")?.({ payload: null });
    await settled();
    expect(mocks.pickOpenFolder).toHaveBeenCalledTimes(1);
    stop();
  });

  it("opens a request once when a duplicate event and a drain race for the same token", async () => {
    const stop = await startOpenRequestIntake();
    await settled();
    mocks.pendingOpenRequests.mockResolvedValue([request("d1", "thesis")]);
    mocks.openFolderRequest.mockResolvedValue(opened(THESIS_ID));

    mocks.listeners.get("open-request")?.({ payload: request("d1", "thesis") });
    mocks.listeners.get("open-request")?.({ payload: request("d1", "thesis") });
    await drainOpenRequests();
    await settled();

    expect(mocks.openFolderRequest).toHaveBeenCalledTimes(1);
    expect(openProject).toHaveBeenCalledTimes(1);
    stop();
  });

  it("opens only the newest folder of a burst", async () => {
    mocks.pendingOpenRequests.mockResolvedValue([
      request("b1", "alpha"),
      request("b2", "beta"),
      request("b3", "gamma"),
    ]);
    mocks.openFolderRequest.mockResolvedValue(opened(NOTES_ID));

    await drainOpenRequests();

    expect(mocks.openFolderRequest).toHaveBeenCalledTimes(1);
    expect(mocks.openFolderRequest).toHaveBeenCalledWith("b3", SESSION);
  });

  it("releases the splash when a cold-start folder is refused and explains it in the library", async () => {
    mountSplash();
    prepareColdOpen([request("r1", "Documents")]);
    mocks.pendingOpenRequests.mockResolvedValue([request("r1", "Documents")]);
    mocks.openFolderRequest.mockRejectedValue(
      '@oleafly/error:{"code":"open_folder.too_broad","params":{"name":"Documents","browse":"scope-1"},"detail":null}',
    );

    await drainOpenRequests();

    expect(bootSplashHeld()).toBe(false);
    expect(openProject).not.toHaveBeenCalled();
    expect(useOpenFolderFlowStore.getState().refusal).toEqual({
      title: null,
      message: "Documents holds too much to open as one project. Choose a folder inside it.",
      hint: null,
      browse: "scope-1",
    });
    expect(mocks.toastErrorUnique).not.toHaveBeenCalled();
  });
});

describe("switching to an opened folder", () => {
  it("switches without asking when nothing is running", async () => {
    useFilesStore.setState({ projectId: "thesis-1", projectName: "Thesis" });
    mocks.openFolderRequest.mockResolvedValue(opened(NOTES_ID));

    await expect(openPendingRequest(request("s1", "notes"))).resolves.toBe("opened");

    expect(useOpenFolderFlowStore.getState().prompt).toBeNull();
    expect(openProject).toHaveBeenCalledWith(NOTES_ID);
  });

  it("asks before stopping a running compile and never claims the folder when declined", async () => {
    useFilesStore.setState({ projectId: "thesis-1", projectName: "Thesis" });
    useCompileStore.setState({ status: "compiling" });
    mocks.prepareOpenRequest.mockResolvedValue({ project_id: null, display_name: "notes" });
    mocks.openFolderRequest.mockResolvedValue(opened(NOTES_ID));

    const outcome = openPendingRequest(request("c1", "./notes"));
    await settled();
    expect(mocks.prepareOpenRequest).toHaveBeenCalledWith("c1", SESSION);
    expect(useOpenFolderFlowStore.getState().prompt).toEqual({
      name: "notes",
      project: "Thesis",
      compile: true,
      assistant: false,
    });
    useOpenFolderFlowStore.getState().answer(false);

    await expect(outcome).resolves.toBe("declined");
    expect(mocks.openFolderRequest).not.toHaveBeenCalled();
    expect(mocks.discardOpenRequest).toHaveBeenCalledWith("c1", SESSION);
    expect(stopCompile).not.toHaveBeenCalled();
    expect(openProject).not.toHaveBeenCalled();
    expect(useOpenFolderStore.getState().opened).toBeNull();
  });

  it("explains a refusal found while checking a busy switch without asking", async () => {
    useFilesStore.setState({ projectId: "thesis-1", projectName: "Thesis" });
    useCompileStore.setState({ status: "compiling" });
    mocks.prepareOpenRequest.mockRejectedValue(
      '@oleafly/error:{"code":"open_folder.not_found","params":{},"detail":null}',
    );

    await expect(openPendingRequest(request("r2", "gone"))).resolves.toBe("refused");

    expect(useOpenFolderFlowStore.getState().prompt).toBeNull();
    expect(mocks.openFolderRequest).not.toHaveBeenCalled();
    expect(mocks.toastErrorUnique).toHaveBeenCalledWith(
      "open-folder:open_folder.not_found",
      "Couldn't open gone. Oleafly can't find this folder.",
      undefined,
      false,
    );
  });

  it("stops the compile and the assistant turn before switching when confirmed", async () => {
    useFilesStore.setState({ projectId: "thesis-1", projectName: "Thesis" });
    useCompileStore.setState({ status: "compiling" });
    const controller = new AbortController();
    const run = beginChatRun(controller, "thesis-1");
    mocks.prepareOpenRequest.mockResolvedValue({ project_id: NOTES_ID, display_name: "notes" });
    mocks.openFolderRequest.mockResolvedValue(opened(NOTES_ID, "ask"));

    const outcome = openPendingRequest(request("c2", "notes"));
    await settled();
    expect(useOpenFolderFlowStore.getState().prompt).toMatchObject({
      compile: true,
      assistant: true,
    });
    expect(mocks.openFolderRequest).not.toHaveBeenCalled();
    useOpenFolderFlowStore.getState().answer(true);

    await expect(outcome).resolves.toBe("opened");
    expect(stopCompile).toHaveBeenCalledTimes(1);
    expect(controller.signal.aborted).toBe(true);
    expect(openProject).toHaveBeenCalledWith(NOTES_ID);
    expect(useOpenFolderStore.getState().opened?.detection.decision).toBe("ask");
    endChatRun(run);
  });

  it("focuses a folder that is already open without asking or switching", async () => {
    useFilesStore.setState({ projectId: THESIS_ID, projectName: "thesis" });
    useCompileStore.setState({ status: "compiling" });
    mocks.prepareOpenRequest.mockResolvedValue({ project_id: THESIS_ID, display_name: "thesis" });
    mocks.openFolderRequest.mockResolvedValue(opened(THESIS_ID));

    await expect(openPendingRequest(request("f1", "thesis"))).resolves.toBe("focused");

    expect(useOpenFolderFlowStore.getState().prompt).toBeNull();
    expect(openProject).not.toHaveBeenCalled();
    expect(useOpenFolderStore.getState().opened?.project_id).toBe(THESIS_ID);
  });

  it("presents the folder only after a save-blocked switch finally goes through", async () => {
    useFilesStore.setState({ projectId: "thesis-1", projectName: "Thesis" });
    openProject.mockImplementationOnce(async (id: string) => {
      useFilesStore.setState({
        saveBlocked: { action: "switch", targetProjectId: id, failures: [] },
      });
    });
    mocks.openFolderRequest.mockResolvedValue(opened(NOTES_ID));

    await expect(openPendingRequest(request("sb", "notes"))).resolves.toBe("blocked");
    expect(useOpenFolderStore.getState().opened).toBeNull();

    await useFilesStore.getState().discardUnsavedAndLeave();

    expect(openProject).toHaveBeenLastCalledWith(NOTES_ID);
    expect(useOpenFolderStore.getState().opened?.project_id).toBe(NOTES_ID);
  });

  it("forgets the folder when the save-blocked switch is cancelled", async () => {
    useFilesStore.setState({ projectId: "thesis-1", projectName: "Thesis" });
    openProject.mockImplementationOnce(async (id: string) => {
      useFilesStore.setState({
        saveBlocked: { action: "switch", targetProjectId: id, failures: [] },
      });
    });
    mocks.openFolderRequest.mockResolvedValue(opened(NOTES_ID, "ask"));

    await expect(openPendingRequest(request("sc", "notes"))).resolves.toBe("blocked");
    useFilesStore.getState().dismissSaveBlocked();
    await useFilesStore.getState().openProject(NOTES_ID);

    expect(useFilesStore.getState().projectId).toBe(NOTES_ID);
    expect(useOpenFolderStore.getState().opened).toBeNull();
  });

  it("shows a refusal as a toast when a project is open", async () => {
    useFilesStore.setState({ projectId: "thesis-1", projectName: "Thesis" });
    mocks.openFolderRequest.mockRejectedValue(
      '@oleafly/error:{"code":"open_folder.not_found","params":{},"detail":null}',
    );

    await expect(openPendingRequest(request("x1", "gone"))).resolves.toBe("refused");

    expect(mocks.toastErrorUnique).toHaveBeenCalledWith(
      "open-folder:open_folder.not_found",
      "Couldn't open gone. Oleafly can't find this folder.",
      undefined,
      false,
    );
    expect(useOpenFolderFlowStore.getState().refusal).toBeNull();
  });

  it.each([
    { requested: "ada", label: "the same name" },
    { requested: "ADA", label: "a different letter case" },
  ])("states a too-broad refusal once, with Choose a subfolder, for $label", async ({ requested }) => {
    const reason = "ada holds too much to open as one project. Choose a folder inside it.";
    mocks.openFolderRequest.mockRejectedValue(
      '@oleafly/error:{"code":"open_folder.too_broad","params":{"name":"ada","browse":"scope-2"},"detail":null}',
    );
    mocks.pickOpenFolder.mockResolvedValue(null);

    await expect(openPendingRequest(request("tb1", requested))).resolves.toBe("refused");

    expect(useOpenFolderFlowStore.getState().refusal).toEqual({
      title: null,
      message: reason,
      hint: null,
      browse: "scope-2",
    });
    expect(mocks.toastErrorUnique).not.toHaveBeenCalled();

    useFilesStore.setState({ projectId: "thesis-1", projectName: "Thesis" });
    await expect(openPendingRequest(request("tb2", requested))).resolves.toBe("refused");

    expect(mocks.toastErrorUnique).toHaveBeenCalledTimes(1);
    expect(mocks.toastErrorUnique).toHaveBeenCalledWith(
      "open-folder:open_folder.too_broad",
      reason,
      { label: "Choose a subfolder", onClick: expect.any(Function) },
      false,
    );
    const action = mocks.toastErrorUnique.mock.calls[0]?.[2] as { onClick: () => void };
    action.onClick();
    await settled();
    expect(mocks.pickOpenFolder).toHaveBeenCalledWith("scope-2");
  });

  it.each([
    {
      code: "protected",
      params: { name: "System" },
      folder: "System",
      reason: "Oleafly can't open folders inside System.",
    },
    {
      code: "protected",
      params: { name: "System" },
      folder: "Library",
      reason: "Oleafly can't open folders inside System.",
    },
    {
      code: "contains_project",
      params: { name: "thesis" },
      folder: "thesis",
      reason: "This folder contains thesis, which is already open in Oleafly as its own project.",
    },
    {
      code: "research_folder",
      params: { project: "Notes" },
      folder: "Notes",
      reason:
        "Notes can already edit files in this folder through its linked folders. Unlink it there first.",
    },
  ])("keeps naming $folder in a $code refusal", async ({ code, params, folder, reason }) => {
    mocks.openFolderRequest.mockRejectedValue(
      `@oleafly/error:${JSON.stringify({ code: `open_folder.${code}`, params, detail: null })}`,
    );

    await expect(openPendingRequest(request("kp1", folder))).resolves.toBe("refused");

    expect(useOpenFolderFlowStore.getState().refusal).toEqual({
      title: `Couldn't open ${folder}`,
      message: reason,
      hint: null,
      browse: null,
    });

    useFilesStore.setState({ projectId: "thesis-1", projectName: "Thesis" });
    await expect(openPendingRequest(request("kp2", folder))).resolves.toBe("refused");

    expect(mocks.toastErrorUnique).toHaveBeenCalledWith(
      `open-folder:open_folder.${code}`,
      `Couldn't open ${folder}. ${reason}`,
      undefined,
      false,
    );
  });

  it("names the folder and says what to do next when permission is denied", async () => {
    const denied =
      '@oleafly/error:{"code":"open_folder.permission_denied","params":{},"detail":null}';
    mocks.openFolderRequest.mockRejectedValue(denied);

    await expect(openPendingRequest(request("pd", "Private"))).resolves.toBe("refused");

    const refusal = useOpenFolderFlowStore.getState().refusal;
    expect(refusal?.title).toBe("Couldn't open Private");
    expect(refusal?.message).toBe("Oleafly doesn't have permission to open this folder.");
    expect(PERMISSION_HINTS).toContain(refusal?.hint);

    useFilesStore.setState({ projectId: "thesis-1", projectName: "Thesis" });
    await expect(openPendingRequest(request("pd2", "Private"))).resolves.toBe("refused");
    expect(mocks.toastErrorUnique).toHaveBeenCalledWith(
      "open-folder:open_folder.permission_denied",
      `Couldn't open Private. Oleafly doesn't have permission to open this folder. ${refusal?.hint}`,
      undefined,
      true,
    );
  });
});

describe("the folder picker", () => {
  it("does nothing when the picker is cancelled", async () => {
    mocks.pickOpenFolder.mockResolvedValue(null);
    await expect(openFolderWithPicker()).resolves.toBe("cancelled");
    expect(mocks.openFolderRequest).not.toHaveBeenCalled();
  });

  it("opens the picked folder by its token and can browse inside a refused folder", async () => {
    mocks.pickOpenFolder.mockResolvedValue({
      token: "p1",
      display_name: "paper",
      source: "picker",
    });
    mocks.openFolderRequest.mockResolvedValue(opened(THESIS_ID));

    await expect(openFolderWithPicker("scope-1")).resolves.toBe("opened");

    expect(mocks.pickOpenFolder).toHaveBeenCalledWith("scope-1");
    expect(mocks.openFolderRequest).toHaveBeenCalledWith("p1", SESSION);
    expect(openProject).toHaveBeenCalledWith(THESIS_ID);
    expect(useOpenFolderFlowStore.getState().opening).toBe(false);
  });

  it("offers the Finder Quick Action only after a picked folder opens", async () => {
    mocks.pickOpenFolder.mockResolvedValueOnce(null);
    await openFolderWithPicker();
    mocks.pickOpenFolder.mockResolvedValueOnce(request("p2", "home"));
    mocks.openFolderRequest.mockRejectedValueOnce(
      '@oleafly/error:{"code":"open_folder.not_found","params":{},"detail":null}',
    );
    await expect(openFolderWithPicker()).resolves.toBe("refused");
    expect(mocks.offerQuickActionOnce).not.toHaveBeenCalled();

    mocks.pickOpenFolder.mockResolvedValueOnce(request("p3", "paper"));
    mocks.openFolderRequest.mockResolvedValueOnce(opened(THESIS_ID));
    await expect(openFolderWithPicker()).resolves.toBe("opened");
    expect(mocks.offerQuickActionOnce).toHaveBeenCalledTimes(1);
  });

  it("never offers the Quick Action for folders the OS or another launch sends", async () => {
    mocks.openFolderRequest.mockResolvedValueOnce(opened(THESIS_ID));
    await expect(openPendingRequest(request("x9", "thesis"))).resolves.toBe("opened");
    expect(mocks.offerQuickActionOnce).not.toHaveBeenCalled();
  });

  it("opens a recent project through the same stop prompt", async () => {
    useFilesStore.setState({
      projectId: "thesis-1",
      projectName: "Thesis",
      projects: [{ id: NOTES_ID, name: "Notes" }] as never[],
    });
    useCompileStore.setState({ status: "compiling" });

    const done = openRecentProject(NOTES_ID);
    await settled();
    expect(useOpenFolderFlowStore.getState().prompt?.name).toBe("Notes");
    useOpenFolderFlowStore.getState().answer(true);
    await done;

    expect(openProject).toHaveBeenCalledWith(NOTES_ID);
  });
});

describe("the Open Recent menu", () => {
  it("sends the ten most recent projects and skips unchanged lists", async () => {
    mocks.setRecentProjects.mockResolvedValue(undefined);
    const projects = Array.from({ length: 12 }, (_, index) => ({
      id: `p-${index}`,
      name: `Project ${index}`,
      updated_at: index,
    }));
    useFilesStore.setState({ projects: projects as never[] });

    const stop = startRecentProjectsMenuSync(true);
    expect(mocks.setRecentProjects).toHaveBeenCalledTimes(1);
    const sent = mocks.setRecentProjects.mock.calls[0]?.[0] as { id: string }[];
    expect(sent).toHaveLength(10);
    expect(sent[0]).toEqual({ id: "p-11", name: "Project 11" });

    useFilesStore.setState({ projects: [...projects] as never[] });
    expect(mocks.setRecentProjects).toHaveBeenCalledTimes(1);
    stop();
  });

  it("never touches the menu where there is none", () => {
    startRecentProjectsMenuSync(false)();
    expect(mocks.setRecentProjects).not.toHaveBeenCalled();
  });
});
