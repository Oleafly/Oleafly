// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import type { CollabLiveState } from "@/lib/tauri";
import { useShareDialog } from "@/components/collab/share-dialog";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { useCollabLiveStore, type LivePeer } from "../live/live-store";
import { useCollabStore } from "../store";
import {
  ALICE_ID,
  BOB,
  BOB_ID,
  CAROL,
  CAROL_ID,
  fill,
  libraryProject,
  person,
  projectMember,
  server,
  shareInfo,
} from "../tests/fixtures";

const mocks = vi.hoisted(() => ({ copyIntoLibrary: vi.fn(), collabServersList: vi.fn() }));

vi.mock("@/store/copy-into-library", () => ({ copyIntoLibrary: mocks.copyIntoLibrary }));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  collabServersList: mocks.collabServersList,
}));

import { CollabToolbarItem } from "./CollabToolbarItem";

const share = enCollab.share;
const sync = enCollab.sync;
const toolbar = enCollab.toolbar;

function peer(deviceId: string, accountId: string, path: string | null): LivePeer {
  return { deviceId, accountId, person: null, path, cursor: 0, anchor: 0, seenAt: Date.now(), hue: 120 };
}

function liveShared(status: CollabLiveState | null, pending = 0, peers: Record<string, LivePeer> = {}) {
  useCollabLiveStore.setState({
    projectId: "grant",
    share: shareInfo(),
    role: "owner",
    status,
    pending,
    peers,
    members: [projectMember(BOB, "owner"), projectMember(person(), "editor"), projectMember(CAROL, "viewer")],
  });
}

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.collabServersList.mockResolvedValue([server()]);
  useShareDialog.setState({ projectId: null, fromCopy: false });
  useCollabStore.setState({ servers: [], status: "idle", loadError: null, pending: {} });
  useFilesStore.setState({ projectId: "grant", projects: [libraryProject()] });
  useCollabLiveStore.setState({ projectId: "grant", share: null, status: null, pending: 0, peers: {}, members: [] });
  useSettingsStore.setState({ railTab: "files", showTree: false });
});

function hover(element: Element) {
  fireEvent.mouseEnter(element);
  act(() => vi.advanceTimersByTime(400));
  return screen.getByRole("tooltip");
}

