// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { getEditorDocumentPath, setEditorDocumentPath, setEditorView, subscribeEditorDocument } from "@oleafly/editor";
import type { ProjectLocation } from "@/lib/open-location";
import { ALICE_ID, BOB_ID, CAROL_ID, shareInfo } from "../tests/fixtures";
import { type LivePeer, useCollabLiveStore } from "./live-store";
import { type RemoteCursorSource, remoteCursors } from "./remote-cursors";

const mocks = vi.hoisted(() => ({ open: vi.fn(), scroll: vi.fn() }));

vi.mock("@/lib/open-location", () => ({ openProjectLocation: mocks.open }));
vi.mock("@oleafly/editor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@oleafly/editor")>()),
  scrollEditorPositionLocally: mocks.scroll,
}));

import { goToPerson } from "./go-to-person";

const NOW = Date.now();
const DOC = Array.from({ length: 60 }, (_, index) => `line ${index + 1}`).join("\n");

let view: EditorView;

function lineStart(number: number): number {
  return view.state.doc.line(number).from;
}

function bob(path: string | null, cursor: number | null, deviceId = "bob-laptop", seenAt = NOW): LivePeer {
  return { deviceId, accountId: BOB_ID, person: null, path, cursor, anchor: cursor, seenAt, hue: 200 };
}

function place(...peers: LivePeer[]) {
  useCollabLiveStore.setState({ peers: Object.fromEntries(peers.map((peer) => [peer.deviceId, peer])) });
}

const cursorsFromPresence: RemoteCursorSource = {
  cursors: () =>
    Object.values(useCollabLiveStore.getState().peers)
      .filter((peer) => peer.path === getEditorDocumentPath() && peer.cursor !== null)
      .map((peer) => ({
        id: peer.deviceId,
        name: null,
        hue: peer.hue,
        head: peer.cursor ?? 0,
        anchor: peer.anchor ?? peer.cursor ?? 0,
      })),
  subscribe: (listener) => {
    const stopPeers = useCollabLiveStore.subscribe(() => listener());
    const stopDocument = subscribeEditorDocument(() => listener());
    return () => {
      stopPeers();
      stopDocument();
    };
  },
};

function tintedLine(): string | null {
  return view.contentDOM.querySelector(".cm-remote-flash")?.textContent ?? null;
}

beforeEach(() => {
  vi.clearAllMocks();
  view = new EditorView({
    state: EditorState.create({ doc: DOC, extensions: remoteCursors(cursorsFromPresence) }),
    parent: document.body,
  });
  setEditorView(view);
  setEditorDocumentPath("main.tex");
  useCollabLiveStore.setState({ projectId: "grant", share: shareInfo({ account_id: ALICE_ID }), peers: {} });
  mocks.open.mockImplementation(async (target: ProjectLocation) => {
    setEditorDocumentPath(target.path);
    return true;
  });
});

afterEach(() => {
  setEditorView(null);
  view.destroy();
  useCollabLiveStore.setState({ projectId: null, share: null, peers: {} });
  vi.useRealTimers();
});

