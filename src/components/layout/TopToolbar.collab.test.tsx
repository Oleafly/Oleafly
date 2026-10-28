// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ dialog: vi.fn() }));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isMaximized: () => Promise.resolve(false),
    onResized: () => Promise.resolve(() => {}),
    minimize: () => Promise.resolve(),
    toggleMaximize: () => Promise.resolve(),
    close: () => Promise.resolve(),
  }),
}));
vi.mock("@/features/collab/sharing/ShareDialog", () => ({
  ShareDialog: ({ projectId }: { projectId: string }) => {
    mocks.dialog(projectId);
    return <div role="dialog">{projectId}</div>;
  },
}));

import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { TopToolbar } from "./TopToolbar";
import { useShareDialog } from "@/components/collab/share-dialog";
import { useCollabLiveStore, type LivePeer } from "@/features/collab/live/live-store";
import { ALICE_ID, BOB, CAROL, CAROL_ID, person, projectMember, shareInfo } from "@/features/collab/tests/fixtures";
import { LATEX_ENGINE } from "@/lib/document-engine";
import { ThemeProvider } from "@/lib/theme";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";

const LAZY = { timeout: 5_000 };

function peer(deviceId: string, accountId: string): LivePeer {
  return { deviceId, accountId, person: null, path: null, cursor: null, anchor: null, seenAt: Date.now(), hue: 40 };
}

function toolbarItems(container: HTMLElement): string[] {
  const actions = container.querySelector('[data-toolbar-part="actions"]') as HTMLElement;
  return [...actions.children].map((element) => element.getAttribute("data-toolbar-item") ?? "");
}

function renderToolbar() {
  return render(
    <ThemeProvider>
      <TopToolbar />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useFilesStore.setState({
    projectId: "grant",
    projectName: "Grant proposal",
    projects: [],
    engineError: null,
    manifestHome: "library",
    engine: LATEX_ENGINE,
    engineLoaded: true,
    loading: false,
    mainDoc: "main.tex",
    activePath: null,
    files: {},
    tree: [{ path: "main.tex", is_dir: false }],
  } as unknown as ReturnType<typeof useFilesStore.getState>);
  useCompileStore.setState({ status: "idle", lastCompileCheckpoint: null });
  useSettingsStore.setState({ viewMode: "split", assistantOpen: false, workspaceHidden: false });
  useShareDialog.setState({ projectId: null, fromCopy: false });
  useCollabLiveStore.setState({
    projectId: "grant",
    share: shareInfo(),
    role: "owner",
    status: { state: "online" },
    pending: 0,
    peers: { alice: peer("alice", ALICE_ID), carol: peer("carol", CAROL_ID) },
    members: [projectMember(BOB, "owner"), projectMember(person(), "editor"), projectMember(CAROL, "viewer")],
  });
});

afterEach(() => {
  cleanup();
  useCollabLiveStore.setState({ projectId: null, share: null, status: null, pending: 0, peers: {}, members: [] });
});

describe("TopToolbar collaboration items", () => {
  it("keeps the avatars left of Recompile and puts Share right after version history", async () => {
    const view = renderToolbar();
    const share = await screen.findByRole("button", { name: enCollab.share.button }, LAZY);
    await waitFor(() => expect(view.container.querySelector('[data-toolbar-item="collab"]')).not.toBeNull(), LAZY);
    const items = toolbarItems(view.container);
    expect(items.slice(0, items.indexOf("history") + 2)).toEqual(["collab", "compile", "export", "fork", "history", "share"]);
    const collab = view.container.querySelector('[data-toolbar-item="collab"]');
    expect(collab).not.toHaveAttribute("data-overflow-order");
    expect(collab).not.toHaveAttribute("data-toolbar-icon");
    expect(collab?.querySelectorAll('[data-slot="avatar"]')).toHaveLength(2);
    const history = screen.getByRole("button", { name: enShell.toolbar.versioning });
    const shareItem = history.closest("[data-toolbar-item]")?.nextElementSibling;
    expect(shareItem).toHaveAttribute("data-toolbar-item", "share");
    expect(shareItem).toHaveAttribute("data-toolbar-icon");
    expect(shareItem).not.toHaveAttribute("data-overflow-order");
    expect(shareItem).toContainElement(share);
  });

  it("has no sync state button", async () => {
    renderToolbar();
    await screen.findByRole("button", { name: enCollab.share.button }, LAZY);
    for (const words of Object.values(enCollab.sync)) expect(screen.queryByRole("button", { name: words })).toBeNull();
    expect(document.querySelector("svg.lucide-cloud-check")).toBeNull();
  });

  it("keeps Share next to version history when nobody else is here", async () => {
    useCollabLiveStore.setState({ share: null, status: null, peers: {}, members: [] });
    const view = renderToolbar();
    await screen.findByRole("button", { name: enCollab.share.button }, LAZY);
    const items = toolbarItems(view.container);
    expect(items).not.toContain("collab");
    expect(items[items.indexOf("history") + 1]).toBe("share");
  });

  it("opens the share dialog from anywhere that asks for it", async () => {
    renderToolbar();
    act(() => useShareDialog.getState().openFor("grant"));
    expect(await screen.findByRole("dialog")).toHaveTextContent("grant");
  });
});