describe("CollabToolbarItem", () => {
  it("offers Share on a project that is not shared yet", async () => {
    const user = userEvent.setup();
    render(<CollabToolbarItem />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: share.button }));
    expect(useShareDialog.getState()).toMatchObject({ projectId: "grant", fromCopy: false });
  });

  it("is an icon button with the same name and tooltip as the other toolbar actions", () => {
    render(<CollabToolbarItem />);
    const button = screen.getByRole("button", { name: share.button });
    expect(button).toHaveAttribute("aria-label", share.button);
    expect(button.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("copies an opened folder into Oleafly in one click and continues sharing the copy", async () => {
    mocks.copyIntoLibrary.mockResolvedValue("grant-copy");
    useFilesStore.setState({
      projects: [libraryProject({ location: { kind: "linked", display_path: "~/grant", availability: "ok" } })],
    });
    const user = userEvent.setup();
    render(<CollabToolbarItem />);
    await waitFor(() => expect(useCollabStore.getState().status).toBe("ready"));
    await user.click(screen.getByRole("button", { name: share.copyAndShare }));
    expect(mocks.copyIntoLibrary).toHaveBeenCalledWith("grant", "Grant proposal", { openAfterCopy: true });
    await waitFor(() => expect(useShareDialog.getState()).toMatchObject({ projectId: "grant-copy", fromCopy: true }));
  });

  it("opens the dialog instead of copying when no server is signed in", async () => {
    mocks.collabServersList.mockResolvedValue([]);
    useFilesStore.setState({
      projects: [libraryProject({ location: { kind: "linked", display_path: "~/grant", availability: "ok" } })],
    });
    const user = userEvent.setup();
    render(<CollabToolbarItem />);
    await waitFor(() => expect(useCollabStore.getState().status).toBe("ready"));
    await user.click(screen.getByRole("button", { name: share.copyAndShare }));
    expect(mocks.copyIntoLibrary).not.toHaveBeenCalled();
    expect(useShareDialog.getState().projectId).toBe("grant");
  });

  it("opens the Live collaboration pane from the sync state button", async () => {
    liveShared({ state: "online" });
    const user = userEvent.setup();
    render(<CollabToolbarItem />);
    await user.click(screen.getByRole("button", { name: sync.upToDate }));
    expect(useSettingsStore.getState()).toMatchObject({ railTab: "collab", showTree: true });
  });

  it("shows who is here as plain avatars with a tooltip each, never inside a button", () => {
    vi.useFakeTimers();
    try {
      liveShared({ state: "online" }, 0, {
        mine: peer("mine", BOB_ID, "main.tex"),
        alice: peer("alice", ALICE_ID, "intro.tex"),
        aliceLaptop: peer("aliceLaptop", ALICE_ID, null),
        carol: peer("carol", CAROL_ID, null),
      });
      const { container } = render(<CollabToolbarItem />);
      const stack = container.querySelector('[data-slot="avatar-stack"]') as HTMLElement;
      expect(stack.closest("button")).toBeNull();
      expect(within(stack).queryByRole("button")).toBeNull();
      const avatars = stack.querySelectorAll('[data-slot="avatar"]');
      expect(avatars).toHaveLength(2);
      const alice = hover(avatars[0].parentElement as Element);
      expect(alice).toHaveTextContent("Alice Chen");
      expect(alice).toHaveTextContent(enCollab.projectRoles.editor);
      expect(alice).toHaveTextContent("intro.tex");
      fireEvent.mouseLeave(avatars[0].parentElement as Element);
      const carol = hover(avatars[1].parentElement as Element);
      expect(carol).toHaveTextContent("Carol Diaz");
      expect(carol).toHaveTextContent(enCollab.projectRoles.viewer);
      expect(carol).toHaveTextContent(toolbar.noFile);
      expect(stack).not.toHaveTextContent("Bob Smith");
    } finally {
      vi.useRealTimers();
    }
  });

  it("lists everyone the counter hides in its tooltip", () => {
    vi.useFakeTimers();
    try {
      const names = ["Ann", "Ben", "Cat", "Dev", "Eli", "Fay"];
      const peers = Object.fromEntries(
        names.map((name, index) => [`d${index}`, { ...peer(`d${index}`, `acc-${name}`, `${name}.tex`), person: person({ account_id: `acc-${name}`, display_name: name }) }]),
      );
      liveShared({ state: "online" }, 0, peers);
      const { container } = render(<CollabToolbarItem />);
      const more = container.querySelector('[data-slot="avatar-more"]') as HTMLElement;
      expect(more).toHaveTextContent("+2");
      const tip = hover(more.parentElement as Element);
      expect(tip).toHaveTextContent("Eli");
      expect(tip).toHaveTextContent("Eli.tex");
      expect(tip).toHaveTextContent("Fay");
      expect(tip).toHaveTextContent("Fay.tex");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps saying why sync ended after the project stops being shared", () => {
    useCollabLiveStore.setState({
      projectId: "grant",
      share: null,
      status: { state: "ended", reason: "removed" },
      ended: "removed",
      peers: {},
    });
    render(<CollabToolbarItem />);
    expect(screen.getByRole("button", { name: sync.removed })).toBeInTheDocument();
  });

  it.each<[CollabLiveState | null, number, string]>([
    [{ state: "online" }, 2, sync.syncing],
    [{ state: "offline", retry_in_ms: 1000 }, 47, fill(sync.offline, { number: "47" })],
    [{ state: "offline", retry_in_ms: 1000 }, 0, sync.reconnecting],
    [{ state: "ended", reason: "signed_out" }, 0, sync.signedOut],
    [{ state: "ended", reason: "removed" }, 0, sync.removed],
    [{ state: "ended", reason: "archived" }, 0, sync.archived],
    [null, 0, sync.syncing],
  ])("names the sync state %j with %i waiting in words", (status, pending, words) => {
    liveShared(status, pending);
    render(<CollabToolbarItem />);
    expect(screen.getByRole("button", { name: words })).toBeInTheDocument();
  });

  it("follows the sync state as it changes", () => {
    liveShared({ state: "online" }, 0);
    render(<CollabToolbarItem />);
    act(() => useCollabLiveStore.setState({ status: { state: "offline", retry_in_ms: 500 }, pending: 3 }));
    expect(screen.getByRole("button", { name: fill(sync.offline, { number: "3" }) })).toBeInTheDocument();
  });
});
