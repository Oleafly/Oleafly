// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  presence: vi.fn(),
  clashes: new Map<string, string>(),
  readyChecks: 0,
}));

vi.mock("@/components/collab/collab-ready", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/collab/collab-ready")>();
  return {
    useCollabReady: () => {
      mocks.readyChecks += 1;
      return actual.useCollabReady();
    },
  };
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args?: unknown) =>
    command === "list_file_tree"
      ? { entries: await mocks.invoke("list_files", args), truncated: false }
      : mocks.invoke(command, args),
  isTauri: () => false,
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setFocus: vi.fn() }),
}));
vi.mock("@/lib/native-file-dialog", () => ({ pickOpenPath: vi.fn() }));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));
vi.mock("@/components/editor/wysiwyg/controller", () => ({
  flushWysiwygPendingEdits: vi.fn(),
  invalidateWysiwygProjectSession: vi.fn(),
}));
vi.mock("@/features/collab/sharing/TreePresence", async () => {
  const { useEffect } = await import("react");
  return {
    TreePresence: ({ onChange }: { onChange: (marks: ReadonlyMap<string, unknown[]>) => void }) => {
      mocks.presence();
      useEffect(() => {
        onChange(new Map([["main.tex", [{ id: "alice", hue: 200, label: "Alice Chen has this file open" }]]]));
      }, [onChange]);
      return null;
    },
  };
});

vi.mock("@/features/collab/sharing/TreeClashes", async () => {
  const { useEffect } = await import("react");
  const { useTreeClashes } = await import("@/components/collab/tree-clashes");
  return {
    TreeClashes: () => {
      useEffect(() => {
        useTreeClashes.setState({ labels: new Map(mocks.clashes) });
        return () => useTreeClashes.setState({ labels: new Map() });
      }, []);
      return null;
    },
  };
});

import { i18n } from "@/i18n";
import { LATEX_ENGINE } from "@/lib/document-engine";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { FileTree } from "./FileTree";

const TREE = [
  { path: "main.tex", is_dir: false },
  { path: "refs.bib", is_dir: false },
];

beforeEach(async () => {
  await i18n.changeLanguage("en");
  mocks.invoke.mockReset().mockImplementation(async (command: string) => {
    if (command === "list_files") return TREE;
    if (command === "project_mutation_generation") return 0;
    if (command === "project_engine") return LATEX_ENGINE;
    return undefined;
  });
  mocks.presence.mockReset();
  mocks.clashes.clear();
  useSettingsStore.setState({ hiddenFilePatterns: [] });
  useFilesStore.setState({
    projectId: "project-1",
    tree: TREE,
    treeTruncated: false,
    files: {},
    openTabs: [],
    activePath: null,
    mainDoc: "main.tex",
    manifestHome: "library",
    engine: LATEX_ENGINE,
    engineLoaded: true,
  });
});

afterEach(() => {
  useSettingsStore.setState({ liveCollaboration: false });
});

describe("FileTree collaboration presence", () => {
  it("puts a dot for each person on the file they have open", async () => {
    useSettingsStore.setState({ liveCollaboration: true });
    render(<FileTree />);
    const main = screen.getByRole("treeitem", { name: /^main\.tex/ });
    expect(await within(main).findByRole("img", { name: "Alice Chen has this file open" })).toBeInTheDocument();
    const refs = screen.getByRole("treeitem", { name: /^refs\.bib/ });
    expect(within(refs).queryByRole("img")).toBeNull();
  });

  it("badges a file that got a new name on disk because another file has its name", async () => {
    const label = "main.tex also has the name Main.tex, so this file got a new name on disk.";
    mocks.clashes.set("refs.bib", label);
    useSettingsStore.setState({ liveCollaboration: true });
    render(<FileTree />);
    const refs = screen.getByRole("treeitem", { name: /^refs\.bib/ });
    expect(await within(refs).findByRole("img", { name: label })).toBeInTheDocument();
    const main = screen.getByRole("treeitem", { name: /^main\.tex/ });
    expect(within(main).queryByRole("img", { name: label })).toBeNull();
  });

  it("checks whether collaboration is ready once per tree render, not once per row", async () => {
    const tree = Array.from({ length: 300 }, (_, index) => ({ path: `chapter-${index}.tex`, is_dir: false }));
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "list_files") return tree;
      if (command === "project_mutation_generation") return 0;
      if (command === "project_engine") return LATEX_ENGINE;
      return undefined;
    });
    useFilesStore.setState({ tree, mainDoc: "chapter-0.tex" });
    mocks.readyChecks = 0;
    render(<FileTree />);
    await screen.findByRole("treeitem", { name: /^chapter-0\.tex/ });
    const rows = screen.getAllByRole("treeitem").length;
    expect(rows).toBeGreaterThanOrEqual(50);
    expect(mocks.readyChecks).toBeLessThan(rows / 4);
  });

  it("loads no presence while live collaboration is off", async () => {
    render(<FileTree />);
    await screen.findByRole("treeitem", { name: /^main\.tex/ });
    expect(mocks.presence).not.toHaveBeenCalled();
    expect(screen.queryByRole("img", { name: "Alice Chen has this file open" })).toBeNull();
  });
});
