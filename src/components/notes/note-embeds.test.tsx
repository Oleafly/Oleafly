// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadNamespace } from "@/i18n";
import { isMac } from "@/lib/utils";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { withImageView } from "./block-views";
import { destroyKbEditors, kbEditor, kbMarkdown } from "./tests/kb-editor-fixtures";
import { EmbedCard, embedNodeView, embedSource, embedTarget, plainImageView, withNoteEmbeds, type EmbedOptions } from "./note-embeds";
import type { LinkableNote } from "./note-links";
import { noteBaseExtensions, parseNoteMarkdown } from "./note-markdown";
import { resetRemoteImagesForTest } from "./note-remote-images";

const E = enNotes.kb.embeds;
const NOTES: LinkableNote[] = [
  { noteId: "self", projectId: "lib-0", title: "Here" },
  { noteId: "n-1", projectId: "lib-1", title: "Method", icon: "🧪" },
  { noteId: "n-2", projectId: "lib-2", title: "Empty" },
];
const TEXTS: Record<string, string> = {
  "lib-1": "---\ntitle: Method\n---\n# Setup\nUse **three** seeds.\n\n![Nested](oleafly://note/n-2)\n\n# Results\nAll good.\n",
  "lib-2": "---\ntitle: Empty\n---\n\n",
};

function options(overrides: Partial<EmbedOptions> = {}): EmbedOptions {
  return {
    getNotes: () => NOTES,
    currentNoteId: () => "self",
    loadText: vi.fn((projectId: string) => (TEXTS[projectId] ? Promise.resolve(TEXTS[projectId]) : Promise.reject(new Error("gone")))),
    version: () => 1,
    onOpen: vi.fn(),
    ...overrides,
  };
}

beforeAll(async () => {
  await loadNamespace("notes");
});

afterEach(() => {
  destroyKbEditors();
  vi.unstubAllGlobals();
  resetRemoteImagesForTest();
});

describe("embed targets and sources", () => {
  it("reads only note links", () => {
    const editor = kbEditor("![a](oleafly://note/n-1#setup)\n\n![b](oleafly://project/p)\n\n![c](pic.png)");
    const images: ReturnType<typeof embedTarget>[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === "image") images.push(embedTarget(node));
    });
    expect(images).toEqual([{ kind: "note", id: "n-1", heading: "setup" }, null, null]);
  });

  it("takes the body or one section", () => {
    expect(embedSource(TEXTS["lib-1"], undefined)?.startsWith("# Setup")).toBe(true);
    expect(embedSource(TEXTS["lib-1"], "results")).toBe("# Results\nAll good.");
    expect(embedSource(TEXTS["lib-1"], "nope")).toBeNull();
    expect(embedSource("--- \ntitle: Spaced\n---\nBody text\n", undefined)).toBe("Body text");
  });
});

describe("embed cards", () => {
  it("loads a note, draws it with nested embeds as links, and opens it", async () => {
    const opts = options();
    render(<EmbedCard target={{ kind: "note", id: "n-1" }} alt="Method" options={opts} />);
    expect(await screen.findByText("three")).toBeTruthy();
    expect(document.querySelector("[data-note-embed-link]")?.textContent).toBe("Nested");
    fireEvent.click(screen.getByRole("button", { name: "Open Method" }), isMac ? { metaKey: true } : { ctrlKey: true });
    expect(opts.onOpen).toHaveBeenCalledWith("n-1", { newTab: true, projectId: "lib-1" });
  });

  it("shows one section with its heading and opens at that heading", async () => {
    const opts = options();
    render(<EmbedCard target={{ kind: "note", id: "n-1", heading: "results" }} alt="" options={opts} />);
    expect(await screen.findByText("All good.")).toBeTruthy();
    expect(document.querySelector(".note-embed-crumb")?.textContent).toBe("Results");
    expect(screen.queryByText("three")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open Method" }));
    expect(opts.onOpen).toHaveBeenCalledWith("n-1", { newTab: false, projectId: "lib-1", heading: "results" });
  });

  it.each([
    [{ kind: "note" as const, id: "zzz" }, E.missing, "missing"],
    [{ kind: "note" as const, id: "self" }, E.self, "self"],
    [{ kind: "note" as const, id: "n-1", heading: "gone" }, E.missingHeading, "missing"],
    [{ kind: "note" as const, id: "n-2" }, E.empty, "ready"],
  ])("explains %j", async (target, message, state) => {
    render(<EmbedCard target={target} alt="Alt" options={options()} />);
    expect(await screen.findByText(message)).toBeTruthy();
    expect(document.querySelector(".note-embed-card")?.getAttribute("data-state")).toBe(state);
  });

  it("says when a note can't be read and when the index is loading", async () => {
    const failing = options({ loadText: () => Promise.reject(new Error("io")) });
    const { unmount } = render(<EmbedCard target={{ kind: "note", id: "n-1" }} alt="" options={failing} />);
    expect(await screen.findByText(E.failed)).toBeTruthy();
    unmount();
    render(<EmbedCard target={{ kind: "note", id: "n-1" }} alt="Alt title" options={options({ getNotes: () => null })} />);
    expect(screen.getByText("Alt title")).toBeTruthy();
    expect(document.querySelector(".note-embed-card")?.getAttribute("data-state")).toBe("loading");
  });

  it("folds, and loads only when it scrolls into view", async () => {
    let seen: ((entries: { isIntersecting: boolean; target: Element }[]) => void) | null = null;
    let watched: Element | null = null;
    const disconnect = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: (entries: { isIntersecting: boolean; target: Element }[]) => void) {
          seen = callback;
        }
        observe(target: Element) {
          watched = target;
        }
        unobserve() {}
        disconnect = disconnect;
      },
    );
    const opts = options();
    render(<EmbedCard target={{ kind: "note", id: "n-1" }} alt="" options={opts} />);
    expect(opts.loadText).not.toHaveBeenCalled();
    act(() => seen?.([{ isIntersecting: false, target: watched as Element }]));
    expect(opts.loadText).not.toHaveBeenCalled();
    act(() => seen?.([{ isIntersecting: true, target: watched as Element }]));
    expect(await screen.findByText("three")).toBeTruthy();
    expect(disconnect).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: E.fold }));
    expect(screen.queryByText("three")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: E.unfold }));
    expect(screen.getByText("three")).toBeTruthy();
  });

  it("uses a fallback title", () => {
    render(<EmbedCard target={{ kind: "note", id: "zzz" }} alt="" options={options()} />);
    expect(screen.getByText(E.untitled)).toBeTruthy();
  });
});

