// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadNamespace } from "@/i18n";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { withNoteEmbeds, type EmbedOptions } from "./note-embeds";
import { noteBaseExtensions, parseNoteMarkdown } from "./note-markdown";
import {
  heldRemoteImage,
  REMOTE_IMAGE_HOSTS_KEY,
  remoteImageAllowed,
  resetRemoteImagesForTest,
} from "@/lib/remote-image";
import "./tests/setup";

const copy = enNotes.document.remoteImages;
const editors: Editor[] = [];

const embeds: EmbedOptions = {
  getNotes: () => [],
  currentNoteId: () => null,
  loadText: vi.fn(async () => ""),
  version: () => 1,
  onOpen: vi.fn(),
};

function note(markdown: string): Editor {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: noteBaseExtensions().map((extension) => withNoteEmbeds(extension, embeds)),
    content: parseNoteMarkdown(markdown).doc,
  });
  editors.push(editor);
  return editor;
}

function sources(editor: Editor): (string | null)[] {
  return [...editor.view.dom.querySelectorAll("img")].map((image) => image.getAttribute("src"));
}

async function notices(editor: Editor, count: number): Promise<HTMLElement[]> {
  return waitFor(() => {
    const found = [...editor.view.dom.querySelectorAll<HTMLElement>("[data-remote-image]")];
    if (found.length !== count) throw new Error(`expected ${count} notices, saw ${found.length}`);
    return found;
  });
}

function openMenu(notice: HTMLElement): HTMLElement {
  fireEvent.pointerDown(within(notice).getByRole("button", { name: copy.more }), { button: 0, ctrlKey: false });
  return screen.getByRole("menu");
}

beforeAll(async () => {
  await loadNamespace("common");
});

beforeEach(() => {
  localStorage.clear();
  resetRemoteImagesForTest();
});

afterEach(() => {
  for (const editor of editors.splice(0)) {
    editor.view.dom.parentElement?.remove();
    editor.destroy();
  }
});

describe("remote images in notes", () => {
  it("still loads one image at a time from its own button", async () => {
    const editor = note("![a](https://x.org/a.png)\n\n![b](https://x.org/b.png)");
    const [first] = await notices(editor, 2);
    fireEvent.click(within(first).getByRole("button", { name: enCommon.remoteImage.load }));
    expect(sources(editor)).toEqual(["https://x.org/a.png", null]);
    await notices(editor, 1);
  });

  it("loads every held image in the same note at once, and none in other notes", async () => {
    const editor = note("![a](https://x.org/a.png)\n\n![b](https://y.org/b.png)\n\n![c](https://z.org/c.png)");
    const other = note("![d](https://x.org/d.png)");
    const [first] = await notices(editor, 3);
    await notices(other, 1);
    fireEvent.click(within(openMenu(first)).getByRole("menuitem", { name: copy.loadAll }));
    expect(sources(editor)).toEqual(["https://x.org/a.png", "https://y.org/b.png", "https://z.org/c.png"]);
    expect(editor.view.dom.querySelector("[data-remote-image]")).toBeNull();
    expect(sources(other)).toEqual([null]);
    await notices(other, 1);
  });

  it("remembers a trusted host, loads its images everywhere and keeps it after a restart", async () => {
    const editor = note("![a](https://x.org/a.png)\n\n![b](https://y.org/b.png)");
    const other = note("![d](https://x.org/d.png)");
    const [first] = await notices(editor, 2);
    await notices(other, 1);
    const menu = openMenu(first);
    fireEvent.click(within(menu).getByRole("menuitem", { name: copy.trustHost.replace("{{host}}", "x.org") }));
    expect(sources(editor)).toEqual(["https://x.org/a.png", null]);
    expect(sources(other)).toEqual(["https://x.org/d.png"]);
    expect(JSON.parse(localStorage.getItem(REMOTE_IMAGE_HOSTS_KEY) ?? "[]")).toEqual(["x.org"]);

    resetRemoteImagesForTest();
    expect(remoteImageAllowed("https://x.org/later.png")).toBe(true);
    expect(heldRemoteImage("https://x.org/later.png")).toBeNull();
    expect(heldRemoteImage("https://y.org/b.png")).toEqual({ url: "https://y.org/b.png", host: "y.org" });
  });
});
