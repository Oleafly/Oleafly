import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const target = vi.fn();
vi.mock("@/features/citation", () => ({
  bibliographyTargetForProject: (...args: unknown[]) => target(...args),
}));
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
import { hayagrivaEntries, hayagrivaKeys } from "@/lib/citation/hayagriva";
import { useCiteOleaflyStore } from "@/store/cite-oleafly";
import { useFilesStore } from "@/store/files";
import { useFolderAccessStore } from "@/store/folder-access";
import { notifyError } from "@/lib/toast";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };

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

function typstProject() {
  useFilesStore.setState({
    engine: {
      ...useFilesStore.getState().engine,
      id: "typst",
      capabilities: { ...useFilesStore.getState().engine.capabilities, formatting_profile: "typst" },
    },
  });
}

function latexProject() {
  useFilesStore.setState({
    engine: {
      ...useFilesStore.getState().engine,
      id: "latex",
      capabilities: { ...useFilesStore.getState().engine.capabilities, formatting_profile: "latex" },
    },
  });
}

describe("citeOleafly with a Hayagriva bibliography", () => {
  afterEach(() => latexProject());

  it("asks for a Hayagriva target in a Typst project and writes a Hayagriva entry", async () => {
    typstProject();
    const content = "knuth1984:\n  type: book\n  title: The TeXbook\n";
    target.mockResolvedValue({ path: "refs.yml", exists: true, content });
    const outcome = await citeOleafly();
    expect(target).toHaveBeenCalledWith({ acceptHayagriva: true });
    expect(outcome.kind).toBe("added");
    const expected = `${content}
oleafly:
  type: repository
  title: "Oleafly: a local-first desktop workspace for research writing"
  author:
    - "Venkateshmurthy, Prajwal S."
    - name: "The Oleafly contributors"
  date: 2026
  url: "https://github.com/Oleafly/Oleafly"
  note: "Version 0.4.0"
`;
    expect(writeProjectFile).toHaveBeenCalledWith("paper", "refs.yml", expected);
    expect(hayagrivaKeys(expected)).toEqual(new Set(["knuth1984", "oleafly"]));
    expect(hayagrivaEntries(expected).find((entry) => entry.key === "oleafly")?.title?.value).toBe(
      "Oleafly: a local-first desktop workspace for research writing",
    );
    if (outcome.kind !== "added") throw new Error("unreachable");
    await outcome.undo();
    expect(writeProjectFile).toHaveBeenLastCalledWith("paper", "refs.yml", content);
  });

  it("recognizes an Oleafly entry that is already in the Hayagriva file", async () => {
    typstProject();
    target.mockResolvedValue({
      path: "refs.yaml",
      exists: true,
      content: "oleafly:\n  type: software\n  title: Oleafly\n",
    });
    expect((await citeOleafly()).kind).toBe("present");
    expect(writeProjectFile).not.toHaveBeenCalled();
  });

  it("keeps LaTeX projects on BibTeX targets", async () => {
    latexProject();
    target.mockResolvedValue({ path: "refs.bib", exists: true, content: "" });
    await citeOleafly();
    expect(target).toHaveBeenCalledWith({ acceptHayagriva: false });
  });
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

describe("citeOleafly in a read-only folder", () => {
  beforeEach(() => {
    useFolderAccessStore.setState({
      projectId: "paper",
      status: { read_only: true, synced_with: null },
    });
  });

  afterEach(() => {
    useFolderAccessStore.getState().reset(null);
  });

  it("leaves the bibliography alone and says the folder is read-only", async () => {
    target.mockResolvedValue({ path: "refs.bib", exists: true, content: "" });
    expect(await citeOleafly()).toEqual({ kind: "read-only-folder" });
    await runCiteOleaflyAction();
    expect(toasts.error).toHaveBeenCalledWith(enShell.openedFolder.readOnly.banner);
    expect(writeProjectFile).not.toHaveBeenCalled();
    expect(setContent).not.toHaveBeenCalled();
    expect(toasts.success).not.toHaveBeenCalled();
  });

  it("still reports an entry the bibliography already has", async () => {
    target.mockResolvedValue({ path: "refs.bib", exists: true, content: "@software{oleafly,\n title={x}}" });
    expect((await citeOleafly()).kind).toBe("present");
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

describe("runCiteOleaflyAction outcomes", () => {
  function markdownProject() {
    useFilesStore.setState({
      engine: {
        ...useFilesStore.getState().engine,
        id: "markdown",
        capabilities: { ...useFilesStore.getState().engine.capabilities, formatting_profile: "markdown" },
      },
    });
  }

  it("shows the citation in the project's own markup", async () => {
    typstProject();
    target.mockResolvedValue({ path: "refs.bib", exists: true, content: "@software{oleafly,\n title={x}}" });
    await runCiteOleaflyAction();
    expect(toasts.info).toHaveBeenCalledWith("refs.bib already has the Oleafly entry. Cite it with @oleafly.");

    markdownProject();
    target.mockResolvedValue({ path: "refs.bib", exists: true, content: "" });
    await runCiteOleaflyAction();
    expect(toasts.success).toHaveBeenCalledWith(
      "Added the Oleafly entry to refs.bib. Cite it with [@oleafly].",
      expect.objectContaining({ label: "Undo" }),
    );
  });

  it("undoes from the toast and reports an undo that failed", async () => {
    latexProject();
    target.mockResolvedValue({ path: "refs.bib", exists: true, content: "" });
    await runCiteOleaflyAction();
    const action = toasts.success.mock.calls[0][1] as { onClick: () => void };
    writeProjectFile.mockRejectedValueOnce(new Error("locked"));

    action.onClick();

    await vi.waitFor(() => expect(notifyError).toHaveBeenCalledWith("undo Oleafly citation", expect.any(Error)));
  });

  it("does not undo into a project that is no longer open", async () => {
    target.mockResolvedValue({ path: "refs.bib", exists: true, content: "" });
    const outcome = await citeOleafly();
    if (outcome.kind !== "added") throw new Error("unreachable");
    useFilesStore.setState({ projectId: "other" });

    await outcome.undo();

    expect(writeProjectFile).toHaveBeenCalledTimes(1);
  });

  it("opens the dialog without a project and reports a failure", async () => {
    useFilesStore.setState({ projectId: null });
    await runCiteOleaflyAction();
    expect(useCiteOleaflyStore.getState().open).toBe(true);

    useFilesStore.setState({ projectId: "paper" });
    const failure = new Error("unreadable");
    target.mockRejectedValue(failure);
    await runCiteOleaflyAction();
    expect(notifyError).toHaveBeenCalledWith(
      "cite Oleafly",
      failure,
      "Could not add the Oleafly citation. Copy it from Settings, Help & About instead.",
    );
  });
});
