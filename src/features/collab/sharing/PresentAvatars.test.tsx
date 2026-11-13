// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { loadNamespace } from "@/i18n";

const mocks = vi.hoisted(() => ({ goToPerson: vi.fn(async () => true) }));

vi.mock("../live/go-to-person", () => ({ goToPerson: mocks.goToPerson }));

import { useCollabLiveStore, type LivePeer } from "../live/live-store";
import { ALICE_ID, BOB, BOB_ID, CAROL, CAROL_ID, fill, person, projectMember, shareInfo } from "../tests/fixtures";
import { PresentAvatars } from "./PresentAvatars";

const toolbar = enCollab.toolbar;
const roles = enCollab.projectRoles;
const DAN_ID = "0192a0b0-0000-7000-8000-000000000004";
const ERIN_ID = "0192a0b0-0000-7000-8000-000000000005";
const FRANK_ID = "0192a0b0-0000-7000-8000-000000000006";

function peer(accountId: string, path: string | null, extra: Partial<LivePeer> = {}): LivePeer {
  return { deviceId: `${accountId}-device`, accountId, person: null, path, cursor: 0, anchor: 0, seenAt: 1, hue: 200, ...extra };
}

function live(peers: LivePeer[], extra: Partial<Parameters<typeof useCollabLiveStore.setState>[0]> = {}) {
  useCollabLiveStore.setState({
    projectId: "grant",
    share: shareInfo(),
    peers: Object.fromEntries(peers.map((entry) => [entry.deviceId, entry])),
    members: [projectMember(BOB, "owner"), projectMember(person(), "editor"), projectMember(CAROL, "viewer")],
    ...extra,
  });
}

function avatarNames(container: HTMLElement) {
  return [...container.querySelectorAll('[data-slot="avatar-stack"] [data-slot="avatar"]')].map((avatar) =>
    avatar.closest("button")?.getAttribute("aria-label") ?? avatar.parentElement?.querySelector(".sr-only")?.textContent,
  );
}

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  vi.clearAllMocks();
  useCollabLiveStore.setState({ projectId: null, share: null, peers: {}, members: [] });
});

