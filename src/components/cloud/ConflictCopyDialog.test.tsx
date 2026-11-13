// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadNamespace } from "@/i18n";
import enCloud from "@/i18n/locales/en/cloud.json" with { type: "json" };

const files = vi.hoisted(() => ({
  disk: new Map<string, string>(),
  existing: vi.fn(async (_projectId: string, paths: string[]) => paths.filter((path) => files.disk.has(path))),
  read: vi.fn(async (_projectId: string, path: string) => {
    const text = files.disk.get(path);
    if (text === undefined) throw new Error("missing");
    return text;
  }),
  write: vi.fn(async (_projectId: string, path: string, text: string) => {
    files.disk.set(path, text);
    return { generation: 1 };
  }),
  remove: vi.fn(async (_projectId: string, path: string) => {
    files.disk.delete(path);
    return { generation: 1 };
  }),
}));
const dismiss = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  existingProjectFiles: files.existing,
  readFileContent: files.read,
  deleteFile: files.remove,
}));
vi.mock("@/components/editor/diff/InlineDiffPreview", () => ({
  InlineDiffPreview: ({ oldText, newText, ariaLabel }: Readonly<{ oldText: string; newText: string; ariaLabel?: string }>) => (
    <section aria-label={ariaLabel} data-old={oldText} data-new={newText} />
  ),
}));

import { useCloudStore } from "@/store/cloud";
import { useFilesStore } from "@/store/files";
import { useToastStore } from "@/store/toast";
import { diskHash } from "@/lib/disk-hash";
import { noteWrittenHere, resetNoteWritesForTest } from "@/components/notes/notes-service";
import ConflictCopyDialog, { type ConflictCopy } from "./ConflictCopyDialog";

const copy = enCloud.conflictCopy;
const COPY = "note (Laptop 2026-11-08).md";
const NO_TRASH = `@oleafly/error:${JSON.stringify({ code: "project.trash_unavailable", params: { path: COPY } })}`;
const conflict: ConflictCopy = { projectId: "lib-1", title: "Masking", mainDoc: "note.md", copies: [COPY, "gone (Laptop).md"] };

function renderDialog(value: ConflictCopy = conflict) {
  const onClose = vi.fn();
  render(<ConflictCopyDialog conflict={value} onClose={onClose} />);
  return onClose;
}

async function diff(): Promise<HTMLElement> {
  return screen.findByRole("region", { name: copy.diffLabel });
}

beforeAll(async () => {
  await loadNamespace("cloud");
  await loadNamespace("common");
});

