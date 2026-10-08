// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const sonner = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));

vi.mock("sonner", () => ({
  Toaster: (props: Record<string, unknown>) => {
    sonner.props = props;
    return null;
  },
  toast: { info: vi.fn(), error: vi.fn(), success: vi.fn(), dismiss: vi.fn() },
}));

import { ConfirmationDialog } from "./confirmation-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./dialog";
import { ErrorState } from "./empty";
import MarkdownRenderer from "./markdown-renderer";
import { Toaster } from "./sonner";

const classes = (value: unknown) => String(value ?? "").split(/\s+/u);

const READ_FAILED = "Could not read /Users/ada/paper/main.tex";
const DELETE_TITLE = "Delete project?";
const DELETE_DESCRIPTION = "The folder /Users/ada/paper moves to the recycle bin.";
const DELETE_LABEL = "Delete";
const ENGINE_TITLE = "Engine failed";
const ENGINE_DETAIL = "latexmk exited with code 12";

describe("error and detail text selection", () => {
  it("lets people select the message and description of a toast", () => {
    render(<Toaster />);

    const options = sonner.props?.toastOptions as { classNames: Record<string, string> };

    expect(classes(options.classNames.title)).toContain("select-text");
    expect(classes(options.classNames.description)).toContain("select-text");
  });

  it("lets people select an error state message", () => {
    render(<ErrorState message={READ_FAILED} />);

    expect(screen.getByText(READ_FAILED)).toHaveClass("select-text");
  });

  it("lets people select a confirmation dialog description", () => {
    render(
      <ConfirmationDialog
        open
        title={DELETE_TITLE}
        description={DELETE_DESCRIPTION}
        confirmLabel={DELETE_LABEL}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText(DELETE_DESCRIPTION)).toHaveClass("select-text");
  });

  it("lets people select a dialog description", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>{ENGINE_TITLE}</DialogTitle>
          <DialogDescription>{ENGINE_DETAIL}</DialogDescription>
        </DialogContent>
      </Dialog>,
    );

    expect(screen.getByText(ENGINE_DETAIL)).toHaveClass("select-text");
  });

  it("lets people select rendered Markdown and scopes Select All to a code block", () => {
    const { container } = render(
      <MarkdownRenderer>{["Run this:", "", "```sh", "latexmk -pdf main.tex", "```"].join("\n")}</MarkdownRenderer>,
    );

    expect(container.firstElementChild).toHaveClass("select-text");
    expect(container.querySelector("pre")?.hasAttribute("data-select-all-scope")).toBe(true);
  });
});
