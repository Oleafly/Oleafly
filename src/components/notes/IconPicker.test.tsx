// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadNamespace } from "@/i18n";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enLibrary from "@/i18n/locales/en/library.json" with { type: "json" };
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { IconPicker } from "./IconPicker";
import { NOTE_COLORS } from "./note-file";
import { LINE_ICONS, NOTE_COLOR_HEX } from "./note-icons";
import type { NoteColor } from "./types";

vi.mock("./EmojiGrid", () => ({
  default: ({ selected, onSelect }: Readonly<{ selected?: string; onSelect: (emoji: string) => void }>) => (
    <button type="button" data-selected={selected ?? "none"} onClick={() => onSelect("🧪")}>
      {"emoji grid"}
    </button>
  ),
}));

const scrollIntoView = vi.fn();

beforeAll(async () => {
  await loadNamespace("notes");
  Element.prototype.scrollIntoView = scrollIntoView;
});

afterEach(() => {
  scrollIntoView.mockClear();
});

function setup(value?: string, colors?: { color?: NoteColor; withColors?: boolean }) {
  const onChange = vi.fn();
  const onColorChange = vi.fn();
  const user = userEvent.setup();
  render(
    <IconPicker
      trigger={<span>{"icon"}</span>}
      triggerClassName="note-icon-trigger"
      value={value}
      hasIcon={value !== undefined}
      onChange={onChange}
      color={colors?.color}
      onColorChange={colors?.withColors ? onColorChange : undefined}
    />,
  );
  return { onChange, onColorChange, user };
}

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: enNotes.icons.choose }));
  return screen.getByRole("dialog", { name: enNotes.icons.dialog });
}

function tab(name: string) {
  return screen.getByRole("tab", { name });
}

function lineIcon(name: string) {
  return screen.getByRole("button", { name });
}

