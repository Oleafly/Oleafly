// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { loadNamespace } from "@/i18n";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { NoteSaveStatus } from "./NoteSaveStatus";

const copy = enNotes.saveStatus;

beforeAll(async () => {
  await loadNamespace("notes");
});

describe("NoteSaveStatus", () => {
  it("shows saving and saved quietly, without announcing every autosave", () => {
    const { rerender } = render(<NoteSaveStatus status="saving" failure={null} />);
    expect(screen.getByText(copy.saving)).not.toHaveAttribute("aria-live");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    rerender(<NoteSaveStatus status="saved" failure={null} />);
    expect(screen.getByText(copy.saved)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says why a save failed and retries it", () => {
    const retry = vi.fn();
    render(<NoteSaveStatus status="failed" failure={{ error: new Error("The disk is full."), retry }} />);
    expect(screen.getByRole("alert")).toHaveTextContent(copy.failedWithReason.replace("{{reason}}", "The disk is full."));
    fireEvent.click(screen.getByRole("button", { name: copy.retry }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("says the note is not saved when no reason came with the failure", () => {
    render(<NoteSaveStatus status="failed" failure={null} />);
    expect(screen.getByRole("alert")).toHaveTextContent(copy.failed);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
