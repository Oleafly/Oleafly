// @vitest-environment jsdom

import { act, render } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import type { PeerMarks } from "@/components/collab/CollabSlots";
import { useCollabLiveStore, type LivePeer } from "../live/live-store";
import { ALICE_ID, BOB, BOB_ID, CAROL, CAROL_ID, fill, person, projectMember, shareInfo } from "../tests/fixtures";
import { TreePresence } from "./TreePresence";

function peer(deviceId: string, accountId: string, path: string | null, hue: number): LivePeer {
  return { deviceId, accountId, person: null, path, cursor: null, anchor: null, seenAt: Date.now(), hue };
}

const here = (name: string) => fill(enCollab.tree.here, { name });

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  useCollabLiveStore.setState({
    projectId: "grant",
    share: shareInfo(),
    members: [projectMember(BOB, "owner"), projectMember(person(), "editor"), projectMember(CAROL, "viewer")],
    peers: {
      mine: peer("mine", BOB_ID, "main.tex", 10),
      alice: peer("alice", ALICE_ID, "main.tex", 200),
      aliceLaptop: peer("aliceLaptop", ALICE_ID, "main.tex", 200),
      carol: peer("carol", CAROL_ID, "refs.bib", 40),
      idle: peer("idle", CAROL_ID, null, 40),
    },
  });
});

describe("TreePresence", () => {
  it("marks each open file with one dot per other person and clears them when it goes away", () => {
    const onChange = vi.fn<(marks: PeerMarks) => void>();
    const view = render(<TreePresence onChange={onChange} />);
    const marks = onChange.mock.lastCall?.[0];
    expect(marks?.get("main.tex")).toEqual([{ id: ALICE_ID, hue: 200, label: here("Alice Chen") }]);
    expect(marks?.get("refs.bib")).toEqual([{ id: CAROL_ID, hue: 40, label: here("Carol Diaz") }]);
    expect(marks?.size).toBe(2);

    act(() => useCollabLiveStore.setState({ peers: {} }));
    expect(onChange.mock.lastCall?.[0].size).toBe(0);

    act(() => useCollabLiveStore.setState({ peers: { carol: peer("carol", CAROL_ID, "main.tex", 40) } }));
    expect(onChange.mock.lastCall?.[0].get("main.tex")).toHaveLength(1);
    view.unmount();
    expect(onChange.mock.lastCall?.[0].size).toBe(0);
  });
});