describe("goToPerson", () => {
  it("opens the file a person is in and centres the editor on their cursor", async () => {
    const at = lineStart(40) + 2;
    place(bob("chapters/intro.tex", at));

    expect(await goToPerson(BOB_ID)).toBe(true);

    expect(mocks.open).toHaveBeenCalledExactlyOnceWith(
      { path: "chapters/intro.tex", range: { from: at, to: at } },
      { keepSelection: true },
    );
    expect(mocks.scroll).toHaveBeenLastCalledWith(view, at);
  });

  it("briefly tints the line their caret is on", async () => {
    place(bob("chapters/intro.tex", lineStart(25) + 2));
    await goToPerson(BOB_ID);
    expect(tintedLine()).toBe("line 25");
  });

  it("leaves your own cursor and selection where they were", async () => {
    view.dispatch({ selection: EditorSelection.create([EditorSelection.range(3, 8), EditorSelection.cursor(20)]) });
    const before = view.state.selection;
    place(bob("main.tex", lineStart(50)));

    await goToPerson(BOB_ID);

    expect(view.state.selection.eq(before)).toBe(true);
    expect(mocks.open.mock.lastCall?.[1]).toEqual({ keepSelection: true });
  });

  it("opens a PDF or image the way the app always does, with nothing to scroll or tint", async () => {
    place(bob("figures/plot.png", null));
    mocks.open.mockResolvedValue(true);

    expect(await goToPerson(BOB_ID)).toBe(true);

    expect(mocks.open).toHaveBeenCalledExactlyOnceWith({ path: "figures/plot.png" }, { keepSelection: true });
    expect(mocks.scroll).not.toHaveBeenCalled();
    expect(tintedLine()).toBeNull();
  });

  it("opens the file without scrolling when the person shares only which file they are in", async () => {
    place(bob("refs.bib", null));
    expect(await goToPerson(BOB_ID)).toBe(true);
    expect(mocks.open).toHaveBeenCalledExactlyOnceWith({ path: "refs.bib" }, { keepSelection: true });
    expect(mocks.scroll).not.toHaveBeenCalled();
  });

  it("does nothing for someone who is not in any file", async () => {
    place(bob(null, null));
    expect(await goToPerson(BOB_ID)).toBe(false);
    expect(await goToPerson(CAROL_ID)).toBe(false);
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.scroll).not.toHaveBeenCalled();
  });

  it("follows the person to the file they moved to while the first one opened", async () => {
    place(bob("a.tex", lineStart(10)));
    const later = lineStart(30);
    mocks.open.mockImplementationOnce(async (target: ProjectLocation) => {
      place(bob("chapters/b.tex", later));
      setEditorDocumentPath(target.path);
      return true;
    });

    expect(await goToPerson(BOB_ID)).toBe(true);

    expect(mocks.open).toHaveBeenCalledTimes(2);
    expect(mocks.open.mock.lastCall?.[0]).toEqual({ path: "chapters/b.tex", range: { from: later, to: later } });
    expect(getEditorDocumentPath()).toBe("chapters/b.tex");
    expect(mocks.scroll).toHaveBeenLastCalledWith(view, later);
    expect(tintedLine()).toBe("line 30");
  });

  it("goes to where they are now when they moved inside the file while it opened", async () => {
    place(bob("a.tex", lineStart(10)));
    const later = lineStart(28);
    mocks.open.mockImplementationOnce(async (target: ProjectLocation) => {
      place(bob("a.tex", later));
      setEditorDocumentPath(target.path);
      return true;
    });

    await goToPerson(BOB_ID);

    expect(mocks.open).toHaveBeenCalledOnce();
    expect(mocks.scroll).toHaveBeenLastCalledWith(view, later);
    expect(tintedLine()).toBe("line 28");
  });

  it("goes to the device the person used last when they are in two places", async () => {
    place(bob("a.tex", lineStart(5), "bob-laptop", NOW - 5_000), bob("b.tex", lineStart(6), "bob-desktop", NOW));
    await goToPerson(BOB_ID);
    expect(mocks.open.mock.lastCall?.[0]).toMatchObject({ path: "b.tex" });
  });

  it("stops quietly when the file does not open", async () => {
    place(bob("a.tex", lineStart(10)));
    mocks.open.mockResolvedValue(false);
    expect(await goToPerson(BOB_ID)).toBe(false);
    expect(mocks.scroll).not.toHaveBeenCalled();
  });
});

describe("goToPerson edges", () => {
  it("goes to the device used last when it is listed first", async () => {
    place(bob("b.tex", lineStart(6), "bob-desktop", NOW), bob("a.tex", lineStart(5), "bob-laptop", NOW - 5_000));
    await goToPerson(BOB_ID);
    expect(mocks.open.mock.lastCall?.[0]).toMatchObject({ path: "b.tex" });
  });

  it("scrolls to the reported cursor in an editor that does not draw carets", async () => {
    const plain = new EditorView({ state: EditorState.create({ doc: DOC }), parent: document.body });
    setEditorView(plain);
    try {
      const at = lineStart(12);
      place(bob("main.tex", at));
      expect(await goToPerson(BOB_ID)).toBe(true);
      expect(mocks.scroll).toHaveBeenLastCalledWith(plain, at);
    } finally {
      setEditorView(view);
      plain.destroy();
    }
  });

  it("gives up an earlier jump when another one starts", async () => {
    place(bob("a.tex", lineStart(10)), {
      deviceId: "carol-laptop",
      accountId: CAROL_ID,
      person: null,
      path: "c.tex",
      cursor: lineStart(20),
      anchor: lineStart(20),
      seenAt: NOW,
      hue: 90,
    });
    let finish: (opened: boolean) => void = () => {};
    mocks.open.mockImplementationOnce(
      (target: ProjectLocation) =>
        new Promise<boolean>((resolve) => {
          finish = (opened) => {
            setEditorDocumentPath(target.path);
            resolve(opened);
          };
        }),
    );
    const toBob = goToPerson(BOB_ID);
    expect(await goToPerson(CAROL_ID)).toBe(true);
    finish(true);
    expect(await toBob).toBe(false);
    expect(mocks.open).toHaveBeenCalledTimes(2);
    expect(mocks.scroll).toHaveBeenCalledOnce();
    expect(mocks.scroll).toHaveBeenLastCalledWith(view, lineStart(20));
  });
});

