// @vitest-environment jsdom

import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useCollabRail } from "@/components/collab/collab-rail";
import { useSettingsStore } from "@/store/settings";
import { useCollabLiveStore } from "../live/live-store";
import { BOB, person, projectMember, shareInfo } from "../tests/fixtures";
import { useCollabActivity } from "./activity-store";
import { CollabActivityKeeper } from "./CollabActivityKeeper";

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.setState({ railTab: "files", showTree: true });
  useCollabActivity.setState({ projectId: null, entries: [], unread: false });
  useCollabRail.setState({ visible: false, unread: false });
  useCollabLiveStore.setState({
    projectId: "grant",
    share: shareInfo({ role: "editor" }),
    role: "editor",
    status: { state: "online" },
    pending: 0,
    peers: {},
    members: [projectMember(BOB, "owner"), projectMember(person(), "editor")],
    merged: null,
    newDevice: null,
    ended: null,
  });
});

describe("CollabActivityKeeper", () => {
  it("turns sharing events into pane activity and a rail dot instead of editor banners", () => {
    const { container, unmount } = render(<CollabActivityKeeper />);
    act(() =>
      useCollabLiveStore.setState({
        merged: {
          projectId: "grant",
          files: [{ path: "main.tex", changes: 2 }],
          authors: [],
          review: { before: "before", after: "after" },
        },
      }),
    );
    act(() =>
      useCollabLiveStore.setState({
        status: { state: "ended", reason: "archived" },
        ended: "archived",
        share: null,
        role: null,
      }),
    );
    expect(container).toBeEmptyDOMElement();
    expect(document.body.querySelector("[data-testid^='collab-'][data-testid$='-banner']")).toBeNull();
    expect(useCollabActivity.getState().entries.map((entry) => entry.kind)).toEqual(["archived", "merged", "welcome"]);
    expect(useCollabRail.getState()).toEqual({ visible: true, unread: true });
    unmount();
    expect(useCollabRail.getState()).toEqual({ visible: false, unread: false });
  });
});
