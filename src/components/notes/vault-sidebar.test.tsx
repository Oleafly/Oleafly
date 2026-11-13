// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import type { NoteSearchHit } from "@/lib/tauri";
import { isMac } from "@/lib/utils";
import { shortcutLabel, useShortcutStore } from "@/store/shortcuts";
import type { TagNode } from "./note-search";
import { tagTone } from "./note-tags";
import type { NoteItem } from "./types";
import { applyTheme } from "@/lib/theme";
import { optionId, SearchResultList, TagChip, TagPane, VaultFooter, type SearchRow } from "./vault-sidebar";
import "./tests/setup";

const tags = enNotes.vault.tags;

function hit(id: string, title: string, extra: Partial<NoteSearchHit> = {}): NoteSearchHit {
  return {
    id,
    noteId: id,
    title,
    titleRanges: [],
    score: 1,
    snippets: [],
    tags: [],
    aliases: [],
    relatedProject: null,
    updatedAt: 0,
    ...extra,
  };
}

function row(id: string, title: string, extra: Partial<NoteSearchHit> = {}): SearchRow {
  const note: NoteItem = { id, title, project: "Vision", updatedAt: 0, author: "you", summary: "" };
  return { hit: hit(id, title, extra), note };
}

const ROWS = [
  row("n1", "Masking ablation", { titleRanges: [[0, 7]], snippets: [{ text: "mask ratio of 0.75", ranges: [[0, 4]] }] }),
  row("n2", "Reading list"),
];

function results(props: Partial<Parameters<typeof SearchResultList>[0]> = {}) {
  const onActiveChange = vi.fn();
  const onOpen = vi.fn();
  render(
    <SearchResultList
      listId="vault-search"
      label={enNotes.vault.search.results}
      rows={ROWS}
      active={0}
      activeNoteId={null}
      onActiveChange={onActiveChange}
      onOpen={onOpen}
      {...props}
    />,
  );
  return { onActiveChange, onOpen, options: screen.getAllByRole("option") };
}

const TREE: TagNode[] = [
  {
    tag: "ml",
    name: "ml",
    count: 3,
    children: [{ tag: "ml/vision", name: "vision", count: 1, children: [] }],
  },
  { tag: "lab", name: "lab", count: 2, children: [] },
];

describe("search results", () => {
  it("lists each hit as an option with its title and first snippet, marking the matches", () => {
    const { options } = results();
    expect(screen.getByRole("listbox", { name: enNotes.vault.search.results })).toBeInTheDocument();
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveAttribute("id", optionId("vault-search", 0));
    expect(options[0]).toHaveTextContent("Masking ablation");
    expect(options[0]).toHaveTextContent("mask ratio of 0.75");
    expect([...options[0].querySelectorAll("mark")].map((mark) => mark.textContent)).toEqual(["Masking", "mask"]);
    expect(options[1].querySelector("mark")).toBeNull();
  });

  it("marks the active option as selected", () => {
    const { options } = results({ active: 1 });
    expect(options[0]).toHaveAttribute("aria-selected", "false");
    expect(options[1]).toHaveAttribute("aria-selected", "true");
  });

  it("moves the active option with the pointer, only when it changes", () => {
    const { options, onActiveChange } = results();
    fireEvent.mouseMove(options[0]);
    expect(onActiveChange).not.toHaveBeenCalled();
    fireEvent.mouseMove(options[1]);
    expect(onActiveChange).toHaveBeenCalledWith(1);
  });

  it("opens a note on click and in a new tab with the platform modifier", () => {
    const { options, onOpen } = results();
    fireEvent.click(options[1]);
    expect(onOpen).toHaveBeenLastCalledWith(ROWS[1], false);
    fireEvent.click(options[0], isMac ? { metaKey: true } : { ctrlKey: true });
    expect(onOpen).toHaveBeenLastCalledWith(ROWS[0], true);
  });

  it("lists matching blocks under their note, then a row for the rest", () => {
    const block = { line: 7, kind: "item" as const, text: "Check the cable #lab", ranges: [[16, 20]] as [number, number][] };
    const tagged = row("n1", "Masking ablation", { blocks: [block], snippets: [{ text: "hidden snippet", ranges: [] }] });
    const rows: SearchRow[] = [tagged, { ...tagged, block }, { ...tagged, more: 3 }];
    const { options, onOpen } = results({ rows });
    expect(options).toHaveLength(3);
    expect(options[0]).not.toHaveTextContent("hidden snippet");
    expect(options[1]).toHaveAttribute("data-search-block", "7");
    expect(options[1].querySelector("mark")).toHaveTextContent("#lab");
    expect(options[2]).toHaveTextContent("Show 3 more blocks");
    fireEvent.click(options[1]);
    expect(onOpen).toHaveBeenLastCalledWith(rows[1], false);
  });

  it("keeps focus where it is when an option is pressed", () => {
    const { options } = results();
    const pressed = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    options[0].dispatchEvent(pressed);
    expect(pressed.defaultPrevented).toBe(true);
  });
});