beforeEach(() => {
  files.disk = new Map([
    ["note.md", "mine"],
    [COPY, "theirs"],
  ]);
  useCloudStore.setState({ dismissConflicts: dismiss });
  useFilesStore.setState({ writeProjectFile: files.write as never });
  useToastStore.setState({ toasts: [] });
  resetNoteWritesForTest();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ConflictCopyDialog", () => {
  it("shows this computer's note beside the other computer's copy", async () => {
    renderDialog();
    expect(screen.getByRole("dialog", { name: copy.title.replace("{{name}}", "Masking") })).toBeInTheDocument();
    const view = await diff();
    expect(view.dataset.old).toBe("mine");
    expect(view.dataset.new).toBe("theirs");
    expect(screen.getByText(COPY)).toBeInTheDocument();
    expect(files.existing).toHaveBeenCalledWith("lib-1", [COPY, "gone (Laptop).md"]);
  });

  it("keeps this computer's version and sends the copy to this computer's trash", async () => {
    const onClose = renderDialog();
    await diff();
    fireEvent.click(screen.getByRole("button", { name: copy.keepMine }));
    await waitFor(() => expect(files.remove).toHaveBeenCalledWith("lib-1", COPY, undefined, false));
    expect(files.write).not.toHaveBeenCalled();
    expect(files.disk.get("note.md")).toBe("mine");
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(dismiss).toHaveBeenCalledWith("lib-1");
  });

  it("uses the other computer's version as the app's own write, only over the version it showed, and keeps this one recoverable", async () => {
    renderDialog();
    await diff();
    fireEvent.click(screen.getByRole("button", { name: copy.useCopy }));
    await waitFor(() => expect(files.remove).toHaveBeenCalledWith("lib-1", COPY, undefined, false));
    expect(files.disk.get("note.md")).toBe("theirs");
    expect(files.write).toHaveBeenNthCalledWith(1, "lib-1", "note.md", "theirs", {
      closedProject: true,
      crlf: false,
      expectedHash: diskHash("mine"),
    });
    expect(files.write).toHaveBeenNthCalledWith(2, "lib-1", COPY, "mine", { closedProject: true, crlf: false });
    expect(noteWrittenHere("lib-1", "theirs")).toBe(true);
  });

  it("changes nothing when the note was saved again while the dialog was open", async () => {
    files.write.mockRejectedValueOnce(new Error("The file changed on disk."));
    const onClose = renderDialog();
    await diff();
    fireEvent.click(screen.getByRole("button", { name: copy.useCopy }));
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual([copy.resolveFailed]),
    );
    expect(files.write).toHaveBeenCalledOnce();
    expect(files.remove).not.toHaveBeenCalled();
    expect(files.disk.get(COPY)).toBe("theirs");
    expect(noteWrittenHere("lib-1", "theirs")).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("moves on to the next copy before it closes", async () => {
    files.disk.set("second.md", "later");
    const onClose = renderDialog({ ...conflict, copies: [COPY, "second.md"] });
    await diff();
    fireEvent.click(screen.getByRole("button", { name: copy.keepMine }));
    await waitFor(() => expect(screen.getByText("second.md")).toBeInTheDocument());
    expect((await diff()).dataset.new).toBe("later");
    expect(onClose).not.toHaveBeenCalled();
    expect(dismiss).not.toHaveBeenCalled();
  });

  it("clears the notice and closes when every copy is already gone", async () => {
    files.disk.delete(COPY);
    const onClose = renderDialog();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(dismiss).toHaveBeenCalledWith("lib-1");
  });

  it("says when the copy can't be read and offers nothing to keep", async () => {
    files.read.mockRejectedValueOnce(new Error("locked"));
    renderDialog();
    expect(await screen.findByText(copy.readFailed)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: copy.keepMine })).toBeDisabled();
    expect(screen.getByRole("button", { name: copy.useCopy })).toBeDisabled();
  });

  it("tells you when keeping a version fails", async () => {
    files.remove.mockRejectedValueOnce(new Error("busy"));
    const onClose = renderDialog();
    await diff();
    fireEvent.click(screen.getByRole("button", { name: copy.keepMine }));
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual([copy.resolveFailed]),
    );
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(within(screen.getByRole("dialog")).getByRole("button", { name: copy.keepMine })).toBeEnabled(),
    );
  });

  it("asks before deleting the copy for good when this computer has no trash", async () => {
    files.remove.mockRejectedValueOnce(NO_TRASH);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const onClose = renderDialog();
    await diff();
    fireEvent.click(screen.getByRole("button", { name: copy.keepMine }));
    await waitFor(() => expect(files.remove).toHaveBeenCalledTimes(2));
    expect(files.remove).toHaveBeenNthCalledWith(1, "lib-1", COPY, undefined, false);
    expect(files.remove).toHaveBeenNthCalledWith(2, "lib-1", COPY, undefined, true);
    expect(confirm).toHaveBeenCalledOnce();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    confirm.mockRestore();
  });

  it("keeps the copy when you won't delete it for good", async () => {
    files.remove.mockRejectedValueOnce(NO_TRASH);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const onClose = renderDialog();
    await diff();
    fireEvent.click(screen.getByRole("button", { name: copy.keepMine }));
    await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    expect(files.remove).toHaveBeenCalledOnce();
    expect(files.disk.get(COPY)).toBe("theirs");
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: copy.keepMine })).toBeEnabled());
    confirm.mockRestore();
  });

  it("shows what is on disk after the other version was kept but the copy couldn't be moved", async () => {
    files.remove.mockRejectedValueOnce(new Error("busy"));
    renderDialog();
    await diff();
    fireEvent.click(screen.getByRole("button", { name: copy.useCopy }));
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual([copy.resolveFailed]),
    );
    await waitFor(() => {
      const view = screen.getByRole("region", { name: copy.diffLabel });
      expect(view.dataset.old).toBe("theirs");
      expect(view.dataset.new).toBe("mine");
    });
    await waitFor(() => expect(screen.getByRole("button", { name: copy.keepMine })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: copy.keepMine }));
    await waitFor(() => expect(files.remove).toHaveBeenCalledTimes(2));
    expect(files.write).toHaveBeenCalledTimes(2);
    expect(files.disk.get("note.md")).toBe("theirs");
    expect(files.disk.has(COPY)).toBe(false);
  });
});
