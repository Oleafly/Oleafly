// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { NoteSaveFailed, NoteSaveStatus } from "./NoteSaveStatus";
import "./tests/setup";

const copy = enNotes.saveStatus;

describe("NoteSaveStatus", () => {
  it("shows saving and saved quietly, and leaves a failed save to the banner", () => {
    const { rerender, container } = render(<NoteSaveStatus status="saving" />);
    expect(screen.getByText(copy.saving)).not.toHaveAttribute("aria-live");
    rerender(<NoteSaveStatus status="saved" />);
    expect(screen.getByText(copy.saved)).toBeInTheDocument();
    rerender(<NoteSaveStatus status="failed" />);
    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    [new Error("The disk is full."), copy.failedWithReason.replace("{{reason}}", "The disk is full.")],
    [null, copy.failed],
  ])("warns that the note is not saved, retries and dismisses", (error, text) => {
    const retry = vi.fn();
    const dismiss = vi.fn();
    render(<NoteSaveFailed failure={{ error, retry }} onDismiss={dismiss} />);
    expect(screen.getByRole("alert")).toHaveTextContent(text);
    fireEvent.click(screen.getByRole("button", { name: copy.retry }));
    fireEvent.click(screen.getByRole("button", { name: enCommon.actions.close }));
    expect(retry).toHaveBeenCalledOnce();
    expect(dismiss).toHaveBeenCalledOnce();
  });
});