describe("IconPicker", () => {
  it("opens on the emoji tab for an emoji, marks it as chosen, and closes after a pick", async () => {
    const { onChange, user } = setup("🚀");
    await open(user);
    expect(tab(enNotes.icons.emoji)).toHaveAttribute("aria-selected", "true");
    const grid = await screen.findByRole("button", { name: "emoji grid" });
    expect(grid).toHaveAttribute("data-selected", "🚀");
    await user.click(grid);
    expect(onChange).toHaveBeenCalledWith("🧪");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("opens on the icons tab with the notebook chosen when the note has no icon", async () => {
    const { user } = setup();
    await open(user);
    expect(tab(enNotes.icons.lines)).toHaveAttribute("aria-selected", "true");
    const notebook = lineIcon(enNotes.icons.names.notebookPen);
    expect(notebook).toHaveAttribute("aria-pressed", "true");
    expect(notebook).toHaveClass("note-chip");
    expect(lineIcon(enNotes.icons.names.atom)).not.toHaveClass("note-chip");
    expect(lineIcon(enNotes.icons.names.atom)).toHaveAttribute("aria-pressed", "false");
    expect(screen.getAllByRole("button", { pressed: true })).toHaveLength(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    await user.click(tab(enNotes.icons.emoji));
    expect(await screen.findByRole("button", { name: "emoji grid" })).toHaveAttribute("data-selected", "none");
  });

  it("marks the note's own line icon and scrolls it into view", async () => {
    const { user } = setup("lucide:telescope");
    await open(user);
    expect(tab(enNotes.icons.lines)).toHaveAttribute("aria-selected", "true");
    const telescope = lineIcon(enNotes.icons.names.telescope);
    expect(telescope).toHaveAttribute("aria-pressed", "true");
    expect(telescope).toHaveClass("note-chip");
    expect(lineIcon(enNotes.icons.names.notebookPen)).not.toHaveClass("note-chip");
    expect(lineIcon(enNotes.icons.names.notebookPen)).toHaveAttribute("aria-pressed", "false");
    expect(scrollIntoView.mock.contexts).toContain(telescope);
  });

  it("opens again on the tab of the current icon after the person switched tabs", async () => {
    const { user } = setup("lucide:atom");
    await open(user);
    await user.click(tab(enNotes.icons.emoji));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await open(user);
    expect(tab(enNotes.icons.lines)).toHaveAttribute("aria-selected", "true");
  });

  it("lists every line icon and picks one by its lucide id", async () => {
    const { onChange, user } = setup();
    await open(user);
    expect(screen.getByRole("textbox", { name: enNotes.icons.search })).toHaveAttribute(
      "placeholder",
      enNotes.icons.search,
    );
    for (const entry of Object.values(LINE_ICONS)) {
      expect(lineIcon(enNotes.icons.names[entry.name])).toBeInTheDocument();
    }
    await user.click(lineIcon(enNotes.icons.names.rocket));
    expect(onChange).toHaveBeenCalledWith("lucide:rocket");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("filters line icons by their translated name or their id", async () => {
    const { user } = setup();
    await open(user);
    const search = screen.getByRole("textbox", { name: enNotes.icons.search });

    await user.type(search, "  LIGHT ");
    expect(lineIcon(enNotes.icons.names.lightbulb)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: enNotes.icons.names.rocket })).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "flask-con");
    expect(lineIcon(enNotes.icons.names.flaskConical)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: enNotes.icons.names.atom })).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "zzz");
    expect(screen.getByText(enNotes.icons.noIcons)).toBeInTheDocument();
  });

  it("finds one button for each name a person searches for", async () => {
    const { user } = setup();
    await open(user);
    await user.type(screen.getByRole("textbox", { name: enNotes.icons.search }), "flask");
    expect(screen.getAllByRole("button", { name: new RegExp(enNotes.icons.names.flaskConical, "iu") })).toHaveLength(1);
  });

  it("goes back to the icon grid from the emoji tab", async () => {
    const { user } = setup("🧪");
    await open(user);
    await user.click(tab(enNotes.icons.lines));
    expect(screen.queryByRole("button", { name: "emoji grid" })).not.toBeInTheDocument();
    expect(screen.queryAllByRole("button", { pressed: true })).toHaveLength(0);
    await user.click(tab(enNotes.icons.emoji));
    expect(await screen.findByRole("button", { name: "emoji grid" })).toBeInTheDocument();
  });

  it("offers Remove only when the note has an icon", async () => {
    const { user } = setup();
    await open(user);
    expect(screen.queryByRole("button", { name: enCommon.actions.remove })).not.toBeInTheDocument();
  });

  it("clears the icon with Remove and closes", async () => {
    const { onChange, user } = setup("🧪");
    await open(user);
    await user.click(screen.getByRole("button", { name: enCommon.actions.remove }));
    expect(onChange).toHaveBeenCalledWith(undefined);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: enNotes.icons.choose })).toHaveClass("note-icon-trigger");
  });

  it("shows no colour row when the caller cannot change the colour", async () => {
    const { user } = setup("lucide:atom", { color: "mint" });
    const dialog = await open(user);
    expect(dialog.querySelector("[data-note-colors]")).toBeNull();
    expect(dialog.querySelector("[data-note-swatch]")).toBeNull();
  });

  it("offers the 11 cover colours by their library names and marks the note's own", async () => {
    const { user } = setup("lucide:atom", { color: "lilac", withColors: true });
    const dialog = await open(user);
    const row = dialog.querySelector<HTMLElement>("[data-note-colors]");
    if (!row) throw new Error("no colour row");
    const swatches = Array.from(row.querySelectorAll<HTMLButtonElement>("[data-note-swatch]"));
    expect(swatches.map((swatch) => swatch.dataset.noteSwatch)).toEqual([...NOTE_COLORS]);
    expect(swatches.map((swatch) => swatch.getAttribute("aria-label"))).toEqual(NOTE_COLORS.map((color) => enLibrary.colors[color]));
    for (const swatch of swatches) {
      const current = swatch.dataset.noteSwatch === "lilac";
      expect(swatch).toHaveAttribute("aria-pressed", String(current));
      expect(swatch.style.getPropertyValue("--note-color")).toBe(NOTE_COLOR_HEX[swatch.dataset.noteSwatch as NoteColor]);
      expect(swatch.querySelector("svg") !== null).toBe(current);
    }
    expect(screen.getByRole("button", { name: enLibrary.colors.lilac }).querySelector("svg")).toHaveClass("text-black/70");
    expect(row.closest<HTMLElement>("[style]")?.style.getPropertyValue("--note-color")).toBe(NOTE_COLOR_HEX.lilac);
  });

  it("draws the check in white on the dark blue swatch", async () => {
    const { user } = setup(undefined, { color: "blue", withColors: true });
    await open(user);
    const blue = screen.getByRole("button", { name: enLibrary.colors.blue });
    expect(blue).toHaveAttribute("aria-pressed", "true");
    expect(blue.querySelector("svg")).toHaveClass("text-white");
    expect(blue.querySelector("svg")).not.toHaveClass("text-black/70");
  });

  it("closes after a pick and gives focus back to the same trigger", async () => {
    const { onChange, user } = setup("lucide:atom");
    const trigger = screen.getByRole("button", { name: enNotes.icons.choose });
    await user.click(trigger);
    await user.click(lineIcon(enNotes.icons.names.rocket));
    expect(onChange).toHaveBeenCalledWith("lucide:rocket");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: enNotes.icons.choose })).toBe(trigger);
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("gives focus back to the trigger after Remove too", async () => {
    const { user } = setup("🧪");
    const trigger = screen.getByRole("button", { name: enNotes.icons.choose });
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: enCommon.actions.remove }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("shows a focused colour swatch with a border, not by growing it", async () => {
    const { user } = setup("lucide:atom", { color: "lilac", withColors: true });
    await open(user);
    const swatch = screen.getByRole("button", { name: enLibrary.colors.peach });
    expect(swatch.className).not.toMatch(/focus-visible:scale/u);
    const css = readFileSync("src/components/notes/notes.css", "utf8");
    expect(css).toMatch(/\.note-swatch:focus-visible \{\s*border: 2px solid var\(--ring\);/u);
  });

  it("changes the colour without closing, and still closes after an icon is picked", async () => {
    const { onChange, onColorChange, user } = setup("lucide:atom", { color: "lilac", withColors: true });
    await open(user);
    await user.click(screen.getByRole("button", { name: enLibrary.colors.peach }));
    expect(onColorChange).toHaveBeenCalledOnce();
    expect(onColorChange).toHaveBeenCalledWith("peach");
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: enNotes.icons.dialog })).toBeInTheDocument();
    await user.click(lineIcon(enNotes.icons.names.rocket));
    expect(onChange).toHaveBeenCalledWith("lucide:rocket");
    expect(onColorChange).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("line icon keyboard", () => {
  it("is one tab stop that arrow keys move across, row by row", async () => {
    const { user } = setup("lucide:atom");
    await user.click(screen.getByRole("button", { name: enNotes.icons.choose }));
    await user.click(screen.getByRole("tab", { name: enNotes.icons.lines }));
    const group = await screen.findByRole("group", { name: enNotes.icons.lines });
    const cells = within(group).getAllByRole("button");
    expect(cells.filter((cell) => cell.tabIndex === 0)).toHaveLength(1);
    const start = cells.findIndex((cell) => cell.tabIndex === 0);
    cells[start].focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(cells[start + 1]);
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(cells[start + 9]);
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(cells[0]);
    expect(cells.filter((cell) => cell.tabIndex === 0)).toEqual([cells[0]]);
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(cells.at(-1));
  });
});

