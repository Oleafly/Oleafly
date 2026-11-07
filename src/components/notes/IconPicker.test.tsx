// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { loadNamespace } from "@/i18n";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { IconPicker } from "./IconPicker";
import { LINE_ICONS } from "./note-icons";

vi.mock("./EmojiGrid", () => ({
  default: ({ onSelect }: Readonly<{ onSelect: (emoji: string) => void }>) => (
    <button type="button" onClick={() => onSelect("🧪")}>
      {"emoji grid"}
    </button>
  ),
}));

beforeAll(async () => {
  await loadNamespace("notes");
});

function setup(hasIcon = false) {
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(
    <IconPicker trigger={<span>{"icon"}</span>} triggerClassName="note-icon-trigger" hasIcon={hasIcon} onChange={onChange} />,
  );
  return { onChange, user };
}

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: enNotes.icons.choose }));
  return screen.getByRole("dialog", { name: enNotes.icons.dialog });
}

describe("IconPicker", () => {
  it("opens on the emoji tab and closes after an emoji is picked", async () => {
    const { onChange, user } = setup();
    await open(user);
    expect(screen.getByRole("tab", { name: enNotes.icons.emoji })).toHaveAttribute("aria-selected", "true");
    await user.click(await screen.findByRole("button", { name: "emoji grid" }));
    expect(onChange).toHaveBeenCalledWith("🧪");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("lists every line icon and picks one by its lucide id", async () => {
    const { onChange, user } = setup();
    await open(user);
    await user.click(screen.getByRole("tab", { name: enNotes.icons.lines }));
    expect(screen.getByRole("textbox", { name: enNotes.icons.search })).toHaveAttribute(
      "placeholder",
      enNotes.icons.search,
    );
    for (const entry of Object.values(LINE_ICONS)) {
      expect(screen.getByRole("button", { name: enNotes.icons.names[entry.name] })).toBeInTheDocument();
    }
    await user.click(screen.getByRole("button", { name: enNotes.icons.names.rocket }));
    expect(onChange).toHaveBeenCalledWith("lucide:rocket");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("filters line icons by their translated name or their id", async () => {
    const { user } = setup();
    await open(user);
    await user.click(screen.getByRole("tab", { name: enNotes.icons.lines }));
    const search = screen.getByRole("textbox", { name: enNotes.icons.search });

    await user.type(search, "  LIGHT ");
    expect(screen.getByRole("button", { name: enNotes.icons.names.lightbulb })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: enNotes.icons.names.rocket })).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "flask-con");
    expect(screen.getByRole("button", { name: enNotes.icons.names.flaskConical })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: enNotes.icons.names.atom })).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "zzz");
    expect(screen.getByText(enNotes.icons.noIcons)).toBeInTheDocument();
  });

  it("goes back to the emoji grid from the icons tab", async () => {
    const { user } = setup();
    await open(user);
    await user.click(screen.getByRole("tab", { name: enNotes.icons.lines }));
    expect(screen.queryByRole("button", { name: "emoji grid" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: enNotes.icons.emoji }));
    expect(await screen.findByRole("button", { name: "emoji grid" })).toBeInTheDocument();
  });

  it("offers Remove only when the note has an icon", async () => {
    const { user } = setup(false);
    await open(user);
    expect(screen.queryByRole("button", { name: enCommon.actions.remove })).not.toBeInTheDocument();
  });

  it("clears the icon with Remove and closes", async () => {
    const { onChange, user } = setup(true);
    await open(user);
    await user.click(screen.getByRole("button", { name: enCommon.actions.remove }));
    expect(onChange).toHaveBeenCalledWith(undefined);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: enNotes.icons.choose })).toHaveClass("note-icon-trigger");
  });
});
