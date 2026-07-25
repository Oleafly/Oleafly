// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NewEntryInput } from "./FileTree";

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
      name: "New file name in project root",
    });
    expect(input).toHaveAttribute("placeholder", "New file name");
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
        name: "New folder name in folder chapters/drafts",
      }),
    ).toHaveAttribute("placeholder", "New folder name");
  });
});
