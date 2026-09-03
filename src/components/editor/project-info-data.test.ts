import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_DOCUMENT_STATS } from "@/lib/document-stats";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";

type Binding = (
  projectId: string,
  request: { mainDocument: string; overrides: Record<string, string> },
) => Promise<unknown>;

const bridge = vi.hoisted(() => ({
  documentStats: undefined as
    | ((
        projectId: string,
        request: { mainDocument: string; overrides: Record<string, string> },
      ) => Promise<unknown>)
    | undefined,
  readDocumentSources: vi.fn(),
  selection: null as string | null,
}));

vi.mock("@/lib/tauri", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  const module: Record<string, unknown> = { ...original };
  Object.defineProperty(module, "documentStats", {
    enumerable: true,
    get: () => bridge.documentStats,
  });
  return module;
});

vi.mock("@/components/editor/selection-text", () => ({
  activeSelectionText: () => bridge.selection,
}));

vi.mock("@/lib/document-sources", () => ({
  readDocumentSources: (...args: unknown[]) => bridge.readDocumentSources(...args),
}));

import { collectProjectInfo } from "./project-info-data";

const NATIVE = {
  root: "main.tex",
  fileCount: 2,
  unreadable: ["chapters/missing.tex"],
  stats: {
    ...EMPTY_DOCUMENT_STATS,
    words: 12,
    wordsInText: 10,
    wordsInHeaders: 2,
    headers: 1,
    characters: 70,
    lines: 4,
  },
  files: [],
};

function openProject(): void {
  useFilesStore.setState({
    projectId: "project-1",
    mainDoc: "main.tex",
    activePath: null,
    tree: [],
    files: {
      "main.tex": { content: "\\section{Root}\nClean words.\n", dirty: false },
      "chapters/one.tex": { content: "Unsaved words here.", dirty: true },
    },
  });
  useIndexStore.setState({ index: null });
}

describe("collectProjectInfo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bridge.documentStats = undefined;
    bridge.selection = null;
    bridge.readDocumentSources.mockResolvedValue({
      paths: ["main.tex", "chapters/one.tex"],
      texts: ["\\section{Root}\nClean words.\n", "Unsaved words here."],
      unreadable: [],
    });
  });

  it("counts in Rust when the binding exists and sends only dirty buffers", async () => {
    openProject();
    const binding = vi.fn<Binding>().mockResolvedValue(NATIVE);
    bridge.documentStats = binding;

    const snapshot = await collectProjectInfo();

    expect(binding).toHaveBeenCalledWith("project-1", {
      mainDocument: "main.tex",
      overrides: { "chapters/one.tex": "Unsaved words here." },
    });
    expect(bridge.readDocumentSources).not.toHaveBeenCalled();
    expect(snapshot).toEqual({
      root: "main.tex",
      fileCount: 2,
      unreadable: ["chapters/missing.tex"],
      stats: NATIVE.stats,
      selectionWords: null,
    });
  });

  it("counts in TypeScript when the backend has no document_stats command", async () => {
    openProject();

    const snapshot = await collectProjectInfo();

    expect(bridge.readDocumentSources).toHaveBeenCalledWith("project-1", null, "main.tex");
    expect(snapshot.fileCount).toBe(2);
    expect(snapshot.stats.words).toBe(6);
    expect(snapshot.stats.headers).toBe(1);
    expect(snapshot.unreadable).toEqual([]);
  });

  it("falls back to TypeScript when the Rust call fails", async () => {
    openProject();
    bridge.documentStats = vi.fn<Binding>().mockRejectedValue(new Error("lock held"));

    const snapshot = await collectProjectInfo();

    expect(bridge.readDocumentSources).toHaveBeenCalledOnce();
    expect(snapshot.stats.words).toBe(6);
  });

  it("counts the active buffer alone without a project and never calls Rust", async () => {
    useFilesStore.setState({
      projectId: null,
      activePath: "scratch.tex",
      files: { "scratch.tex": { content: "Alpha beta gamma.", dirty: true } },
    });
    const binding = vi.fn<Binding>().mockResolvedValue(NATIVE);
    bridge.documentStats = binding;

    const snapshot = await collectProjectInfo();

    expect(binding).not.toHaveBeenCalled();
    expect(bridge.readDocumentSources).not.toHaveBeenCalled();
    expect(snapshot.root).toBe("scratch.tex");
    expect(snapshot.fileCount).toBe(1);
    expect(snapshot.stats.words).toBe(3);
  });

  it("reports the selection word count alongside either path", async () => {
    openProject();
    bridge.selection = "one two three";
    bridge.documentStats = vi.fn<Binding>().mockResolvedValue(NATIVE);

    const snapshot = await collectProjectInfo();

    expect(snapshot.selectionWords).toBe(3);
  });
});
