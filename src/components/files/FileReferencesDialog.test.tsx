// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enWorkspace from "@/i18n/locales/en/workspace.json" with { type: "json" };
import { useFileReferencesStore } from "@/store/file-references";

const mocks = vi.hoisted(() => ({
  answer: vi.fn(async () => {}),
  stop: vi.fn(),
  start: vi.fn(),
}));

vi.mock("@/lib/file-references/follow-rename", () => ({
  answerReferenceUpdate: mocks.answer,
  startFileReferenceUpdates: mocks.start,
}));

import { FileReferencesDialog } from "./FileReferencesDialog";

const copy = enWorkspace.fileReferences;

function queueUpdate() {
  useFileReferencesStore.getState().enqueue({
    projectId: "p1",
    from: "figures/plot.png",
    to: "images/plot.png",
    plan: {
      references: 3,
      files: [
        { path: "main.tex", text: "", edits: [], references: 2 },
        { path: "notes/readme.md", text: "", edits: [], references: 1 },
      ],
    },
  });
}

beforeEach(() => {
  mocks.start.mockReturnValue(mocks.stop);
  useFileReferencesStore.getState().clear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("FileReferencesDialog", () => {
  it("stays hidden while no move has references, and follows renames while mounted", () => {
    const { unmount } = render(<FileReferencesDialog />);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(mocks.start).toHaveBeenCalledTimes(1);
    unmount();
    expect(mocks.stop).toHaveBeenCalledTimes(1);
  });

  it("lists every file with its reference count", () => {
    queueUpdate();
    render(<FileReferencesDialog />);
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent(copy.title.replace("{{name}}", "plot.png"));
    expect(dialog).toHaveTextContent("3 references in 2 files still use the old path, figures/plot.png.");
    expect(screen.getByText("main.tex")).toBeInTheDocument();
    expect(screen.getByText("notes/readme.md")).toBeInTheDocument();
    expect(screen.getByText("2 references")).toBeInTheDocument();
    expect(screen.getByText("1 reference")).toBeInTheDocument();
  });

  it("updates references on request", async () => {
    queueUpdate();
    render(<FileReferencesDialog />);
    await userEvent.click(screen.getByRole("button", { name: copy.update }));
    expect(mocks.answer).toHaveBeenCalledWith(true, false);
  });

  it("passes the don't ask again choice along with the answer", async () => {
    queueUpdate();
    render(<FileReferencesDialog />);
    await userEvent.click(screen.getByRole("checkbox", { name: copy.dontAsk }));
    await userEvent.click(screen.getByRole("button", { name: copy.skip }));
    expect(mocks.answer).toHaveBeenCalledWith(false, true);
  });

  it("treats Escape as don't update", async () => {
    queueUpdate();
    render(<FileReferencesDialog />);
    await userEvent.keyboard("{Escape}");
    expect(mocks.answer).toHaveBeenCalledWith(false, false);
  });

  it("disables the answers while edits are applied", () => {
    queueUpdate();
    useFileReferencesStore.getState().startApplying();
    render(<FileReferencesDialog />);
    expect(screen.getByRole("button", { name: copy.update })).toBeDisabled();
    expect(screen.getByRole("button", { name: copy.skip })).toBeDisabled();
  });

  it("names the files it could not update and closes on request", async () => {
    queueUpdate();
    useFileReferencesStore.getState().fail(["notes/readme.md"]);
    render(<FileReferencesDialog />);
    expect(screen.getByRole("alertdialog")).toHaveTextContent(copy.failed_one.replace("{{count}}", "1"));
    expect(screen.getByText("notes/readme.md")).toBeInTheDocument();
    expect(screen.queryByText("main.tex")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: enCommon.actions.close }));
    expect(useFileReferencesStore.getState().queue).toEqual([]);
  });
});
