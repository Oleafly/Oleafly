import { EditorState, Text } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { peerHue } from "@/features/collab/live/peer-hue";
import type { OverlaySnapshot, PlacedSuggestion } from "../overlays";
import {
  buildOverlayDecorations,
  DELETED_TEXT_LIMIT,
  DeletedTextWidget,
  deletedTextLabel,
  OVERLAY_STYLES,
  type OverlaySource,
  overlayDecorations,
} from "./decorations";

function placed(patch: Partial<PlacedSuggestion>): PlacedSuggestion {
  return { key: "k", id: "s1", kind: "insert", author: "alice", from: 0, to: 0, text: "", pending: false, ...patch };
}

const none = { thread: null, suggestion: null };

function decorationsOf(doc: string, snapshot: OverlaySnapshot) {
  const set = buildOverlayDecorations(Text.of(doc.split("\n")), snapshot, "me", none);
  const found: { from: number; to: number; spec: Record<string, unknown> }[] = [];
  set.between(0, doc.length, (from, to, value) => {
    found.push({ from, to, spec: value.spec as Record<string, unknown> });
  });
  return found;
}

const views: EditorView[] = [];

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
});

async function mount(doc: string, snapshot: OverlaySnapshot, selected = none) {
  let listener: () => void = () => undefined;
  const source: OverlaySource = {
    activePath: () => "main.tex",
    snapshot: () => snapshot,
    self: () => "me",
    selected: () => selected,
    subscribe: (next) => {
      listener = next;
      return () => undefined;
    },
  };
  const view = new EditorView({
    state: EditorState.create({ doc, extensions: overlayDecorations(source) }),
    parent: document.body,
  });
  views.push(view);
  await Promise.resolve();
  await Promise.resolve();
  return { view, refresh: () => listener() };
}

describe("suggestion decorations", () => {
  it("marks an insertion with the author's hue and no outline", () => {
    const [mark] = decorationsOf("Hello world", {
      suggestions: [placed({ from: 6, to: 11 })],
      threads: [],
      draft: null,
    });
    expect(mark).toMatchObject({ from: 6, to: 11 });
    expect(mark.spec.class).toBe("cm-suggest-insert");
    expect((mark.spec.attributes as Record<string, string>).style).toBe(`--suggest-hue: ${peerHue("alice", "me")}`);
    for (const rules of Object.values(OVERLAY_STYLES)) {
      expect(Object.keys(rules)).not.toContain("outline");
      expect(Object.keys(rules)).not.toContain("boxShadow");
    }
  });

  it("shows a deletion as a struck-through widget at its anchor", () => {
    const [widget] = decorationsOf("Hello world", {
      suggestions: [placed({ kind: "delete", from: 5, to: 5, text: " big" })],
      threads: [],
      draft: null,
    });
    expect(widget.from).toBe(5);
    expect(widget.to).toBe(5);
    const deleted = widget.spec.widget as DeletedTextWidget;
    expect(deleted).toBeInstanceOf(DeletedTextWidget);
    const dom = deleted.toDOM();
    expect(dom.className).toBe("cm-suggest-delete");
    expect(dom.textContent).toBe(" big");
    expect(OVERLAY_STYLES[".cm-suggest-delete"].textDecorationLine).toBe("line-through");
  });

  it("clamps ranges to the document and skips empty ones", () => {
    const found = decorationsOf("abc", {
      suggestions: [placed({ from: 2, to: 50 }), placed({ id: "e", from: 1, to: 1 }), placed({ kind: "delete", text: "" })],
      threads: [{ id: "t", from: 0, to: 0, resolved: false }],
      draft: null,
    });
    expect(found.map(({ from, to }) => [from, to])).toEqual([[2, 3]]);
  });

  it("highlights open comment threads, the draft and the selected items", () => {
    const set = buildOverlayDecorations(
      Text.of(["Hello world"]),
      {
        suggestions: [placed({ id: "s1", from: 6, to: 11 })],
        threads: [
          { id: "open", from: 0, to: 5, resolved: false },
          { id: "done", from: 6, to: 11, resolved: true },
        ],
        draft: { from: 1, to: 3 },
      },
      "me",
      { thread: "open", suggestion: "s1" },
    );
    const classes: string[] = [];
    set.between(0, 11, (_from, _to, value) => {
      classes.push(String((value.spec as { class?: string }).class));
    });
    expect(classes.sort()).toEqual(["cm-comment-draft", "cm-comment-range cm-comment-active", "cm-suggest-insert cm-suggest-active"]);
  });

  it("shortens very long deleted text", () => {
    const long = "x".repeat(DELETED_TEXT_LIMIT + 10);
    expect(deletedTextLabel(long)).toHaveLength(DELETED_TEXT_LIMIT + 1);
    expect(deletedTextLabel("short")).toBe("short");
  });

  it("returns no decorations without a snapshot", () => {
    expect(buildOverlayDecorations(Text.of(["x"]), null, "me", none)).toBe(Decoration.none);
  });
});

describe("overlay decorations in the editor", () => {
  it("renders insertions as highlighted text and deletions as struck-through text", async () => {
    const { view } = await mount("Hello world", {
      suggestions: [placed({ id: "ins", from: 6, to: 11 }), placed({ id: "del", kind: "delete", from: 5, to: 5, text: " big" })],
      threads: [],
      draft: null,
    });
    const insert = view.dom.querySelector<HTMLElement>(".cm-suggest-insert");
    const deleted = view.dom.querySelector<HTMLElement>(".cm-suggest-delete");
    expect(insert?.textContent).toBe("world");
    expect(insert?.dataset.suggestionId).toBe("ins");
    expect(deleted?.textContent).toBe(" big");
    expect(deleted?.dataset.suggestionId).toBe("del");
    expect(view.state.doc.toString()).toBe("Hello world");
  });

  it("follows the snapshot when the source changes", async () => {
    const snapshot: OverlaySnapshot = { suggestions: [], threads: [], draft: null };
    const { view, refresh } = await mount("Hello world", snapshot);
    expect(view.dom.querySelector(".cm-comment-range")).toBeNull();
    (snapshot as { threads: OverlaySnapshot["threads"] }).threads = [{ id: "t", from: 0, to: 5, resolved: false }];
    refresh();
    await Promise.resolve();
    expect(view.dom.querySelector<HTMLElement>(".cm-comment-range")?.textContent).toBe("Hello");
  });

  it("maps decorations through typing until the next snapshot", async () => {
    const { view } = await mount("Hello world", {
      suggestions: [placed({ id: "ins", from: 6, to: 11 })],
      threads: [],
      draft: null,
    });
    view.dispatch({ changes: { from: 0, insert: ">> " } });
    expect(view.dom.querySelector<HTMLElement>(".cm-suggest-insert")?.textContent).toBe("world");
  });
});
