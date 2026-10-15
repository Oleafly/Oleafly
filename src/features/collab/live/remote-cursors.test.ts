// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  flashRemoteCursor,
  labelLightness,
  REMOTE_CURSOR_STYLES,
  REMOTE_FLASH_MS,
  remoteCursors,
  remoteCursorsIn,
  type RemoteCursor,
  type RemoteCursorSource,
} from "./remote-cursors";

class Source implements RemoteCursorSource {
  list: RemoteCursor[] = [];
  readonly listeners = new Set<() => void>();
  readonly activity = vi.fn();

  cursors(): readonly RemoteCursor[] {
    return this.list;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  set(list: RemoteCursor[]): void {
    this.list = list;
    for (const listener of this.listeners) listener();
  }
}

const views: EditorView[] = [];

function editor(source: Source, doc = "hello world"): EditorView {
  const view = new EditorView({
    state: EditorState.create({ doc, extensions: remoteCursors(source) }),
    parent: document.body,
  });
  views.push(view);
  return view;
}

async function tick(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
});

const bob: RemoteCursor = { id: "device-bob", name: "Bob Jones", hue: 200, head: 5, anchor: 0 };

describe("remote cursors", () => {
  it("draws a named caret and a tinted selection for each peer", async () => {
    const source = new Source();
    source.list = [bob];
    const view = editor(source);
    await tick();
    const caret = view.contentDOM.querySelector(".cm-remote-caret");
    expect(caret?.textContent).toBe("Bob Jones");
    expect((caret as HTMLElement | null)?.style.getPropertyValue("--remote-hue")).toBe("200");
    const selection = view.contentDOM.querySelector(".cm-remote-selection");
    expect(selection?.textContent).toBe("hello");
    expect(remoteCursorsIn(view.state)).toEqual([bob]);
  });

  it("leaves out the label when the name is unknown and clamps positions to the document", async () => {
    const source = new Source();
    source.list = [{ id: "d", name: null, hue: 10, head: 99, anchor: 99 }];
    const view = editor(source, "abc");
    await tick();
    expect(view.contentDOM.querySelector(".cm-remote-caret")?.textContent).toBe("");
    expect(remoteCursorsIn(view.state)).toEqual([{ id: "d", name: null, hue: 10, head: 3, anchor: 3 }]);
  });

  it("follows local edits and source updates", async () => {
    const source = new Source();
    source.list = [{ ...bob, head: 6, anchor: 6 }];
    const view = editor(source);
    await tick();
    view.dispatch({ changes: { from: 0, insert: ">> " } });
    expect(remoteCursorsIn(view.state)[0]).toMatchObject({ head: 9, anchor: 9 });
    source.set([]);
    await tick();
    expect(remoteCursorsIn(view.state)).toEqual([]);
    expect(view.contentDOM.querySelector(".cm-remote-caret")).toBeNull();
  });

  it("keeps other people's carets where local typing moved them when one person moves", async () => {
    const source = new Source();
    const carol: RemoteCursor = { id: "device-carol", name: "Carol Diaz", hue: 280, head: 8, anchor: 8 };
    source.list = [{ ...bob, head: 6, anchor: 6 }, carol];
    const view = editor(source);
    await tick();
    view.dispatch({ changes: { from: 0, insert: ">> " } });
    source.set([{ ...bob, head: 6, anchor: 6 }, { ...carol, head: 1, anchor: 1 }]);
    await tick();
    expect(remoteCursorsIn(view.state)).toEqual([
      { ...bob, head: 9, anchor: 9 },
      { ...carol, head: 1, anchor: 1 },
    ]);
  });

  it("reports this person's activity on selection and document changes", async () => {
    const source = new Source();
    const view = editor(source);
    await tick();
    view.dispatch({ selection: EditorSelection.cursor(2) });
    view.dispatch({ changes: { from: 0, insert: "x" } });
    expect(source.activity).toHaveBeenCalledTimes(2);
    expect(source.activity).toHaveBeenCalledWith(view);
  });

  it("stops listening when the editor goes away", async () => {
    const source = new Source();
    const view = editor(source);
    await tick();
    expect(source.listeners.size).toBe(1);
    view.destroy();
    expect(source.listeners.size).toBe(0);
  });

  it("styles with tints and borders only, with text sized in rem", () => {
    const styles = JSON.stringify(REMOTE_CURSOR_STYLES);
    expect(styles).not.toMatch(/outline|boxShadow|box-shadow|ring/i);
    expect(REMOTE_CURSOR_STYLES[".cm-remote-selection"].backgroundColor).toMatch(/^hsl\(/);
    expect(REMOTE_CURSOR_STYLES[".cm-remote-caret-label"].fontSize).toMatch(/rem$/);
    expect(REMOTE_CURSOR_STYLES[".cm-remote-flash"].backgroundColor).toMatch(/^hsl\(/);
  });

  it("tints the line a peer's caret is on for a moment, in their colour", async () => {
    vi.useFakeTimers();
    try {
      const source = new Source();
      source.list = [{ ...bob, name: null, head: 14, anchor: 14 }];
      const view = editor(source, "first line\nsecond line\nthird line");
      await tick();
      expect(flashRemoteCursor(view, bob.id)).toBe(true);
      const tinted = view.contentDOM.querySelectorAll<HTMLElement>(".cm-remote-flash");
      expect(tinted).toHaveLength(1);
      expect(tinted[0].textContent).toBe("second line");
      expect(tinted[0].style.getPropertyValue("--remote-hue")).toBe("200");
      vi.advanceTimersByTime(REMOTE_FLASH_MS);
      expect(view.contentDOM.querySelector(".cm-remote-flash")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("tints nothing for someone whose caret is not in this document", async () => {
    const source = new Source();
    source.list = [bob];
    const view = editor(source);
    await tick();
    expect(flashRemoteCursor(view, "device-nobody")).toBe(false);
    expect(view.contentDOM.querySelector(".cm-remote-flash")).toBeNull();
  });
});

// Worked out here from the WCAG definitions, separately from the code under test.
function whiteContrast(hue: number, saturation: number, lightness: number): number {
  const s = saturation / 100;
  const l = lightness / 100;
  const a = s * Math.min(l, 1 - l);
  const part = (n: number) => {
    const k = (n + hue / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  const linear = (value: number) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * linear(part(0)) + 0.7152 * linear(part(8)) + 0.0722 * linear(part(4));
  return 1.05 / (luminance + 0.05);
}

describe("remote cursor label contrast", () => {
  it("keeps white name text at 4.5:1 or better on every peer colour", () => {
    for (let hue = 0; hue < 360; hue += 1) {
      expect(whiteContrast(hue, 70, labelLightness(hue)), `hue ${hue}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("darkens only the colours that need it, so most labels match their caret", () => {
    expect(whiteContrast(60, 70, 45)).toBeLessThan(4.5);
    expect(labelLightness(60)).toBeLessThan(45);
    for (const hue of [0, 220, 240, 270, 300]) expect(labelLightness(hue), `hue ${hue}`).toBe(45);
  });

  it("gives each label its shade and draws it from that shade", async () => {
    const source = new Source();
    source.list = [{ id: "device-ada", name: "Ada", hue: 60, head: 2, anchor: 2 }];
    const view = editor(source);
    await tick();
    const label = view.contentDOM.querySelector(".cm-remote-caret-label") as HTMLElement;
    expect(label.style.getPropertyValue("--remote-label-lightness")).toBe(`${labelLightness(60)}%`);
    expect(REMOTE_CURSOR_STYLES[".cm-remote-caret-label"].backgroundColor).toContain("var(--remote-label-lightness");
  });
});

describe("remote cursor edges", () => {
  it("never places a caret inside a character or at a position that is not a number", async () => {
    const source = new Source();
    source.list = [
      { id: "mid", name: null, hue: 10, head: 2, anchor: 2 },
      { id: "nan", name: null, hue: 20, head: Number.NaN, anchor: Number.POSITIVE_INFINITY },
    ];
    const view = editor(source, "a😀b");
    await tick();
    expect(remoteCursorsIn(view.state)).toEqual([
      { id: "mid", name: null, hue: 10, head: 1, anchor: 1 },
      { id: "nan", name: null, hue: 20, head: 0, anchor: 0 },
    ]);
  });

  it("draws once for several quick updates and not at all once the editor is gone", async () => {
    const source = new Source();
    const view = editor(source);
    await tick();
    const dispatch = vi.spyOn(view, "dispatch");
    source.set([bob]);
    source.set([{ ...bob, head: 3 }]);
    await tick();
    expect(dispatch).toHaveBeenCalledOnce();
    expect(remoteCursorsIn(view.state)).toEqual([{ ...bob, head: 3 }]);
    source.set([]);
    view.destroy();
    await tick();
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it("has no carets to show or tint in an editor without them", () => {
    const view = new EditorView({ state: EditorState.create({ doc: "plain" }), parent: document.body });
    views.push(view);
    expect(remoteCursorsIn(view.state)).toEqual([]);
    expect(flashRemoteCursor(view, bob.id)).toBe(false);
  });

  it("keeps the newer tint when an older one runs out", async () => {
    vi.useFakeTimers();
    try {
      const source = new Source();
      const carol: RemoteCursor = { id: "device-carol", name: null, hue: 280, head: 14, anchor: 14 };
      source.list = [{ ...bob, name: null, head: 1, anchor: 1 }, carol];
      const view = editor(source, "first line\nsecond line\nthird line");
      await tick();
      flashRemoteCursor(view, bob.id);
      vi.advanceTimersByTime(REMOTE_FLASH_MS / 2);
      flashRemoteCursor(view, carol.id);
      vi.advanceTimersByTime(REMOTE_FLASH_MS / 2);
      expect(view.contentDOM.querySelector(".cm-remote-flash")?.textContent).toBe("second line");
      vi.advanceTimersByTime(REMOTE_FLASH_MS / 2);
      expect(view.contentDOM.querySelector(".cm-remote-flash")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