describe("people present in a shared project", () => {
  it("shows nothing until this project is shared live and someone else is in it", () => {
    const { container, rerender } = render(<PresentAvatars projectId="grant" />);
    expect(container).toBeEmptyDOMElement();
    act(() => live([peer(BOB_ID, "main.tex")]));
    expect(container).toBeEmptyDOMElement();
    act(() => live([peer(ALICE_ID, "main.tex")], { projectId: "thesis" }));
    expect(container).toBeEmptyDOMElement();
    act(() => live([peer(ALICE_ID, "main.tex")], { share: null }));
    expect(container).toBeEmptyDOMElement();
    act(() => live([peer(ALICE_ID, "main.tex")]));
    rerender(<PresentAvatars projectId="grant" />);
    expect(container.querySelector('[data-slot="avatar-stack"]')).not.toBeNull();
  });

  it("lists everyone else by name with their role and what they are doing", () => {
    live([peer(CAROL_ID, null), peer(BOB_ID, "main.tex"), peer(ALICE_ID, "sections/intro.tex")]);
    const { container } = render(<PresentAvatars projectId="grant" />);
    expect(avatarNames(container)).toEqual([fill(toolbar.goTo, { name: "Alice Chen" }), expect.stringContaining("Carol Diaz")]);
    const alice = screen.getByRole("button", { name: fill(toolbar.goTo, { name: "Alice Chen" }) });
    expect(alice).toHaveAccessibleDescription(`Alice Chen, ${roles.editor}, ${fill(toolbar.editing, { path: "sections/intro.tex" })}`);
    expect(container).toHaveTextContent(`Carol Diaz, ${roles.viewer}, ${toolbar.nowhere}`);
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("goes to the file a person has open when their avatar is clicked", () => {
    live([peer(ALICE_ID, "main.tex")]);
    render(<PresentAvatars projectId="grant" />);
    fireEvent.click(screen.getByRole("button", { name: fill(toolbar.goTo, { name: "Alice Chen" }) }));
    expect(mocks.goToPerson).toHaveBeenCalledWith(ALICE_ID);
  });

  it("uses the caller's own way to go to a person and to name what they have open", () => {
    const visited: string[] = [];
    live([peer(ALICE_ID, "note.md"), peer(CAROL_ID, null)]);
    render(
      <PresentAvatars
        projectId="grant"
        data-note-presence="grant"
        goTo={(entry) => () => visited.push(entry.accountId)}
        pathLabel={(path) => `the note (${path})`}
      />,
    );
    const alice = screen.getByRole("button", { name: fill(toolbar.goTo, { name: "Alice Chen" }) });
    expect(alice).toHaveAccessibleDescription(`Alice Chen, ${roles.editor}, ${fill(toolbar.editing, { path: "the note (note.md)" })}`);
    fireEvent.click(screen.getByRole("button", { name: fill(toolbar.goTo, { name: "Carol Diaz" }) }));
    fireEvent.click(alice);
    expect(visited).toEqual([CAROL_ID, ALICE_ID]);
    expect(mocks.goToPerson).not.toHaveBeenCalled();
    expect(alice.closest("[data-note-presence]")).toHaveAttribute("data-note-presence", "grant");
  });

  it("says reviewing for reviewers, marks guests and names people it does not know", () => {
    live([peer(ALICE_ID, "main.tex"), peer(DAN_ID, "main.tex"), peer(ERIN_ID, "refs.bib")], {
      members: [projectMember({ ...person(), guest: true }, "reviewer")],
    });
    render(<PresentAvatars projectId="grant" />);
    expect(screen.getByRole("button", { name: fill(toolbar.goTo, { name: "Alice Chen" }) })).toHaveAccessibleDescription(
      `Alice Chen, ${roles.reviewer}, ${enCollab.guests.badge}, ${fill(toolbar.reviewing, { path: "main.tex" })}`,
    );
    const strangers = screen.getAllByRole("button", { name: fill(toolbar.goTo, { name: toolbar.unknownPerson }) });
    expect(strangers).toHaveLength(2);
    expect(strangers[0]).toHaveAccessibleDescription(`${toolbar.unknownPerson}, ${fill(toolbar.viewing, { path: "main.tex" })}`);
  });

  it("folds people past the fourth into a counter that still names them and their file", () => {
    live(
      [ALICE_ID, CAROL_ID, DAN_ID, ERIN_ID, FRANK_ID].map((id, index) =>
        peer(id, index === 4 ? null : `file-${index}.tex`, {
          person: person({ account_id: id, display_name: ["Alice", "Carol", "Dan", "Erin", "Frank"][index] }),
        }),
      ),
      { members: [] },
    );
    const { container } = render(<PresentAvatars projectId="grant" />);
    expect(container.querySelectorAll('[data-slot="avatar-stack"] [data-slot="avatar"]')).toHaveLength(4);
    const more = container.querySelector('[data-slot="avatar-more"]') as HTMLElement;
    expect(more).toHaveTextContent("+1");
    expect(more.querySelector('[data-slot="hidden-person"]')).toHaveTextContent(`Frank${toolbar.noFile}`);
  });

  it("follows people as they come and go", () => {
    live([peer(ALICE_ID, "main.tex"), peer(CAROL_ID, "main.tex")]);
    const { container } = render(<PresentAvatars projectId="grant" />);
    expect(container.querySelectorAll('[data-slot="avatar"]')).toHaveLength(2);
    act(() => live([peer(CAROL_ID, "main.tex")]));
    expect(container.querySelectorAll('[data-slot="avatar"]')).toHaveLength(1);
    expect(screen.getByRole("button", { name: fill(toolbar.goTo, { name: "Carol Diaz" }) })).toBeInTheDocument();
    act(() => live([]));
    expect(container).toBeEmptyDOMElement();
  });
});
