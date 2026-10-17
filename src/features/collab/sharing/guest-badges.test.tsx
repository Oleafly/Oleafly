// @vitest-environment jsdom

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { useShareDialog } from "@/components/collab/share-dialog";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { resetSidebarViewState } from "@/store/sidebar-view-state";
import { useCollabLiveStore, type LivePeer } from "../live/live-store";
import { ALICE_ID, BOB, BOB_ID, CAROL, CAROL_ID, person, projectMember, shareInfo } from "../tests/fixtures";
import { useCollabActivity } from "./activity-store";
import { presentPeople } from "./presence";

vi.mock("@/lib/tauri-collab", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri-collab")>()),
  collabTrashList: vi.fn(async () => []),
  collabTrashRestore: vi.fn(async () => undefined),
}));

import { CollabPane } from "./CollabPane";
import { CollabToolbarItem } from "./CollabToolbarItem";

const GUEST = enCollab.guests.badge;
const GUEST_CAROL = { ...CAROL, guest: true };

function peer(deviceId: string, accountId: string, path: string | null): LivePeer {
  return { deviceId, accountId, person: null, path, cursor: 0, anchor: 0, seenAt: Date.now(), hue: 120 };
}

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  localStorage.clear();
  resetSidebarViewState();
  useFilesStore.setState({ projectId: "grant" });
  useSettingsStore.setState({ railTab: "collab", showTree: true });
  useShareDialog.setState({ projectId: null, fromCopy: false });
  useCollabActivity.setState({ projectId: "grant", entries: [], unread: false });
  useCollabLiveStore.setState({
    projectId: "grant",
    share: shareInfo({ role: "owner", account_id: BOB_ID }),
    role: "owner",
    status: { state: "online" },
    pending: 0,
    peers: {
      mine: peer("mine", BOB_ID, "main.tex"),
      alice: peer("alice", ALICE_ID, "intro.tex"),
      carol: peer("carol", CAROL_ID, null),
    },
    members: [projectMember(BOB, "owner"), projectMember(person(), "editor"), projectMember(GUEST_CAROL, "viewer")],
    merged: null,
    newDevice: null,
    ended: null,
  });
});

afterEach(() => {
  useCollabActivity.setState({ projectId: null, entries: [], unread: false });
  useFilesStore.setState({ projectId: null });
  resetSidebarViewState();
});

describe("guest badges where people are listed", () => {
  it("marks guests in the pane's People list only", () => {
    render(<CollabPane />);
    const rows = within(screen.getByRole("list", { name: enCollab.pane.people })).getAllByRole("listitem");
    const carol = rows.find((row) => row.textContent?.includes("Carol Diaz"));
    const alice = rows.find((row) => row.textContent?.includes("Alice Chen"));
    expect(carol && within(carol).getByText(GUEST)).toBeInTheDocument();
    expect(alice && within(alice).queryByText(GUEST)).toBeNull();
  });

  it("says Guest in the toolbar tooltip of a guest and not of anyone else", () => {
    vi.useFakeTimers();
    try {
      const { container } = render(<CollabToolbarItem />);
      const avatars = container.querySelectorAll('[data-slot="avatar"]');
      const hover = (element: Element) => {
        fireEvent.mouseEnter(element);
        act(() => vi.advanceTimersByTime(400));
        return screen.getByRole("tooltip");
      };
      const alice = hover(avatars[0].parentElement as Element);
      expect(alice).toHaveTextContent("Alice Chen");
      expect(alice).not.toHaveTextContent(GUEST);
      fireEvent.mouseLeave(avatars[0].parentElement as Element);
      const carol = hover(avatars[1].parentElement as Element);
      expect(carol).toHaveTextContent("Carol Diaz");
      expect(carol).toHaveTextContent(GUEST);
    } finally {
      vi.useRealTimers();
    }
  });

  it("carries the guest mark into the people shown as present", () => {
    const people = presentPeople(
      { carol: peer("carol", CAROL_ID, null), alice: peer("alice", ALICE_ID, null) },
      [projectMember(person(), "editor"), projectMember(GUEST_CAROL, "viewer")],
      BOB_ID,
      "Someone",
    );
    expect(people.map((entry) => [entry.person.name, entry.guest])).toEqual([
      ["Alice Chen", false],
      ["Carol Diaz", true],
    ]);
  });
});
