// @vitest-environment jsdom
import { act, render, screen, within } from "@testing-library/react";
import { createPortal } from "react-dom";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { NoteInfo, NoteInfoPanel } from "./NoteInfo";
import { NoteLinkSection } from "./NoteListItem";
import { destroyKbEditors, kbEditor } from "./tests/kb-editor-fixtures";
import type { NoteItem } from "./types";
import "./tests/setup";

const copy = enNotes.info;
const LINKED = enNotes.links.linkedFrom;
const NO_TITLE = "";
const NOW = Date.UTC(2026, 10, 11, 12);
const NOTE: NoteItem = {
  id: "lib-1",
  title: "Masking",
  project: "Vision",
  updatedAt: NOW - 5 * 60_000,
  createdAt: NOW - 3 * 86_400_000,
  author: "you",
  summary: "",
};

function words(count: number): string {
  return Array.from({ length: count }, (_, index) => `word${index}`).join(" ");
}

function stat(id: string): string {
  const row = document.querySelector(`[data-note-stat="${id}"]`);
  return row?.querySelector("dd")?.textContent ?? "";
}

afterEach(() => {
  destroyKbEditors();
  vi.useRealTimers();
});

describe("NoteInfo", () => {
  it("heads the panel with the note's icon and title and lists its details", () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const editor = kbEditor("# Plan\n\nOne two three.\n\n- four");
    render(
      <NoteInfo editor={editor} note={NOTE} icon="🧪" color="rose" title={NOTE.title}>
        {null}
      </NoteInfo>,
    );
    expect(screen.getByRole("heading", { name: "Masking" })).toBeInTheDocument();
    const details = document.querySelector("dl") as HTMLElement;
    expect(details).toHaveAttribute("aria-label", copy.details);
    expect(within(details).getAllByRole("term").map((term) => term.textContent)).toEqual([
      copy.created,
      copy.updated,
      copy.words,
      copy.characters,
      copy.lines,
      copy.readingTime,
    ]);
    expect(stat("created")).toBe("3 days ago");
    expect(stat("updated")).toBe("5 minutes ago");
    expect(stat("words")).toBe("5");
    expect(stat("characters")).toBe("22");
    expect(stat("lines")).toBe("3");
    expect(stat("reading")).toBe(copy.underMinute);
  });

  it("leaves out the dates of a note that has none and names an untitled note", () => {
    const editor = kbEditor("Text");
    render(
      <NoteInfo editor={editor} note={{ ...NOTE, updatedAt: 0, createdAt: undefined }} title={NO_TITLE}>
        {null}
      </NoteInfo>,
    );
    expect(screen.getByRole("heading", { name: enNotes.document.untitled })).toBeInTheDocument();
    expect(document.querySelector('[data-note-stat="created"]')).toBeNull();
    expect(document.querySelector('[data-note-stat="updated"]')).toBeNull();
  });

  it("counts again as the note is typed, in minutes once it takes one to read", () => {
    const editor = kbEditor(words(200));
    render(
      <NoteInfo editor={editor} note={NOTE} title={NOTE.title}>
        {null}
      </NoteInfo>,
    );
    expect(stat("words")).toBe("200");
    expect(stat("reading")).toBe("1 min");
    act(() => {
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, ` ${words(1000)}`);
    });
    expect(stat("words")).toBe("1,200");
    expect(stat("reading")).toBe("5 min");
    act(() => {
      editor.commands.clearContent();
    });
    expect(stat("words")).toBe("0");
    expect(stat("lines")).toBe("0");
    expect(stat("reading")).toBe(copy.underMinute);
  });

  it("draws its sections as full width rows with the chevron last and an empty line when they have nothing", () => {
    const editor = kbEditor("Text");
    const onOpenChange = vi.fn();
    render(
      <NoteInfo editor={editor} note={NOTE} title={NOTE.title}>
        <NoteLinkSection title={LINKED} open count={0} empty={copy.noBacklinks} onOpenChange={onOpenChange} />
      </NoteInfo>,
    );
    const toggle = screen.getByRole("button", { name: `${LINKED} 0` });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveClass("w-full");
    expect(toggle.lastElementChild?.tagName.toLowerCase()).toBe("svg");
    expect(within(screen.getByRole("region", { name: LINKED })).getByText(copy.noBacklinks)).toBeInTheDocument();
    toggle.click();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps a section on the page as it was, with no empty line", () => {
    render(<NoteLinkSection title={LINKED} open count={0} empty={copy.noBacklinks} onOpenChange={vi.fn()} className="mt-10" />);
    const toggle = screen.getByRole("button", { name: `${LINKED} 0` });
    expect(toggle).not.toHaveClass("w-full");
    expect(toggle.firstElementChild?.tagName.toLowerCase()).toBe("svg");
    expect(screen.queryByText(copy.noBacklinks)).not.toBeInTheDocument();
  });
});

describe("NoteInfoPanel", () => {
  function Panel({ content }: Readonly<{ content: string | null }>) {
    const [target, setTarget] = useState<HTMLElement | null>(null);
    return (
      <>
        <NoteInfoPanel onTarget={setTarget} />
        {target && content ? createPortal(<p>{content}</p>, target) : null}
      </>
    );
  }

  it("asks for a note until one fills it", () => {
    const { rerender } = render(<Panel content={null} />);
    const panel = screen.getByRole("region", { name: copy.title });
    expect(within(panel).getByText(copy.noNote)).toBeInTheDocument();
    rerender(<Panel content="Info for Masking" />);
    expect(within(panel).getByText("Info for Masking")).toBeInTheDocument();
    expect(within(panel).getByText(copy.noNote).parentElement?.parentElement).toHaveClass("peer-empty:flex");
  });
});