describe("tag pane", () => {
  const badgeFor = (tag: string) => screen.getByRole("button", { name: tags.filter.replace("{{tag}}", tag) });
  const badgeTexts = () => within(screen.getByRole("list", { name: tags.label })).getAllByRole("button").map((badge) => badge.textContent);
  const filterBox = () => screen.getByRole("searchbox", { name: tags.search });
  const many = (count: number): TagNode[] =>
    Array.from({ length: count }, (_, index) => {
      const name = `t${String(index + 1).padStart(2, "0")}`;
      return { tag: name, name, count: 1, children: [] };
    });

  it("shows nothing while tags load and a hint when there are none", () => {
    const { container, rerender } = render(<TagPane tree={null} selected={null} onSelect={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<TagPane tree={[]} selected={null} onSelect={vi.fn()} />);
    expect(screen.getByText(tags.empty)).toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).toBeNull();
  });

  it("shows every tag as a badge with its full path and count, in the tag's own colours", () => {
    render(<TagPane tree={TREE} selected={null} onSelect={vi.fn()} />);
    expect(badgeTexts()).toEqual(["#ml3", "#ml/vision1", "#lab2"]);
    const vision = badgeFor("ml/vision");
    const tone = tagTone("ml/vision");
    expect(vision).toHaveClass(tone.tint, ...tone.text.split(" "));
    expect(vision).toHaveAttribute("aria-pressed", "false");
    expect(within(vision).getByText("#ml/vision")).toHaveClass("truncate");
    expect(within(vision).getByText("1")).toHaveClass("opacity-70", "tabular-nums");
    expect(screen.getByRole("list", { name: tags.label })).toHaveClass("flex", "flex-wrap");
    expect(screen.queryByRole("button", { name: tags.showFewer })).toBeNull();
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("narrows the badges by any part of the tag, ignoring case, and Escape empties the box", async () => {
    const user = userEvent.setup();
    render(<TagPane tree={TREE} selected={null} onSelect={vi.fn()} />);
    expect(filterBox()).toHaveAttribute("placeholder", tags.search);
    await user.type(filterBox(), "VIS");
    expect(badgeTexts()).toEqual(["#ml/vision1"]);
    await user.clear(filterBox());
    await user.type(filterBox(), "#ml");
    expect(badgeTexts()).toEqual(["#ml3", "#ml/vision1"]);
    await user.clear(filterBox());
    await user.type(filterBox(), "zzz");
    expect(screen.queryByRole("list", { name: tags.label })).toBeNull();
    expect(screen.getByText(tags.noMatch.replace("{{query}}", "zzz"))).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(filterBox()).toHaveValue("");
    expect(badgeTexts()).toEqual(["#ml3", "#ml/vision1", "#lab2"]);
  });

  it("filters by a tag, and clears the filter when the same tag is picked again", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { rerender } = render(<TagPane tree={TREE} selected={null} onSelect={onSelect} />);
    await user.click(badgeFor("lab"));
    expect(onSelect).toHaveBeenLastCalledWith("lab");
    rerender(<TagPane tree={TREE} selected="lab" onSelect={onSelect} />);
    expect(badgeFor("lab")).toHaveAttribute("aria-pressed", "true");
    expect(badgeFor("lab")).toHaveClass("aria-pressed:border-current");
    expect(badgeFor("ml")).toHaveAttribute("aria-pressed", "false");
    await user.click(badgeFor("lab"));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("reaches the badges with Tab and toggles them with Enter and Space", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<TagPane tree={TREE} selected={null} onSelect={onSelect} />);
    await user.tab();
    expect(filterBox()).toHaveFocus();
    await user.tab();
    expect(badgeFor("ml")).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenLastCalledWith("ml");
    await user.tab();
    expect(badgeFor("ml/vision")).toHaveFocus();
    await user.keyboard(" ");
    expect(onSelect).toHaveBeenLastCalledWith("ml/vision");
  });

  it("marks a selected nested tag as pressed", () => {
    render(<TagPane tree={TREE} selected="ml/vision" onSelect={vi.fn()} />);
    expect(badgeFor("ml/vision")).toHaveAttribute("aria-pressed", "true");
    expect(badgeFor("ml")).toHaveAttribute("aria-pressed", "false");
  });

  it("shows the first thirty tags, then all of them, then fewer again, and searches past the cut", async () => {
    const user = userEvent.setup();
    render(<TagPane tree={many(35)} selected={null} onSelect={vi.fn()} />);
    expect(badgeTexts()).toHaveLength(30);
    const more = screen.getByRole("button", { name: tags.showAll.replace("{{total}}", "35") });
    expect(more).toHaveAttribute("aria-expanded", "false");
    await user.click(more);
    expect(badgeTexts()).toHaveLength(35);
    const fewer = screen.getByRole("button", { name: tags.showFewer });
    expect(fewer).toHaveAttribute("aria-expanded", "true");
    await user.click(fewer);
    expect(badgeTexts()).toHaveLength(30);
    await user.type(filterBox(), "t34");
    expect(badgeTexts()).toEqual(["#t341"]);
    expect(screen.queryByRole("button", { name: tags.showAll.replace("{{total}}", "35") })).toBeNull();
  });

  it("keeps a selected tag past the cut in view", () => {
    render(<TagPane tree={many(35)} selected="t33" onSelect={vi.fn()} />);
    expect(badgeTexts()).toHaveLength(31);
    expect(badgeFor("t33")).toHaveAttribute("aria-pressed", "true");
  });

  it("truncates a long tag inside its badge and shows the whole tag in a tooltip", async () => {
    const long = "projects/2026/grant-proposal/budget-review";
    const tree: TagNode[] = [
      { tag: long, name: long, count: 4, children: [] },
      { tag: "lab", name: "lab", count: 2, children: [] },
    ];
    const scroll = vi.spyOn(Element.prototype, "scrollWidth", "get").mockImplementation(function (this: Element) {
      return (this.textContent?.length ?? 0) * 7;
    });
    const client = vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(120);
    try {
      const user = userEvent.setup();
      render(<TagPane tree={tree} selected={null} onSelect={vi.fn()} />);
      expect(within(badgeFor(long)).getByText(`#${long}`)).toHaveClass("min-w-0", "truncate");
      await user.hover(badgeFor(long));
      expect(await screen.findByRole("tooltip")).toHaveTextContent(`#${long}`);
      await user.unhover(badgeFor(long));
      await user.hover(badgeFor("lab"));
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(screen.queryByRole("tooltip")).toBeNull();
    } finally {
      scroll.mockRestore();
      client.mockRestore();
    }
  });

  it("measures a badge again when its size changes", async () => {
    const watchers: (() => void)[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          watchers.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
    let width = 120;
    const scroll = vi.spyOn(Element.prototype, "scrollWidth", "get").mockReturnValue(60);
    const client = vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(() => width);
    try {
      const user = userEvent.setup();
      render(<TagPane tree={[{ tag: "lab", name: "lab", count: 2, children: [] }]} selected={null} onSelect={vi.fn()} />);
      await user.hover(badgeFor("lab"));
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(screen.queryByRole("tooltip")).toBeNull();
      await user.unhover(badgeFor("lab"));
      width = 40;
      act(() => {
        for (const watch of watchers) watch();
      });
      await user.hover(badgeFor("lab"));
      expect(await screen.findByRole("tooltip")).toHaveTextContent("#lab");
    } finally {
      vi.unstubAllGlobals();
      scroll.mockRestore();
      client.mockRestore();
    }
  });
});

describe("tag chip", () => {
  it("shows the tag and clears it on click", async () => {
    const onClear = vi.fn();
    render(<TagChip tag="ml/vision" onClear={onClear} />);
    const chip = screen.getByRole("button", { name: tags.clear.replace("{{tag}}", "ml/vision") });
    expect(chip).toHaveTextContent("#ml/vision");
    await userEvent.setup().click(chip);
    expect(onClear).toHaveBeenCalledOnce();
  });
});

function footerHandlers() {
  return {
    onToday: vi.fn(),
    onSwitcher: vi.fn(),
    onOpenGraph: vi.fn(),
    onTemplates: vi.fn(),
    onSettings: vi.fn(),
    onImportFolder: vi.fn(),
    onExportFolder: vi.fn(),
    onOpenDeadLinks: vi.fn(),
  };
}

function footerButtons(footer: HTMLElement): (string | null)[] {
  return within(footer)
    .getAllByRole("button")
    .map((button) => button.getAttribute("aria-label"));
}

describe("vault footer", () => {
  it("puts today, the switcher, the graph, templates and More on the left and the theme and Settings on the right", () => {
    applyTheme("light");
    const { container } = render(<VaultFooter {...footerHandlers()} />);
    const footer = container.querySelector("footer") as HTMLElement;
    const [left, right] = [...footer.children] as HTMLElement[];
    expect(footerButtons(left)).toEqual([
      enNotes.vault.daily.open,
      enNotes.vault.switcher.open,
      enNotes.graph.openGraph,
      enNotes.vault.templates.open,
      enNotes.vault.import.more,
    ]);
    expect(footerButtons(right)).toEqual([enShell.commands.theme.toDark, enNotes.library.settings]);
  });

  it("runs each action from its own button", async () => {
    const user = userEvent.setup();
    const handlers = footerHandlers();
    render(<VaultFooter {...handlers} />);
    await user.click(screen.getByRole("button", { name: enNotes.vault.daily.open }));
    expect(handlers.onToday).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: enNotes.vault.switcher.open }));
    expect(handlers.onSwitcher).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: enNotes.graph.openGraph }));
    expect(handlers.onOpenGraph).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: enNotes.vault.templates.open }));
    expect(handlers.onTemplates).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: enNotes.library.settings }));
    expect(handlers.onSettings).toHaveBeenCalledOnce();
    const runs = [
      [enNotes.vault.import.menu, handlers.onImportFolder],
      [enNotes.vault.import.export.menu, handlers.onExportFolder],
      [enNotes.linksSearch.dead.menu, handlers.onOpenDeadLinks],
    ] as const;
    for (const [item, handler] of runs) {
      await user.click(screen.getByRole("button", { name: enNotes.vault.import.more }));
      await user.click(await screen.findByRole("menuitem", { name: item }));
      await waitFor(() => expect(handler).toHaveBeenCalledOnce());
    }
  });

  it("names the shortcuts of today's note, the switcher and the graph in the hover help", async () => {
    const bindings = useShortcutStore.getState().bindings;
    render(<VaultFooter {...footerHandlers()} />);
    const shortcuts = [
      [enNotes.vault.daily.open, bindings.notesTodayNote],
      [enNotes.vault.switcher.open, bindings.notesQuickSwitcher],
      [enNotes.graph.openGraph, bindings.notesGraph],
    ] as const;
    for (const [label, binding] of shortcuts) {
      const button = screen.getByRole("button", { name: label });
      fireEvent.mouseEnter(button.parentElement as HTMLElement);
      expect(await screen.findByRole("tooltip")).toHaveTextContent(
        enShell.rail.withShortcut.replace("{{label}}", label).replace("{{shortcut}}", shortcutLabel(binding)),
      );
      fireEvent.mouseLeave(button.parentElement as HTMLElement);
      await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
    }
  });

  it("disables what it has no handler for and leaves out the graph and More", () => {
    const { container } = render(<VaultFooter />);
    expect(screen.getByRole("button", { name: enNotes.vault.daily.open })).toBeDisabled();
    expect(screen.getByRole("button", { name: enNotes.vault.switcher.open })).toBeDisabled();
    expect(screen.getByRole("button", { name: enNotes.vault.templates.open })).toBeDisabled();
    expect(screen.getByRole("button", { name: enNotes.library.settings })).toBeDisabled();
    expect(screen.queryByRole("button", { name: enNotes.graph.openGraph })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: enNotes.vault.import.more })).not.toBeInTheDocument();
    expect(footerButtons(container.querySelector("footer") as HTMLElement)).toHaveLength(5);
  });
});
