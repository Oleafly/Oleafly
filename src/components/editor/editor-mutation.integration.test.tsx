import { JSDOM } from "jsdom";
import { beforeAll, beforeEach, afterEach, expect, it, vi } from "vitest";
import type { ProjectStateChanged } from "@/lib/tauri";
import { LATEX_ENGINE } from "@/lib/document-engine";
import { acquireEditorMutationLease, isEditorMutationLocked } from "@/lib/editor-mutation-lease";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
  generation: vi.fn(),
  list: vi.fn(),
  diagramChange: null as null | ((model: unknown) => void),
}));
vi.mock("@/lib/tauri", () => ({
  readFileContent: mocks.read,
  writeFileContent: mocks.write,
  projectMutationGeneration: mocks.generation,
  listFiles: mocks.list,
  gitShow: vi.fn(async () => "Before"),
  mcpSetActiveProject: vi.fn(async () => {}),
}));
vi.mock("@/components/diagram/diagram-kit", () => ({ KIT: {} }));
vi.mock("@oleafly/diagram", async () => {
  const { createContext } = await import("react");
  return {
    DiagramKitContext: createContext({}),
    DiagramCanvas: ({ onChange }: { onChange: (model: unknown) => void }) => {
      mocks.diagramChange = onChange;
      return <div data-testid="diagram-canvas" />;
    },
  };
});
vi.mock("@oleafly/latex", async (original) => ({
  ...await original<typeof import("@oleafly/latex")>(),
  parseEmbeddedModel: () => ({ nodes: [], edges: [] }),
  serializeDiagram: () => "Diagram edit",
  buildStandaloneDoc: ({ code }: { code: string }) => code,
}));

let act: typeof import("@testing-library/react").act;
let render: typeof import("@testing-library/react").render;
let cleanup: typeof import("@testing-library/react").cleanup;
let waitFor: typeof import("@testing-library/react").waitFor;
let useFilesStore: typeof import("@/store/files").useFilesStore;
let useDiffStore: typeof import("@/store/diff").useDiffStore;
let DiffView: typeof import("./diff/DiffView").DiffView;
let DiagramMainFileView: typeof import("./DiagramMainFileView").default;
let EditorView: typeof import("@codemirror/view").EditorView;
let revision = 100_000;

beforeAll(async () => {
  const options = { url: "https://oleafly.test", pretendToBeVisual: true };
  const dom = new JSDOM("<!doctype html><html><body></body></html>", options);
  for (const name of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event", "CustomEvent", "MutationObserver", "DOMRect"] as const) {
    vi.stubGlobal(name, name === "window" ? dom.window : dom.window[name]);
  }
  vi.stubGlobal("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
  vi.stubGlobal("requestAnimationFrame", dom.window.requestAnimationFrame.bind(dom.window));
  vi.stubGlobal("cancelAnimationFrame", dom.window.cancelAnimationFrame.bind(dom.window));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  dom.window.Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  dom.window.Range.prototype.getBoundingClientRect = () => new dom.window.DOMRect();
  ({ act, render, cleanup, waitFor } = await import("@testing-library/react"));
  ({ useFilesStore } = await import("@/store/files"));
  ({ useDiffStore } = await import("@/store/diff"));
  ({ DiffView } = await import("./diff/DiffView"));
  ({ default: DiagramMainFileView } = await import("./DiagramMainFileView"));
  ({ EditorView } = await import("@codemirror/view"));
});

beforeEach(() => {
  mocks.read.mockReset().mockResolvedValue("Before");
  mocks.write.mockReset().mockResolvedValue({ generation: 1 });
  mocks.generation.mockReset().mockResolvedValue(0);
  mocks.list.mockReset().mockResolvedValue([{ path: "notes.txt", is_dir: false }]);
  mocks.diagramChange = null;
  useFilesStore.setState({ projectId: "project", activePath: "notes.txt", files: {}, openTabs: ["notes.txt"], tree: [{ path: "notes.txt", is_dir: false }], engine: LATEX_ENGINE });
  useDiffStore.setState({ diffs: [], activeKey: null, mode: "unified" });
});

afterEach(async () => {
  cleanup();
  mocks.write.mockResolvedValue({ generation: 1 });
  await useFilesStore.getState().closeProject();
});

it("flushes a just-edited working diff through the save queue and reconciles it while locked", async () => {
  useDiffStore.getState().openDiff("notes.txt", "working");
  const mounted = render(<DiffView />);
  await waitFor(() => expect(mounted.container.querySelector(".cm-content")).not.toBeNull());
  const view = EditorView.findFromDOM(mounted.container.querySelector(".cm-content") as HTMLElement);
  if (!view) throw new Error("The diff editor did not mount.");
  act(() => view.dispatch({ changes: { from: 6, insert: " edit" } }));
  expect(useFilesStore.getState().files["notes.txt"]).toEqual({ content: "Before edit", dirty: true });
  expect(mocks.write).not.toHaveBeenCalled();
  const action = vi.fn(async (): Promise<{ projectState: ProjectStateChanged }> => {
    expect(mocks.write).toHaveBeenCalledWith("project", "notes.txt", "Before edit", 0);
    view.dispatch({ changes: { from: 0, insert: "Blocked" } });
    expect(view.state.doc.toString()).toBe("Before edit");
    mocks.read.mockResolvedValue("Applied");
    return { projectState: {
      projectId: "project", revision: ++revision, reason: "research-task-apply", filesChanged: true, mutationGeneration: 2,
      project: { name: "Paper", kind: "", main_doc: "notes.txt", engine: "latex", allow_shell_escape: false, checkpoints: { mode: "engine_dependencies" } }, engine: LATEX_ENGINE,
    } };
  });
  await act(async () => { await useFilesStore.getState().runExternalProjectMutation("project", action); });
  expect(action).toHaveBeenCalledOnce();
  expect(view.state.doc.toString()).toBe("Applied");
  expect(isEditorMutationLocked("project")).toBe(false);
});

it("queues diagram edits immediately and rejects stale-project and leased callbacks", async () => {
  const mounted = render(<DiagramMainFileView projectId="project" path="notes.txt" />);
  await waitFor(() => expect(mounted.container.querySelector('[data-testid="diagram-canvas"]')).not.toBeNull());
  act(() => mocks.diagramChange?.({ nodes: [], edges: [] }));
  expect(useFilesStore.getState().files["notes.txt"]).toEqual({ content: "Diagram edit", dirty: true });
  expect(mocks.write).not.toHaveBeenCalled();
  useFilesStore.setState({ files: { "notes.txt": { content: "Saved", dirty: false } } });
  const lease = acquireEditorMutationLease("project");
  try {
    act(() => mocks.diagramChange?.({ nodes: [], edges: [] }));
    expect(useFilesStore.getState().files["notes.txt"].content).toBe("Saved");
  } finally { lease.release(); }
  act(() => {
    useFilesStore.setState({ projectId: "other", files: {} });
    mocks.diagramChange?.({ nodes: [], edges: [] });
  });
  expect(useFilesStore.getState().files).toEqual({});
});
