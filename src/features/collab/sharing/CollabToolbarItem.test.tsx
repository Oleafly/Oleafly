// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Profiler } from "react";
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

import { CollabShareButton, CollabToolbarItem } from "./CollabToolbarItem";

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

describe("CollabShareButton", () => {
  it("offers Share on a project that is not shared yet", async () => {
    const user = userEvent.setup();
    render(<CollabShareButton />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: share.button }));
    expect(useShareDialog.getState()).toMatchObject({ projectId: "grant", fromCopy: false });
  });

  it("is an icon button with the same name and tooltip as the other toolbar actions", () => {
    render(<CollabShareButton />);
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
    render(<CollabShareButton />);
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
    render(<CollabShareButton />);
    await waitFor(() => expect(useCollabStore.getState().status).toBe("ready"));
    await user.click(screen.getByRole("button", { name: share.copyAndShare }));
    expect(mocks.copyIntoLibrary).not.toHaveBeenCalled();
    expect(useShareDialog.getState().projectId).toBe("grant");
  });

  it("no longer puts a sync state button in the toolbar", () => {
    liveShared({ state: "online" });
    render(
      <>
        <CollabToolbarItem />
        <CollabShareButton />
      </>,
    );
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: share.button })).toBeInTheDocument();
    for (const words of Object.values(sync)) expect(screen.queryByRole("button", { name: words })).toBeNull();
  });

  it("keeps the plain Share tooltip while the project is not shared", () => {
    vi.useFakeTimers();
    try {
      render(<CollabShareButton />);
      const tip = hover(screen.getByRole("button", { name: share.button }).parentElement as Element);
      expect(tip).toHaveTextContent(new RegExp(`^${share.button}$`));
    } finally {
      vi.useRealTimers();
    }
  });

  it.each<[CollabLiveState | null, number, string]>([
    [{ state: "online" }, 0, sync.upToDate],
    [{ state: "online" }, 2, sync.syncing],
    [{ state: "offline", retry_in_ms: 1000 }, 47, fill(sync.offline, { number: "47" })],
    [{ state: "offline", retry_in_ms: 1000 }, 0, sync.reconnecting],
    [{ state: "ended", reason: "signed_out" }, 0, sync.signedOut],
    [{ state: "ended", reason: "stopped" }, 0, sync.paused],
    [null, 0, sync.syncing],
  ])("names the sync state %j with %i waiting in the Share tooltip", (status, pending, words) => {
    vi.useFakeTimers();
    try {
      liveShared(status, pending);
      render(<CollabShareButton />);
      const button = screen.getByRole("button", { name: share.button });
      const tip = hover(button.parentElement as Element);
      expect(tip).toHaveTextContent(share.button);
      expect(tip).toHaveTextContent(words);
      expect(button).toHaveAttribute("aria-describedby", tip.id);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each<["removed" | "archived" | "signed_out", string]>([
    ["removed", sync.removed],
    ["archived", sync.archived],
    ["signed_out", sync.signedOut],
  ])("keeps saying why sync ended (%s) on the Share button after the project stops being shared", (reason, words) => {
    vi.useFakeTimers();
    try {
      useCollabLiveStore.setState({
        projectId: "grant",
        share: null,
        status: { state: "ended", reason },
        ended: reason,
        peers: {},
      });
      const { container } = render(
        <>
          <CollabToolbarItem />
          <CollabShareButton />
        </>,
      );
      expect(container.querySelector('[data-toolbar-item="collab"]')).toBeNull();
      const tip = hover(screen.getByRole("button", { name: share.button }).parentElement as Element);
      expect(tip).toHaveTextContent(words);
    } finally {
      vi.useRealTimers();
    }
  });

  it("follows the sync state as it changes", () => {
    vi.useFakeTimers();
    try {
      liveShared({ state: "online" }, 0);
      render(<CollabShareButton />);
      const host = screen.getByRole("button", { name: share.button }).parentElement as Element;
      expect(hover(host)).toHaveTextContent(sync.upToDate);
      act(() => useCollabLiveStore.setState({ status: { state: "offline", retry_in_ms: 500 }, pending: 3 }));
      expect(screen.getByRole("tooltip")).toHaveTextContent(fill(sync.offline, { number: "3" }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves the Share tooltip alone for a different project's live state", () => {
    vi.useFakeTimers();
    try {
      liveShared({ state: "ended", reason: "removed" });
      useCollabLiveStore.setState({ projectId: "other" });
      render(<CollabShareButton />);
      const tip = hover(screen.getByRole("button", { name: share.button }).parentElement as Element);
      expect(tip).not.toHaveTextContent(sync.removed);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("CollabToolbarItem", () => {
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
      expect(tip).toHaveClass("max-w-xs");
      const rows = [...(tip?.querySelectorAll('[data-slot="hidden-person"]') ?? [])];
      expect(rows).toHaveLength(2);
      expect(rows[0]).toHaveTextContent(/^Eli.*Eli\.tex$/);
      expect(rows[0]).toHaveClass("whitespace-nowrap");
    } finally {
      vi.useRealTimers();
    }
  });

  it("draws the avatars at the toolbar size in their own measured toolbar item", () => {
    liveShared({ state: "online" }, 0, {
      alice: peer("alice", ALICE_ID, "intro.tex"),
      carol: peer("carol", CAROL_ID, null),
    });
    const { container } = render(<CollabToolbarItem />);
    const item = container.querySelector('[data-toolbar-item="collab"]') as HTMLElement;
    expect(item).not.toHaveAttribute("data-toolbar-icon");
    expect(item).not.toHaveAttribute("data-overflow-order");
    const avatars = item.querySelectorAll('[data-slot="avatar"]');
    expect(avatars).toHaveLength(2);
    for (const avatar of avatars) expect(avatar).toHaveClass("size-7", "p-1", "border-2", "border-background");
    expect(avatars[0]).toHaveTextContent(/^AC$/);
    expect(avatars[1]).toHaveTextContent(/^CD$/);
    expect(avatars[1].parentElement).toHaveClass("-ml-1");
  });

  it("adds no toolbar item while nobody else is here", () => {
    liveShared({ state: "online" }, 0, { mine: peer("mine", BOB_ID, "main.tex") });
    const { container } = render(<CollabToolbarItem />);
    expect(container).toBeEmptyDOMElement();
  });

  it("adds no toolbar item for a project that is not shared", () => {
    useCollabLiveStore.setState({ peers: { alice: peer("alice", ALICE_ID, null) } });
    const { container } = render(<CollabToolbarItem />);
    expect(container).toBeEmptyDOMElement();
  });

  it("does not redraw the avatars while people only move their cursors", () => {
    liveShared({ state: "online" }, 0, {
      alice: peer("alice", ALICE_ID, "intro.tex"),
      carol: peer("carol", CAROL_ID, null),
    });
    let commits = 0;
    const { container } = render(
      <Profiler id="toolbar" onRender={() => (commits += 1)}>
        <CollabToolbarItem />
      </Profiler>,
    );
    commits = 0;
    for (let cursor = 1; cursor <= 20; cursor += 1) {
      act(() =>
        useCollabLiveStore.setState({
          peers: {
            alice: { ...peer("alice", ALICE_ID, "intro.tex"), cursor, anchor: cursor },
            carol: peer("carol", CAROL_ID, null),
          },
        }),
      );
    }
    expect(commits).toBe(0);
    act(() => useCollabLiveStore.setState({ peers: { alice: peer("alice", ALICE_ID, "intro.tex") } }));
    expect(commits).toBe(1);
    expect(container.querySelectorAll('[data-slot="avatar"]')).toHaveLength(1);
  });
});
