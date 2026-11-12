// @vitest-environment jsdom

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import type { NoteDocument as NoteDocumentComponent } from "./NoteDocument";
import type { NotesHome as NotesHomeComponent } from "./NotesHome";
import type { NotesLibrary as NotesLibraryComponent } from "./NotesLibrary";
import type { NoteItem } from "./types";
import { fakeNotesData } from "./tests/notes-data-fixture";
import "./tests/setup";

const originalPlatform = navigator.platform;
const label = vi.hoisted(() => ({ library: "Library", homeTasks: "Home tasks", libraryOpens: "Library opens n3" }));

vi.mock("./NoteDocument", async () => {
  const { useEffect, useRef } = await import("react");
  const { registerNoteEditor } = await import("@/lib/open-note-editors");
  return {
    NoteDocument: function NoteDocumentStandIn({ note, openScroll }: Parameters<typeof NoteDocumentComponent>[0]) {
      const root = useRef<HTMLDivElement>(null);
      useEffect(
        () =>
          registerNoteEditor(note.id, {
            root: root.current,
            editor: null as never,
            title: () => note.title,
            timedOut: () => "",
            text: () => "",
            flush: () => Promise.resolve(null),
            busy: () => false,
            history: () => undefined,
          }),
        [note.id, note.title],
      );
      return (
        <div ref={root} data-testid={`document-${note.id}`}>
          <output data-testid={`scroll-${note.id}`}>{openScroll ? String(openScroll.top) : "none"}</output>
        </div>
      );
    },
  };
});

vi.mock("./NotesHome", () => ({
  NotesHome: function HomeStandIn({ tab, onTabChange, onOpenNote }: Parameters<typeof NotesHomeComponent>[0]) {
    return (
      <section data-testid="home">
        <output data-testid="home-tab">{tab ?? "none"}</output>
        {(["n1", "n2", "n3"] as const).map((id) => (
          <button key={id} type="button" onClick={() => onOpenNote(id)}>
            {`Home opens ${id}`}
          </button>
        ))}
        <button type="button" onClick={() => onTabChange?.("tasks")}>
          {label.homeTasks}
        </button>
      </section>
    );
  },
}));

vi.mock("./NotesLibrary", () => ({
  NotesLibrary: function LibraryStandIn({ onOpenNote }: Parameters<typeof NotesLibraryComponent>[0]) {
    return (
      <aside aria-label={label.library}>
        <button type="button" onClick={() => onOpenNote("n3")}>
          {label.libraryOpens}
        </button>
      </aside>
    );
  },
}));

import { NotesDataProvider, type NotesData } from "./notes-data";
import { NotesWorkspace } from "./NotesWorkspace";
import { useShortcutStore } from "@/store/shortcuts";

const copy = enNotes.workspace;

const notes: NoteItem[] = [
  { id: "n1", title: "Masking ablation", project: "Vision", updatedAt: 0, author: "you", summary: "" },
  { id: "n2", title: "Reading list", project: "Vision", updatedAt: 0, author: "you", summary: "" },
  { id: "n3", title: "Loose ends", project: "Vision", updatedAt: 0, author: "you", summary: "" },
];

function setPlatform(value: string) {
  Object.defineProperty(navigator, "platform", { value, configurable: true });
  useShortcutStore.getState().resetAll();
}

function renderWorkspace(props: Parameters<typeof NotesWorkspace>[0] = {}, data: NotesData = fakeNotesData({ notes })) {
  const tree = (next: NotesData) => (
    <NotesDataProvider value={next}>
      <NotesWorkspace {...props} />
    </NotesDataProvider>
  );
  const utils = render(tree(data));
  return { ...utils, rerenderWith: (next: NotesData) => utils.rerender(tree(next)) };
}

function back(): HTMLElement {
  return screen.getByRole("button", { name: copy.back });
}

function forward(): HTMLElement {
  return screen.getByRole("button", { name: copy.forward });
}

function shownView(): string | null {
  return document.querySelector('[role="tabpanel"][data-shown="true"]')?.getAttribute("data-view") ?? null;
}

function tabCount(): number {
  return screen.queryAllByRole("tab").length;
}

async function walk(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Home opens n1" }));
  const scroller = screen.getByTestId("document-n1");
  scroller.scrollTop = 300;
  await user.click(screen.getByRole("button", { name: copy.breadcrumbHome }));
  await user.click(screen.getByRole("button", { name: "Home opens n2" }));
  expect(shownView()).toBe("note:n2");
  expect(tabCount()).toBe(1);
}

beforeEach(() => {
  localStorage.clear();
  setPlatform("Win32");
});

afterEach(() => {
  setPlatform(originalPlatform);
  vi.restoreAllMocks();
});

