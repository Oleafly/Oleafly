// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { loadNamespace } from "@/i18n";

vi.mock("../live/go-to-person", () => ({ goToPerson: vi.fn(async () => true) }));

import type { CollabPerson, CollabProjectMember } from "@/lib/tauri";
import { useCollabLiveStore, type LivePeer } from "../live/live-store";
import { fill } from "../tests/fixtures";
import { PresentAvatars } from "./PresentAvatars";
import { peerMarks } from "./presence";

const toolbar = enCollab.toolbar;
const ME = "5f0000000000000000000001";
const BOB = "5f0000000000000000000002";

function someone(accountId: string, name: string): CollabPerson {
  return { account_id: accountId, display_name: name, avatar_url: null, email: null, login: null };
}

function peer(deviceId: string, accountId: string, extra: Partial<LivePeer> = {}): LivePeer {
  return { deviceId, accountId, person: null, path: "main.tex", cursor: 3, anchor: null, seenAt: 1, hue: 120, ...extra };
}

const MEMBERS: CollabProjectMember[] = [{ person: someone(BOB, "Bob Tester"), role: "reviewer", granted_at: 0 }];

function overleaf(peers: LivePeer[], members: CollabProjectMember[] = MEMBERS) {
  useCollabLiveStore.setState({
    projectId: "paper",
    backend: "overleaf",
    share: null,
    selfId: ME,
    members,
    peers: Object.fromEntries(peers.map((entry) => [entry.deviceId, entry])),
  });
}

function avatarNames(container: HTMLElement) {
  return [...container.querySelectorAll('[data-slot="avatar-stack"] [data-slot="avatar"]')].map(
    (avatar) =>
      avatar.closest("button")?.getAttribute("aria-label") ??
      avatar.parentElement?.querySelector(".sr-only")?.textContent ??
      avatar.textContent,
  );
}

beforeAll(async () => {
  await loadNamespace("collab");
});

afterEach(() => {
  useCollabLiveStore.setState({
    projectId: null,
    backend: null,
    selfId: null,
    restricted: false,
    share: null,
    peers: {},
    members: [],
  });
});

describe("presence on Overleaf", () => {
  it("shows coauthors on an Overleaf project, which has no server share", () => {
    overleaf([peer("P.bob", BOB)]);
    render(<PresentAvatars projectId="paper" />);
    const bob = screen.getByRole("button", { name: fill(toolbar.goTo, { name: "Bob Tester" }) });
    expect(bob).toHaveAccessibleDescription(expect.stringContaining(enCollab.projectRoles.reviewer));
  });

  it("names a coauthor from the service before the member list knows them", () => {
    overleaf([peer("P.dana", "5f00000000000000000000aa", { person: someone("5f00000000000000000000aa", "Dana Ruiz") })], []);
    render(<PresentAvatars projectId="paper" />);
    expect(screen.getByRole("button", { name: fill(toolbar.goTo, { name: "Dana Ruiz" }) })).toBeInTheDocument();
  });

  it("lists this person's other window as you, and an anonymous viewer as someone", () => {
    overleaf([peer("P.browser", ME), peer("P.anon", "anonymous-user", { path: null })]);
    const { container } = render(<PresentAvatars projectId="paper" />);
    expect(screen.getByRole("button", { name: fill(toolbar.goTo, { name: toolbar.youElsewhere }) })).toBeInTheDocument();
    expect(avatarNames(container).some((name) => name?.includes(toolbar.unknownPerson))).toBe(true);
  });

  it("marks your other window in the file tree only on Overleaf", () => {
    const peers = { "P.browser": peer("P.browser", ME) };
    const label = (name: string) => `here: ${name}`;
    const onOverleaf = peerMarks(peers, MEMBERS, ME, toolbar.unknownPerson, label, toolbar.youElsewhere);
    expect(onOverleaf.get("main.tex")?.map((mark) => mark.label)).toEqual([label(toolbar.youElsewhere)]);
    expect(peerMarks(peers, MEMBERS, ME, toolbar.unknownPerson, label).size).toBe(0);
  });

  it("explains empty avatars to someone who joined with a view link", () => {
    overleaf([peer("P.bob", BOB)]);
    useCollabLiveStore.setState({ restricted: true });
    render(<PresentAvatars projectId="paper" />);
    expect(screen.getByRole("img", { name: toolbar.hiddenForViewLink })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: fill(toolbar.goTo, { name: "Bob Tester" }) })).toBeNull();
  });
});
