// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import enWorkspace from "@/i18n/locales/en/workspace.json" with { type: "json" };
import { i18n } from "@/i18n";
import { NewEntryInput, RenameEntryInput } from "./FileTree";

const handlers = {
  onChange: vi.fn(),
  onSubmit: vi.fn(),
  onCancel: vi.fn(),
};

describe("NewEntryInput accessibility", () => {
  it("names a root file action, keeps the placeholder hint, and focuses the field", () => {
    render(
      <NewEntryInput
        mode="file"
        value=""
        depth={0}
        parentPath=""
        {...handlers}
      />,
    );

    const input = screen.getByRole("textbox", {
      name: enWorkspace.files.newEntry.fileInRoot,
    });
    expect(input).toHaveAttribute("placeholder", enWorkspace.files.newEntry.filePlaceholder);
    expect(input).toHaveFocus();
    expect(input).toHaveClass(
      "focus-visible:ring-2",
      "focus-visible:ring-ring",
      "focus-visible:ring-offset-1",
    );
  });

  it("names a nested folder action with its destination", () => {
    render(
      <NewEntryInput
        mode="dir"
        value=""
        depth={2}
        parentPath="chapters/drafts"
        {...handlers}
      />,
    );

    expect(
      screen.getByRole("textbox", {
        name: i18n.t(($) => $.workspace.files.newEntry.folderInFolder, {
          folder: "chapters/drafts",
        }),
      }),
    ).toHaveAttribute("placeholder", enWorkspace.files.newEntry.folderPlaceholder);
  });

  it("submits only once when Enter removes and blurs the field", () => {
    const onSubmit = vi.fn();
    render(
      <NewEntryInput
        mode="file"
        value="notes.tex"
        depth={0}
        parentPath=""
        onChange={vi.fn()}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    const input = screen.getByRole("textbox", { name: enWorkspace.files.newEntry.fileInRoot });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);

    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("cancels without submitting when Escape removes and blurs the field", () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    render(
      <NewEntryInput
        mode="file"
        value="notes.tex"
        depth={0}
        parentPath=""
        onChange={vi.fn()}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );

    const input = screen.getByRole("textbox", { name: enWorkspace.files.newEntry.fileInRoot });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("RenameEntryInput", () => {
  it("submits only once when Enter removes and blurs the field", () => {
    const onSubmit = vi.fn();
    render(
      <RenameEntryInput
        value="renamed.tex"
        depth={0}
        onChange={vi.fn()}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    const input = screen.getByRole("textbox", { name: enWorkspace.files.renameAriaLabel });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);

    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("cancels without submitting when Escape removes and blurs the field", () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    render(
      <RenameEntryInput
        value="renamed.tex"
        depth={0}
        onChange={vi.fn()}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );

    const input = screen.getByRole("textbox", { name: enWorkspace.files.renameAriaLabel });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