describe("NotesWorkspace back and forward", () => {
  it("sits right after the sidebar toggle and starts with nowhere to go", () => {
    renderWorkspace();
    const toggle = screen.getByRole("button", { name: copy.hideSidebar });
    expect(toggle.parentElement?.nextElementSibling).toContainElement(back());
    expect(back()).toBeDisabled();
    expect(forward()).toBeDisabled();
  });

  it("names the shortcuts in the hover help", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await walk(user);
    fireEvent.mouseEnter(back().parentElement as HTMLElement);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      enShell.rail.withShortcut.replace("{{label}}", copy.back).replace("{{shortcut}}", "Alt+←"),
    );
  });

  it("walks back and forward through the places opened in one tab and brings back the note's scroll", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await walk(user);
    expect(back()).toBeEnabled();
    expect(forward()).toBeDisabled();

    await user.click(back());
    expect(shownView()).toMatch(/^home/u);
    await user.click(back());
    expect(shownView()).toBe("note:n1");
    expect(screen.getByTestId("scroll-n1")).toHaveTextContent("300");
    await user.click(back());
    expect(shownView()).toMatch(/^home/u);
    expect(back()).toBeDisabled();
    expect(tabCount()).toBe(1);

    await user.click(forward());
    await user.click(forward());
    await user.click(forward());
    expect(shownView()).toBe("note:n2");
    expect(forward()).toBeDisabled();
  });

  it("drops the places ahead when you go somewhere new after going back", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await walk(user);
    await user.click(back());
    await user.click(screen.getByRole("button", { name: "Home opens n3" }));
    expect(shownView()).toBe("note:n3");
    expect(forward()).toBeDisabled();
    await user.click(back());
    await user.click(back());
    expect(shownView()).toBe("note:n1");
  });

  it("lists the places behind on right-click and jumps straight to one", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await walk(user);
    fireEvent.contextMenu(back());
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([copy.home, "Masking ablation", copy.home]);
    await user.click(within(menu).getByRole("menuitem", { name: "Masking ablation" }));
    expect(shownView()).toBe("note:n1");
    fireEvent.contextMenu(forward());
    const ahead = await screen.findByRole("menu");
    expect(within(ahead).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([copy.home, "Reading list"]);
  });

  it("skips a note that was deleted", async () => {
    const user = userEvent.setup();
    const { rerenderWith } = renderWorkspace();
    await walk(user);
    rerenderWith(fakeNotesData({ notes: notes.filter((note) => note.id !== "n1") }));
    await user.click(back());
    await user.click(back());
    expect(shownView()).toMatch(/^home/u);
    expect(back()).toBeDisabled();
  });

  it("gives a note opened in a new tab its own history", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await walk(user);
    await user.click(screen.getByRole("button", { name: label.libraryOpens }));
    expect(tabCount()).toBe(2);
    expect(shownView()).toBe("note:n3");
    expect(back()).toBeDisabled();
    await user.click(screen.getByRole("tab", { name: "Reading list" }));
    expect(back()).toBeEnabled();
  });

  it("counts a switch between Home's tabs as a step", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(screen.getByRole("button", { name: label.homeTasks }));
    expect(screen.getByTestId("home-tab")).toHaveTextContent("tasks");
    await user.click(back());
    expect(screen.getByTestId("home-tab")).toHaveTextContent("mine");
    await user.click(forward());
    expect(screen.getByTestId("home-tab")).toHaveTextContent("tasks");
  });

  it("keeps the history across a restart", async () => {
    const user = userEvent.setup();
    const { unmount } = renderWorkspace();
    await walk(user);
    unmount();
    renderWorkspace();
    expect(shownView()).toBe("note:n2");
    await user.click(back());
    await user.click(back());
    expect(shownView()).toBe("note:n1");
    expect(screen.getByTestId("scroll-n1")).toHaveTextContent("300");
  });

  it("goes back and forward with Alt+Left and Alt+Right on Windows and Linux", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await walk(user);
    const left = new KeyboardEvent("keydown", { key: "ArrowLeft", altKey: true, bubbles: true, cancelable: true });
    act(() => {
      window.dispatchEvent(left);
    });
    expect(left.defaultPrevented).toBe(true);
    expect(shownView()).toMatch(/^home/u);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", altKey: true, bubbles: true, cancelable: true }));
    });
    expect(shownView()).toBe("note:n2");
  });

  it("goes back and forward with Command+[ and Command+] on macOS", async () => {
    setPlatform("MacIntel");
    const user = userEvent.setup();
    renderWorkspace();
    await walk(user);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "[", metaKey: true, bubbles: true, cancelable: true }));
    });
    expect(shownView()).toMatch(/^home/u);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "]", metaKey: true, bubbles: true, cancelable: true }));
    });
    expect(shownView()).toBe("note:n2");
  });

  it("goes back and forward with the mouse's side buttons and keeps them from doing anything else", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await walk(user);
    const press = new MouseEvent("mouseup", { button: 3, bubbles: true, cancelable: true });
    act(() => {
      screen.getByTestId("document-n2").dispatchEvent(press);
    });
    expect(press.defaultPrevented).toBe(true);
    expect(shownView()).toMatch(/^home/u);
    act(() => {
      document.body.dispatchEvent(new MouseEvent("mouseup", { button: 4, bubbles: true, cancelable: true }));
    });
    expect(shownView()).toBe("note:n2");
    const middle = new MouseEvent("mouseup", { button: 1, bubbles: true, cancelable: true });
    act(() => {
      document.body.dispatchEvent(middle);
    });
    expect(middle.defaultPrevented).toBe(false);
  });
});