describe("embeds in the editor", () => {
  function editorWith(markdown: string, opts: EmbedOptions, resolve = vi.fn(() => Promise.resolve(null))) {
    const element = document.createElement("div");
    document.body.append(element);
    const editor = new Editor({
      element,
      extensions: noteBaseExtensions()
        .map((extension) => withImageView(extension, resolve))
        .map((extension) => withNoteEmbeds(extension, opts)),
      content: parseNoteMarkdown(markdown).doc,
    });
    return editor;
  }

  it("draws embeds as cards and files as images, and swaps when the source changes", async () => {
    let listener: (() => void) | null = null;
    const opts = options({
      subscribe: (next) => {
        listener = next;
        return () => {
          listener = null;
        };
      },
    });
    const editor = editorWith("![Method](oleafly://note/n-1)\n\n![pic](assets/a.png)", opts);
    await waitFor(() => expect(editor.view.dom.querySelector(".note-embed-card")).toBeTruthy());
    expect(editor.view.dom.querySelector("figure.note-image")).toBeTruthy();
    act(() => listener?.());
    act(() => {
      editor.view.dispatch(editor.state.tr.setNodeMarkup(0, undefined, { ...editor.state.doc.child(0).attrs, src: "assets/b.png" }));
    });
    expect(editor.view.dom.querySelectorAll("figure.note-image")).toHaveLength(2);
    act(() => {
      editor.view.dispatch(editor.state.tr.setNodeMarkup(0, undefined, { ...editor.state.doc.child(0).attrs, src: "oleafly://note/n-1" }));
    });
    await waitFor(() => expect(editor.view.dom.querySelector(".note-embed-card")).toBeTruthy());
    act(() => {
      editor.view.dispatch(editor.state.tr.setNodeMarkup(0, undefined, { ...editor.state.doc.child(0).attrs, alt: "New alt" }));
    });
    editor.destroy();
    expect(listener).toBeNull();
  });

  it("keeps events on its buttons, ignores its own DOM changes, and leaves other extensions alone", () => {
    const opts = options();
    const mount = vi.fn(() => ({ render: vi.fn(), unmount: vi.fn() }));
    const editor = kbEditor("![Method](oleafly://note/n-1)");
    const view = embedNodeView(opts, mount as never)({ node: editor.state.doc.child(0) });
    const button = document.createElement("button");
    view.dom.append(button);
    const onButton = new Event("click");
    Object.defineProperty(onButton, "target", { value: button });
    expect(view.stopEvent?.(onButton)).toBe(true);
    expect(view.stopEvent?.(new Event("click"))).toBe(false);
    expect(view.ignoreMutation()).toBe(true);
    expect(view.update(editor.schema.nodes.paragraph.create())).toBe(false);
    view.destroy?.();
    const [first] = noteBaseExtensions();
    expect(withNoteEmbeds(first, opts)).toBe(first);
  });

  it("falls back to a plain image when no other view draws images", async () => {
    const opts = options();
    const element = document.createElement("div");
    document.body.append(element);
    const editor = new Editor({
      element,
      extensions: noteBaseExtensions().map((extension) => withNoteEmbeds(extension, opts)),
      content: parseNoteMarkdown("![pic](https://x.org/a.png)").doc,
    });
    const img = editor.view.dom.querySelector("img");
    expect(img?.hasAttribute("src")).toBe(false);
    const held = await waitFor(() => {
      const found = editor.view.dom.querySelector<HTMLElement>("[data-remote-image]");
      if (!found) throw new Error("not drawn yet");
      return found;
    });
    expect(held.dataset.remoteImage).toBe("x.org");
    held.querySelector("button")?.click();
    expect(img?.getAttribute("src")).toBe("https://x.org/a.png");
    expect(editor.view.dom.querySelector(".note-remote-image")).toBeNull();
    editor.view.dispatch(editor.state.tr.setNodeMarkup(0, undefined, { ...editor.state.doc.child(0).attrs, alt: "x" }));
    expect(editor.view.dom.querySelector("img")?.getAttribute("alt")).toBe("x");
    const lone = plainImageView(editor.state.doc.child(0));
    expect(lone.update?.(editor.schema.nodes.paragraph.create(), [], {} as never)).toBe(false);
    editor.destroy();
    expect(kbMarkdown(kbEditor("![pic](https://x.org/a.png)"))).toBe("![pic](https://x.org/a.png)");
  });
});
