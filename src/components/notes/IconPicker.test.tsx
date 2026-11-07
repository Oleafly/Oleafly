// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadNamespace } from "@/i18n";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { IconPicker } from "./IconPicker";
import { LINE_ICONS } from "./note-icons";

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

function setup(value?: string) {
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(
    <IconPicker
      trigger={<span>{"icon"}</span>}
      triggerClassName="note-icon-trigger"
      value={value}
      hasIcon={value !== undefined}
      onChange={onChange}
    />,
  );
  return { onChange, user };
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
    expect(notebook).toHaveClass("bg-primary/10", "text-primary");
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
    expect(telescope).toHaveClass("bg-primary/10");
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
});
