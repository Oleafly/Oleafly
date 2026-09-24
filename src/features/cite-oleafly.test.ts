import { beforeEach, describe, expect, it, vi } from "vitest";

const target = vi.fn();
vi.mock("@/features/citation", () => ({ bibliographyTargetForProject: () => target() }));
vi.mock("@/lib/tauri", () => ({ appVersion: async () => "0.4.0" }));
const toasts = { success: vi.fn(), info: vi.fn() };
vi.mock("@/lib/toast", () => ({
  toast: { success: (...args: unknown[]) => toasts.success(...args), info: (...args: unknown[]) => toasts.info(...args) },
  notifyError: vi.fn(),
}));

import { citeOleafly, runCiteOleaflyAction } from "./cite-oleafly";
import { oleaflyBibtex } from "@/lib/cite-oleafly";
import { useCiteOleaflyStore } from "@/store/cite-oleafly";
import { useFilesStore } from "@/store/files";

const writeProjectFile = vi.fn(async () => {});
const setContent = vi.fn();
const saveFile = vi.fn(async () => {});

beforeEach(() => {
  vi.clearAllMocks();
  useCiteOleaflyStore.setState({ open: false });
  useFilesStore.setState({
    projectId: "paper",
    files: {},
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
