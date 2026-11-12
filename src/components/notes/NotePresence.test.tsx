// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "./tests/setup";

const mocks = vi.hoisted(() => ({ makeLive: vi.fn() }));

vi.mock("./use-note-live", () => ({ makeNoteLive: mocks.makeLive }));
vi.mock("@/components/collab/CollabSlots", () => ({
  NoteLiveSlot: ({ noteId, live }: { noteId: string; live: boolean }) => <span>{`live panel ${noteId} ${live}`}</span>,
}));

import { useShareDialog } from "@/components/collab/share-dialog";
import { NoteLiveHeader } from "./NotePresence";
import { NoteShareButton, SharedMark, shareNote } from "./NoteShareButton";

const NOTE = "note-1";

beforeEach(() => {
  vi.clearAllMocks();
  useShareDialog.setState({ projectId: null });
});

describe("note sharing controls", () => {
  it("opens the share dialog for the note", () => {
    render(<NoteShareButton onShare={() => shareNote(NOTE)} />);
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    expect(useShareDialog.getState().projectId).toBe(NOTE);
  });

  it("marks shared notes with a labelled icon", () => {
    render(<SharedMark />);
    expect(screen.getByRole("img", { name: "Shared" })).toBeInTheDocument();
  });

  it("offers to move live editing here when another note has it", () => {
    render(<NoteLiveHeader noteId={NOTE} mode="elsewhere" />);
    expect(screen.getByText("Live editing is on in another note")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit live here" }));
    expect(mocks.makeLive).toHaveBeenCalledWith(NOTE);
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
  });

  it("shows the live panel while connecting or live and the share button when sharing is possible", () => {
    const share = vi.fn();
    const { rerender } = render(<NoteLiveHeader noteId={NOTE} mode="connecting" onShare={share} />);
    expect(screen.getByText("live panel note-1 false")).toBeInTheDocument();
    rerender(<NoteLiveHeader noteId={NOTE} mode="live" onShare={share} />);
    expect(screen.getByText("live panel note-1 true")).toBeInTheDocument();
    rerender(<NoteLiveHeader noteId={NOTE} mode="local" onShare={share} />);
    expect(screen.queryByText(/live panel/u)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    expect(share).toHaveBeenCalledTimes(1);
  });
});
