// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import "@/components/notes/tests/setup";

const mocks = vi.hoisted(() => ({ jump: vi.fn() }));

vi.mock("@/lib/tauri-collab", () => ({}));
vi.mock("@/store/files", async () => {
  const { create } = await import("zustand");
  return { useFilesStore: create(() => ({ projectId: null, projects: [{ id: "note-1", main_doc: "note.md", name: "Lab notes" }] })) };
});
vi.mock("./note-live-port", () => ({ jumpToNotePeer: mocks.jump }));

import { loadNamespace } from "@/i18n";
import { useCollabLiveStore } from "../live/live-store";
import { NoteLivePanel, NotePresence } from "./NoteLivePanel";

const NOTE = "note-1";

function peer(accountId: string, name: string, path: string | null) {
  return {
    deviceId: `d-${accountId}`,
    accountId,
    person: { account_id: accountId, display_name: name, avatar_url: null, email: null, login: null },
    path,
    cursor: 0,
    anchor: 0,
    seenAt: Date.now(),
    hue: 200,
  };
}

function liveHere(peers = {}) {
  useCollabLiveStore.setState({
    projectId: NOTE,
    share: {
      project_id: NOTE,
      server_id: "s",
      server_name: "Lab",
      server_url: "https://collab.example.org",
      shared_project_id: "shared",
      role: "editor",
      link: "https://collab.example.org/p/shared",
      account_id: "me",
    },
    members: [],
    peers,
    status: { state: "online" },
    pending: 0,
  });
}

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  vi.clearAllMocks();
  useCollabLiveStore.setState({ projectId: null, share: null, peers: {}, members: [], status: null, pending: 0 });
});

describe("the live note panel", () => {
  it("shows the connection state and who is here while live", () => {
    liveHere({ a: peer("alice", "Alice Chen", "note.md"), b: peer("bob", "Bob Jones", "assets/fig.png"), c: peer("me", "Me", "note.md") });
    render(<NoteLivePanel noteId={NOTE} live />);
    expect(screen.getByText("Up to date")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Go to Alice Chen/u }));
    expect(mocks.jump).toHaveBeenCalledWith(NOTE, "alice");
    expect(screen.queryByRole("button", { name: /Go to Bob Jones/u })).toBeNull();
    act(() => useCollabLiveStore.setState({ status: { state: "offline", retry_in_ms: 1000 }, pending: 3 }));
    expect(screen.getByText("Offline. Changes waiting: 3")).toBeInTheDocument();
  });

  it("uses the editor's avatars and names the note instead of its file", () => {
    liveHere({ a: peer("alice", "Alice Chen", "note.md"), b: peer("bob", "Bob Jones", "assets/fig.png") });
    render(<NotePresence noteId={NOTE} />);
    const presence = document.querySelector(`[data-note-presence="${NOTE}"]`) as HTMLElement;
    expect(presence.querySelector(".size-7")).not.toBeNull();
    expect(presence.textContent).toContain("Alice Chen");
    expect(presence.textContent).toContain("Lab notes");
    expect(presence.textContent).toContain("assets/fig.png");
    expect(presence.textContent).not.toContain("note.md");
  });

  it("shows syncing while connecting, without avatars", () => {
    render(<NoteLivePanel noteId={NOTE} live={false} />);
    expect(screen.getByText("Syncing")).toBeInTheDocument();
    expect(document.querySelector("[data-note-presence]")).toBeNull();
  });

  it("shows no avatars for another project or when nobody else is here", () => {
    useCollabLiveStore.setState({ projectId: "other", peers: { a: peer("alice", "Alice", "note.md") } });
    const { container, rerender } = render(<NotePresence noteId={NOTE} />);
    expect(container).toBeEmptyDOMElement();
    act(() => liveHere({}));
    rerender(<NotePresence noteId={NOTE} />);
    expect(container).toBeEmptyDOMElement();
  });
});
