// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { loadNamespace } from "@/i18n";
import enEditor from "@/i18n/locales/en/editor.json" with { type: "json" };
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { ReviewBar } from "./ReviewBar";

function handlers() {
  return {
    onPrevious: vi.fn(),
    onNext: vi.fn(),
    onAccept: vi.fn(),
    onReject: vi.fn(),
    onAcceptAll: vi.fn(),
    onRejectAll: vi.fn(),
  };
}

beforeAll(async () => {
  await loadNamespace("notes");
});

describe("ReviewBar", () => {
  it("offers bulk actions and stepping when there are several changes", () => {
    const calls = handlers();
    render(<ReviewBar count={3} index={1} {...calls} />);

    fireEvent.click(screen.getByRole("button", { name: enNotes.review.rejectAll }));
    fireEvent.click(screen.getByRole("button", { name: enNotes.review.acceptAll }));
    fireEvent.click(screen.getByRole("button", { name: enEditor.diff.previousChange }));
    fireEvent.click(screen.getByRole("button", { name: enEditor.diff.nextChange }));
    fireEvent.click(screen.getByRole("button", { name: enEditor.inlineAi.accept }));
    fireEvent.click(screen.getByRole("button", { name: enEditor.inlineAi.reject }));

    expect(calls.onRejectAll).toHaveBeenCalledOnce();
    expect(calls.onAcceptAll).toHaveBeenCalledOnce();
    expect(calls.onPrevious).toHaveBeenCalledOnce();
    expect(calls.onNext).toHaveBeenCalledOnce();
    expect(calls.onAccept).toHaveBeenCalledOnce();
    expect(calls.onReject).toHaveBeenCalledOnce();
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
    expect(
      screen.getByText(enNotes.review.position.replace("{{current}}", "2").replace("{{total}}", "3")),
    ).toBeInTheDocument();
  });

  it("shows only accept and reject for a single change", () => {
    const calls = handlers();
    render(<ReviewBar count={1} index={0} {...calls} />);

    expect(screen.queryByRole("button", { name: enNotes.review.acceptAll })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: enNotes.review.rejectAll })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: enEditor.diff.nextChange })).not.toBeInTheDocument();
    expect(screen.queryByText("1 / 1")).not.toBeInTheDocument();
    const accept = screen.getByRole("button", { name: enEditor.inlineAi.accept });
    expect(accept).toHaveAttribute("aria-keyshortcuts", "Control+Enter Meta+Enter");
    fireEvent.click(accept);
    expect(calls.onAccept).toHaveBeenCalledOnce();
  });

  it("offers only Undo once every change is settled and Undo is still possible", () => {
    const calls = handlers();
    const onUndo = vi.fn();
    render(<ReviewBar count={0} index={-1} {...calls} onUndo={onUndo} />);
    expect(screen.queryByRole("button", { name: enEditor.inlineAi.accept })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: enEditor.inlineAi.reject })).not.toBeInTheDocument();
    const undo = screen.getByRole("button", { name: enNotes.review.undo });
    expect(undo).toHaveAttribute("aria-keyshortcuts", "Meta+Z Control+Z");
    fireEvent.click(undo);
    expect(onUndo).toHaveBeenCalledOnce();
  });

  it("offers Undo next to the changes still waiting", () => {
    render(<ReviewBar count={2} index={0} {...handlers()} onUndo={vi.fn()} />);
    expect(screen.getByRole("button", { name: enNotes.review.undo })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: enNotes.review.rejectAll })).toBeInTheDocument();
  });

  it("has no Undo when there is nothing to bring back", () => {
    render(<ReviewBar count={2} index={0} {...handlers()} />);
    expect(screen.queryByRole("button", { name: enNotes.review.undo })).not.toBeInTheDocument();
  });
});
