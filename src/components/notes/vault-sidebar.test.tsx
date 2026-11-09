// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { loadNamespace } from "@/i18n";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import type { NoteSearchHit } from "@/lib/tauri";
import { isMac } from "@/lib/utils";
import { shortcutLabel, useShortcutStore } from "@/store/shortcuts";
import type { TagNode } from "./note-search";
import type { NoteItem } from "./types";
import { optionId, SearchResultList, TagChip, TagPane, TemplateButton, VaultHeaderActions, type SearchRow } from "./vault-sidebar";

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

beforeAll(async () => {
  await loadNamespace("notes");
});

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
    expect(onOpen).toHaveBeenLastCalledWith("n2", false);
    fireEvent.click(options[0], isMac ? { metaKey: true } : { ctrlKey: true });
    expect(onOpen).toHaveBeenLastCalledWith("n1", true);
  });

  it("opens a note with Enter", () => {
    const { options, onOpen } = results();
    fireEvent.keyDown(options[0], { key: "Enter" });
    expect(onOpen).toHaveBeenCalledWith("n1", false);
    fireEvent.keyDown(options[0], { key: "ArrowDown" });
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("keeps focus where it is when an option is pressed", () => {
    const { options } = results();
    const pressed = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    options[0].dispatchEvent(pressed);
    expect(pressed.defaultPrevented).toBe(true);
  });
});

describe("tag pane", () => {
  it("shows nothing while tags load and a hint when there are none", () => {
    const { container, rerender } = render(<TagPane tree={null} selected={null} onSelect={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<TagPane tree={[]} selected={null} onSelect={vi.fn()} />);
    expect(screen.getByText(tags.empty)).toBeInTheDocument();
  });

  it("lists top tags with counts and opens a branch to show its children", async () => {
    const user = userEvent.setup();
    render(<TagPane tree={TREE} selected={null} onSelect={vi.fn()} />);
    const list = screen.getByRole("list", { name: tags.label });
    expect(within(list).getByRole("button", { name: tags.filter.replace("{{tag}}", "ml") })).toHaveTextContent("#ml3");
    expect(screen.queryByRole("button", { name: tags.filter.replace("{{tag}}", "ml/vision") })).toBeNull();
    const expand = screen.getByRole("button", { name: tags.expand.replace("{{tag}}", "ml") });
    expect(expand).toHaveAttribute("aria-expanded", "false");
    await user.click(expand);
    expect(screen.getByRole("button", { name: tags.filter.replace("{{tag}}", "ml/vision") })).toHaveTextContent("#vision1");
    await user.click(screen.getByRole("button", { name: tags.collapse.replace("{{tag}}", "ml") }));
    expect(screen.queryByRole("button", { name: tags.filter.replace("{{tag}}", "ml/vision") })).toBeNull();
    expect(screen.queryByRole("button", { name: tags.expand.replace("{{tag}}", "lab") })).toBeNull();
  });

  it("filters by a tag, and clears the filter when the same tag is picked again", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { rerender } = render(<TagPane tree={TREE} selected={null} onSelect={onSelect} />);
    await user.click(screen.getByRole("button", { name: tags.filter.replace("{{tag}}", "lab") }));
    expect(onSelect).toHaveBeenLastCalledWith("lab");
    rerender(<TagPane tree={TREE} selected="lab" onSelect={onSelect} />);
    const lab = screen.getByRole("button", { name: tags.filter.replace("{{tag}}", "lab") });
    expect(lab).toHaveAttribute("aria-pressed", "true");
    await user.click(lab);
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("opens the branch that holds the selected tag", () => {
    render(<TagPane tree={TREE} selected="ml/vision" onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: tags.collapse.replace("{{tag}}", "ml") })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: tags.filter.replace("{{tag}}", "ml/vision") })).toHaveAttribute("aria-pressed", "true");
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

describe("vault header actions", () => {
  it("runs today's note and the switcher, and names their shortcuts in the hover help", async () => {
    const onToday = vi.fn();
    const onSwitcher = vi.fn();
    render(<VaultHeaderActions onToday={onToday} onSwitcher={onSwitcher} />);
    const bindings = useShortcutStore.getState().bindings;
    const today = screen.getByRole("button", { name: enNotes.vault.daily.open });
    fireEvent.click(today);
    expect(onToday).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: enNotes.vault.switcher.open }));
    expect(onSwitcher).toHaveBeenCalledOnce();
    fireEvent.mouseEnter(today.parentElement as HTMLElement);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      enShell.rail.withShortcut
        .replace("{{label}}", enNotes.vault.daily.open)
        .replace("{{shortcut}}", shortcutLabel(bindings.notesTodayNote)),
    );
  });

  it("disables the actions it has no handler for", () => {
    render(<VaultHeaderActions />);
    expect(screen.getByRole("button", { name: enNotes.vault.daily.open })).toBeDisabled();
    expect(screen.getByRole("button", { name: enNotes.vault.switcher.open })).toBeDisabled();
  });
});

describe("template button", () => {
  it("opens the templates and is disabled without a handler", () => {
    const onClick = vi.fn();
    const { rerender } = render(<TemplateButton onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: enNotes.vault.templates.open }));
    expect(onClick).toHaveBeenCalledOnce();
    rerender(<TemplateButton />);
    expect(screen.getByRole("button", { name: enNotes.vault.templates.open })).toBeDisabled();
  });
});
