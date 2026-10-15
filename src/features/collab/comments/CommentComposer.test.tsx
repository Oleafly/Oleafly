// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import type { CollabCommentMember } from "@/lib/tauri";
import { CommentComposer } from "./CommentComposer";

const copy = enCollab.comments;
const MEMBERS: CollabCommentMember[] = [
  { accountId: "alice", displayName: "Alice Chen", login: "alice-chen" },
  { accountId: "bob", displayName: "Bob Smith", login: "bobsmith" },
  { accountId: "dana", displayName: "Dana Ito", login: null },
];

function compose(onSubmit: (body: string) => Promise<void> = vi.fn(async () => undefined)) {
  render(
    <CommentComposer
      label={copy.replyLabel}
      submitLabel={copy.reply}
      members={MEMBERS}
      self="alice"
      onSubmit={onSubmit}
    />,
  );
  return screen.getByRole("textbox", { name: copy.replyLabel });
}

function options() {
  return within(screen.getByRole("listbox", { name: copy.mentionList })).getAllByRole("option");
}

beforeAll(async () => {
  await loadNamespace("collab");
});

describe("comment composer", () => {
  it("keeps typed text on Escape and leaves discarding it to Cancel", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <CommentComposer
        label={copy.newLabel}
        submitLabel={copy.post}
        autoFocus
        members={MEMBERS}
        self="alice"
        onSubmit={vi.fn(async () => undefined)}
        onCancel={onCancel}
      />,
    );
    const field = screen.getByRole("textbox", { name: copy.newLabel });
    await user.type(field, "A long thought about this paragraph");
    const outside = vi.fn();
    window.addEventListener("keydown", outside);
    await user.keyboard("{Escape}");
    window.removeEventListener("keydown", outside);
    expect(onCancel).not.toHaveBeenCalled();
    expect(outside).not.toHaveBeenCalled();
    expect(field).toHaveValue("A long thought about this paragraph");
    expect(field).not.toHaveFocus();
    await user.click(screen.getByRole("button", { name: enCommon.actions.cancel }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("closes an edit on Escape when nothing was changed", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <CommentComposer
        label={copy.editLabel}
        submitLabel={enCommon.actions.save}
        initial="Checked twice"
        autoFocus
        members={MEMBERS}
        self="alice"
        onSubmit={vi.fn(async () => undefined)}
        onCancel={onCancel}
      />,
    );
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);
    onCancel.mockClear();
    await user.type(screen.getByRole("textbox", { name: copy.editLabel }), " and again");
    await user.keyboard("{Escape}");
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: copy.editLabel })).toHaveValue("Checked twice and again");
  });

  it("shows a login next to a name only for members who have one", async () => {
    const user = userEvent.setup();
    const field = compose();
    await user.type(field, "@");
    const [bob, dana] = options();
    expect(within(bob).getByText("bobsmith")).toBeInTheDocument();
    expect(within(dana).getByText("Dana Ito").nextElementSibling).toBeNull();
    expect(options()).toHaveLength(2);
  });

  it("wraps from the first person to the last with the up arrow and picks by pointer", async () => {
    const user = userEvent.setup();
    const field = compose();
    await user.type(field, "Ask @");
    await user.keyboard("{ArrowUp}");
    expect(options()[1]).toHaveAttribute("aria-selected", "true");
    await user.hover(options()[0]);
    expect(options()[0]).toHaveAttribute("aria-selected", "true");
    await user.click(options()[1]);
    expect(field).toHaveValue("Ask @Dana Ito ");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("leaves Enter to the input method while a character is being composed", async () => {
    const user = userEvent.setup();
    const field = compose();
    await user.type(field, "@d");
    fireEvent.keyDown(field, { key: "Enter", isComposing: true });
    expect(field).toHaveValue("@d");
    expect(screen.getByRole("listbox", { name: copy.mentionList })).toBeInTheDocument();
  });

  it("sends nothing for a blank comment from the keyboard shortcut", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => undefined);
    const field = compose(onSubmit);
    await user.type(field, "   ");
    fireEvent.keyDown(field, { key: "Enter", metaKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: copy.reply })).toBeDisabled();
  });

  it("keeps the text and explains a refusal, then clears the box once the comment is sent", async () => {
    const user = userEvent.setup();
    const onSubmit = vi
      .fn<(body: string) => Promise<void>>()
      .mockRejectedValueOnce({ code: "comment_too_long", message: "" })
      .mockResolvedValue(undefined);
    const field = compose(onSubmit);
    await user.type(field, "  A long note  ");
    await user.click(screen.getByRole("button", { name: copy.reply }));
    expect(onSubmit).toHaveBeenCalledWith("A long note");
    expect(await screen.findByRole("alert")).toHaveTextContent(copy.refusals.tooLong);
    expect(field).toHaveValue("  A long note  ");
    await user.click(screen.getByRole("button", { name: copy.reply }));
    expect(field).toHaveValue("");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
