import { beforeEach, describe, expect, it, vi } from "vitest";

const target = vi.fn();
vi.mock("@/features/citation", () => ({ bibliographyTargetForProject: () => target() }));
vi.mock("@/lib/tauri", () => ({ appVersion: async () => "0.4.0" }));
const toasts = { success: vi.fn(), info: vi.fn(), error: vi.fn() };
vi.mock("@/lib/toast", () => ({
  toast: {
    success: (...args: unknown[]) => toasts.success(...args),
    info: (...args: unknown[]) => toasts.info(...args),
    error: (...args: unknown[]) => toasts.error(...args),
  },
  notifyError: vi.fn(),
}));

import { citeOleafly, runCiteOleaflyAction } from "./cite-oleafly";
import { oleaflyBibtex } from "@/lib/cite-oleafly";
import { useCiteOleaflyStore } from "@/store/cite-oleafly";
import { useFilesStore } from "@/store/files";

const writeProjectFile = vi.fn(async () => {});
const setContent = vi.fn((_path: string, _content: string) => true);
const saveFile = vi.fn(async () => {});

beforeEach(() => {
  vi.clearAllMocks();
  useCiteOleaflyStore.setState({ open: false });
  useFilesStore.setState({
    projectId: "paper",
    files: {},
    tree: [],
    writeProjectFile,
    setContent,
    saveFile,
  } as never);
});

describe("citeOleafly", () => {
  it("appends the entry to the project's bibliography and can undo", async () => {
    target.mockResolvedValue({ path: "refs.bib", exists: true, content: "@book{k, title={T}}\n" });
    const outcome = await citeOleafly();
    expect(outcome.kind).toBe("added");
    expect(writeProjectFile).toHaveBeenCalledWith(
      "paper",
      "refs.bib",
      `@book{k, title={T}}\n\n${oleaflyBibtex("0.4.0")}\n`,
    );
    if (outcome.kind !== "added") throw new Error("unreachable");
    await outcome.undo();
    expect(writeProjectFile).toHaveBeenLastCalledWith("paper", "refs.bib", "@book{k, title={T}}\n");
  });

  it("reports an entry that is already there", async () => {
    target.mockResolvedValue({ path: "refs.bib", exists: true, content: "@software{oleafly,\n title={x}}" });
    expect((await citeOleafly()).kind).toBe("present");
    expect(writeProjectFile).not.toHaveBeenCalled();
  });

  it("does not invent a bibliography when the project has none", async () => {
    target.mockResolvedValue({ path: "references.bib", exists: false, content: "" });
    expect((await citeOleafly()).kind).toBe("no-bibliography");
    expect(writeProjectFile).not.toHaveBeenCalled();
  });

  it("edits the open buffer of the file the caller names and saves it", async () => {
    useFilesStore.setState({ files: { "extra.bib": { content: "" } } } as never);
    const outcome = await citeOleafly({ path: "extra.bib" });
    expect(outcome.kind).toBe("added");
    expect(setContent).toHaveBeenCalledWith("extra.bib", `${oleaflyBibtex("0.4.0")}\n`);
    expect(saveFile).toHaveBeenCalledWith("extra.bib");
    expect(writeProjectFile).not.toHaveBeenCalled();
    if (outcome.kind !== "added") throw new Error("unreachable");
    await outcome.undo();
    expect(setContent).toHaveBeenLastCalledWith("extra.bib", "");
    expect(saveFile).toHaveBeenCalledTimes(2);
  });
});

describe("citeOleafly and a bibliography linked from outside the folder", () => {
  const LINKED_TREE = [{ path: "refs.bib", is_dir: false, read_only: true }];

  it("leaves the project's linked bibliography alone", async () => {
    target.mockResolvedValue({ path: "refs.bib", exists: true, content: "", readOnly: true });
    expect(await citeOleafly()).toEqual({ kind: "read-only", path: "refs.bib" });
    expect(writeProjectFile).not.toHaveBeenCalled();
    expect(setContent).not.toHaveBeenCalled();
  });

  it("leaves the open linked bibliography the toolbar names alone", async () => {
    useFilesStore.setState({ files: { "refs.bib": { content: "" } }, tree: LINKED_TREE } as never);
    expect(await citeOleafly({ path: "refs.bib" })).toEqual({ kind: "read-only", path: "refs.bib" });
    expect(setContent).not.toHaveBeenCalled();
    expect(saveFile).not.toHaveBeenCalled();
  });

  it("still reports an entry the linked bibliography already has", async () => {
    target.mockResolvedValue({
      path: "refs.bib",
      exists: true,
      content: "@software{oleafly,\n title={x}}",
      readOnly: true,
    });
    expect((await citeOleafly()).kind).toBe("present");
  });

  it("says where to add the entry instead", async () => {
    target.mockResolvedValue({ path: "refs.bib", exists: true, content: "", readOnly: true });
    await runCiteOleaflyAction();
    expect(toasts.error).toHaveBeenCalledWith(expect.stringContaining("Zotero"));
    expect(toasts.success).not.toHaveBeenCalled();
    expect(useCiteOleaflyStore.getState().open).toBe(false);
  });
});

describe("runCiteOleaflyAction", () => {
  it("toasts the cite key after adding and opens the dialog when nothing can be written", async () => {
    target.mockResolvedValue({ path: "refs.bib", exists: true, content: "" });
    await runCiteOleaflyAction();
    expect(toasts.success).toHaveBeenCalledWith(
      expect.stringContaining("\\cite{oleafly}"),
      expect.objectContaining({ label: "Undo" }),
    );
    expect(useCiteOleaflyStore.getState().open).toBe(false);

    target.mockResolvedValue({ path: "references.bib", exists: false, content: "" });
    await runCiteOleaflyAction();
    expect(useCiteOleaflyStore.getState().open).toBe(true);
  });

  it("ignores a second run while the first one is still writing", async () => {
    target.mockResolvedValue({ path: "refs.bib", exists: true, content: "" });
    let finishWrite = () => {};
    writeProjectFile.mockImplementationOnce(
      () => new Promise<void>((resolve) => { finishWrite = resolve; }),
    );
    const first = runCiteOleaflyAction();
    const second = runCiteOleaflyAction();
    expect(second).toBe(first);
    await vi.waitFor(() => expect(writeProjectFile).toHaveBeenCalledTimes(1));
    finishWrite();
    await Promise.all([first, second]);
    expect(target).toHaveBeenCalledTimes(1);
    expect(toasts.success).toHaveBeenCalledTimes(1);

    await runCiteOleaflyAction();
    expect(target).toHaveBeenCalledTimes(2);
  });
});
