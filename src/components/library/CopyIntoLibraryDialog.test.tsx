// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/lib/tauri", () => ({
  copyLinkedIntoLibrary: vi.fn(),
  cancelCopyIntoLibrary: vi.fn(async () => true),
}));
vi.mock("@/store/files", () => ({
  useFilesStore: { getState: () => ({ refreshProjects: vi.fn(), openProject: vi.fn() }) },
}));

import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enLibrary from "@/i18n/locales/en/library.json" with { type: "json" };
import { CopyIntoLibraryDialog } from "./CopyIntoLibraryDialog";
import { useCopyIntoLibraryStore } from "@/store/copy-into-library";

const cancel = vi.fn();
const close = vi.fn();

function show(state: Partial<ReturnType<typeof useCopyIntoLibraryStore.getState>>) {
  useCopyIntoLibraryStore.setState({
    target: { projectId: "linked-thesis", name: "Thesis" },
    status: "running",
    progress: null,
    error: null,
    operationId: "op-1",
    cancel,
    close,
    ...state,
  });
  return render(<CopyIntoLibraryDialog />);
}

function progressBar(name: string) {
  const bar = screen.getByRole("progressbar", { name });
  expect(bar.tagName).toBe("PROGRESS");
  expect(bar).toHaveAttribute("max", "100");
  return bar;
}

function visibleFill() {
  const track = document.querySelector(".h-1\\.5.rounded-full.bg-muted");
  expect(track).toHaveAttribute("aria-hidden", "true");
  return track?.firstElementChild as HTMLElement;
}

beforeEach(() => {
  cancel.mockReset();
  close.mockReset();
  useCopyIntoLibraryStore.setState({ target: null, status: "idle", progress: null, error: null });
});

describe("CopyIntoLibraryDialog", () => {
  it("stays out of the way when nothing is being copied", () => {
    const { container } = render(<CopyIntoLibraryDialog />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows an open-ended bar while it counts, then real progress", () => {
    const view = show({});
    expect(
      screen.getByRole("heading", {
        name: enLibrary.folder.copy.title.replace("{{name}}", "Thesis"),
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(enLibrary.folder.copy.counting)).toBeInTheDocument();
    expect(progressBar(enLibrary.folder.copy.counting)).not.toHaveAttribute("value");
    expect(visibleFill()).toHaveClass("w-1/3", "animate-pulse");
    expect(visibleFill().style.width).toBe("");

    useCopyIntoLibraryStore.setState({
      progress: {
        phase: "copying",
        entriesDone: 12,
        entriesTotal: 40,
        bytesDone: 1536,
        bytesTotal: 4096,
      },
    });
    view.rerender(<CopyIntoLibraryDialog />);

    expect(screen.getByText(enLibrary.folder.copy.copying)).toBeInTheDocument();
    expect(screen.getByText("1.5 KB of 4 KB")).toBeInTheDocument();
    expect(progressBar(enLibrary.folder.copy.copying)).toHaveAttribute("value", "38");
    expect(visibleFill()).not.toHaveClass("animate-pulse");
    expect(visibleFill().style.width).toBe("38%");
  });

  it("moves the bar through one large file and counts items when there are no bytes", () => {
    const view = show({
      progress: {
        phase: "copying",
        entriesDone: 0,
        entriesTotal: 2,
        bytesDone: 3 * 1024 * 1024,
        bytesTotal: 4 * 1024 * 1024,
      },
    });
    expect(screen.getByText("3 MB of 4 MB")).toBeInTheDocument();
    expect(progressBar(enLibrary.folder.copy.copying)).toHaveAttribute("value", "75");

    useCopyIntoLibraryStore.setState({
      progress: { phase: "copying", entriesDone: 3, entriesTotal: 4, bytesDone: 0, bytesTotal: 0 },
    });
    view.rerender(<CopyIntoLibraryDialog />);
    expect(screen.getByText("3 of 4")).toBeInTheDocument();
    expect(progressBar(enLibrary.folder.copy.copying)).toHaveAttribute("value", "75");
    expect(visibleFill().style.width).toBe("75%");
  });

  it("cancels from the button and from Escape", () => {
    show({});
    fireEvent.click(screen.getByRole("button", { name: new RegExp(enCommon.actions.cancel) }));
    expect(cancel).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it("disables cancel while the copy is stopping", () => {
    show({ status: "cancelling" });
    expect(screen.getByRole("button", { name: new RegExp(enCommon.actions.cancel) })).toBeDisabled();
  });

  it("explains a failure and closes on request", () => {
    show({ status: "failed", error: "This folder is too big." });
    expect(screen.getByRole("alert")).toHaveTextContent("This folder is too big.");
    expect(screen.queryByRole("progressbar")).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: enCommon.actions.close })[0]);
    expect(close).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
  });
});
