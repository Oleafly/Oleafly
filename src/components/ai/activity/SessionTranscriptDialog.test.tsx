// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enAi from "@/i18n/locales/en/ai.json" with { type: "json" };

const mocks = vi.hoisted(() => ({ read: vi.fn() }));

vi.mock("@/lib/agent-backend", () => ({
  agentThreadRead: (id: string) => mocks.read(id),
}));

import { SessionTranscriptDialog } from "./SessionTranscriptDialog";

const copy = enAi.transcript;

beforeAll(async () => {
  await import("@/components/ui/markdown-renderer");
});

beforeEach(() => {
  mocks.read.mockReset();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("SessionTranscriptDialog", () => {
  it("stays closed and reads nothing without a thread", () => {
    render(<SessionTranscriptDialog threadId={null} onClose={vi.fn()} />);

    expect(screen.queryByTestId("session-transcript-dialog")).toBeNull();
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("loads the delegated thread and shows its messages", async () => {
    const pending = deferred<unknown[]>();
    mocks.read.mockReturnValue(pending.promise);
    render(<SessionTranscriptDialog threadId="thread-1" onClose={vi.fn()} />);

    expect(screen.getByText(copy.dialogTitle)).toBeInTheDocument();
    expect(screen.getByText(copy.loading)).toBeInTheDocument();
    pending.resolve([
      {
        turnId: "t1",
        clientTurnId: null,
        status: "completed",
        usage: { input: 0, output: 0 },
        error: null,
        stoppedAtCap: false,
        items: [
          { id: "u", item: { type: "userMessage", text: "Check the proofs" }, completed: true },
          { id: "a", item: { type: "agentMessage", text: "The proofs hold." }, completed: true },
        ],
      },
    ]);

    expect(await screen.findByText("The proofs hold.")).toBeInTheDocument();
    expect(screen.getByText("Check the proofs")).toBeInTheDocument();
    expect(mocks.read).toHaveBeenCalledWith("thread-1");
  });

  it("says when the thread recorded nothing", async () => {
    mocks.read.mockResolvedValue([]);
    render(<SessionTranscriptDialog threadId="thread-2" onClose={vi.fn()} />);

    expect(await screen.findByText(copy.empty)).toBeInTheDocument();
  });

  it("says when the thread cannot be read", async () => {
    mocks.read.mockRejectedValue(new Error("missing"));
    render(<SessionTranscriptDialog threadId="thread-3" onClose={vi.fn()} />);

    expect(await screen.findByText(copy.failed)).toBeInTheDocument();
  });

  it("drops a read that finishes after the dialog moved on", async () => {
    const first = deferred<unknown[]>();
    const second = deferred<unknown[]>();
    mocks.read.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const view = render(<SessionTranscriptDialog threadId="thread-a" onClose={vi.fn()} />);
    view.rerender(<SessionTranscriptDialog threadId="thread-b" onClose={vi.fn()} />);

    first.reject(new Error("late"));
    second.resolve([]);

    expect(await screen.findByText(copy.empty)).toBeInTheDocument();
    expect(screen.queryByText(copy.failed)).toBeNull();
  });

  it("drops a successful read for a thread that is no longer shown", async () => {
    const first = deferred<unknown[]>();
    mocks.read.mockReturnValueOnce(first.promise).mockReturnValueOnce(new Promise(() => {}));
    const view = render(<SessionTranscriptDialog threadId="thread-a" onClose={vi.fn()} />);
    view.rerender(<SessionTranscriptDialog threadId="thread-b" onClose={vi.fn()} />);

    first.resolve([]);

    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2));
    await Promise.resolve();
    expect(screen.queryByText(copy.empty)).toBeNull();
    expect(screen.getByText(copy.loading)).toBeInTheDocument();
  });

  it("closes from the dialog's own controls", async () => {
    mocks.read.mockResolvedValue([]);
    const onClose = vi.fn();
    render(<SessionTranscriptDialog threadId="thread-4" onClose={onClose} />);
    await screen.findByText(copy.empty);

    fireEvent.keyDown(screen.getByTestId("session-transcript-dialog"), { key: "Escape" });

    expect(onClose).toHaveBeenCalledOnce();
  });
});
