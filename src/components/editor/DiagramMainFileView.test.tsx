// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import legacySource from "@/lib/__fixtures__/tikz-v0313-generated.tex?raw";
import type { DiagramModel } from "@oleafly/latex";

const mocks = vi.hoisted(() => ({
  read: vi.fn(), write: vi.fn(),
  change: null as null | ((model: DiagramModel) => void),
  model: null as DiagramModel | null,
  readOnly: false,
}));
vi.mock("@/lib/tauri", () => ({
  readFileContent: mocks.read, writeFileContent: mocks.write,
  projectMutationGeneration: vi.fn(async () => 0), mcpSetActiveProject: vi.fn(async () => {}),
  listFiles: vi.fn(async () => []), gitShow: vi.fn(async () => ""),
}));
vi.mock("@/components/diagram/diagram-kit", () => ({ KIT: {} }));
vi.mock("@oleafly/diagram", async () => {
  const { createContext } = await import("react");
  return { DiagramKitContext: createContext({}), DiagramCanvas: ({ model, onChange, readOnly }: {
    model: DiagramModel; onChange: (model: DiagramModel) => void; readOnly: boolean;
  }) => {
    mocks.model = model; mocks.change = onChange; mocks.readOnly = readOnly;
    return <div data-testid="canvas" />;
  } };
});
import DiagramMainFileView from "./DiagramMainFileView";
import { useFilesStore } from "@/store/files";
import { standaloneDiagramSource } from "@/lib/diagram-source";

beforeEach(() => { mocks.write.mockClear(); mocks.model = null; mocks.change = null; });
afterEach(async () => { cleanup(); await useFilesStore.getState().closeProject(); await vi.dynamicImportSettled(); });

function currentModel(): DiagramModel {
  if (!mocks.model) throw new Error("Canvas did not load a model");
  return mocks.model;
}
function changeModel(model: DiagramModel) {
  if (!mocks.change) throw new Error("Canvas did not register its change handler");
  mocks.change(model);
}

async function open(source: string) {
  mocks.read.mockResolvedValue(source);
  mocks.write.mockResolvedValue({ generation: 1 });
  useFilesStore.setState({ projectId: "diagram", activePath: "main.tex", mainDoc: "main.tex", projectKind: "diagram",
    files: { "main.tex": { content: source, dirty: false } }, openTabs: ["main.tex"] });
  render(<DiagramMainFileView projectId="diagram" path="main.tex" />);
  await screen.findByTestId("canvas");
}

it("never overwrites unsupported TikZ or its custom preamble on a canvas change", async () => {
  const source = String.raw`\documentclass{standalone}
\usepackage{tikz}
\newcommand{\studyname}{Study}
\begin{document}
\begin{tikzpicture}
\node (a) at (0,0) {\studyname};
\foreach \x in {1,2,3} {\draw (\x,0) circle (0.2);}
\end{tikzpicture}
\end{document}`;
  await open(source);
  expect(mocks.readOnly).toBe(true);
  expect(screen.getByRole("status")).toHaveTextContent("read-only preview");
  const next = structuredClone(currentModel()); next.nodes[0].x += 40;
  act(() => changeModel(next));
  await useFilesStore.getState().flushForQuit();
  expect(useFilesStore.getState().files["main.tex"].content).toBe(source);
  expect(mocks.write).not.toHaveBeenCalled();
});

it("keeps 0.3.13 drawings editable, preserves model identity for undo and retains background", async () => {
  const source = legacySource;
  await open(source);
  expect(mocks.readOnly).toBe(false);
  const next = structuredClone(currentModel()); delete next.background; next.nodes[0].x += 40;
  act(() => changeModel(next));
  expect(mocks.model).toBe(next);
  const second = structuredClone(next); second.nodes[0].x += 40;
  act(() => changeModel(second));
  await useFilesStore.getState().flushForQuit();
  expect(useFilesStore.getState().files["main.tex"].content).toBe(standaloneDiagramSource({ ...second, background: "#ffffff" }));
  expect(mocks.write).toHaveBeenCalled();
});

it("does not overwrite source changed outside the current canvas model", async () => {
  const source = legacySource;
  await open(source);
  const changed = source.replace("\\end{document}", "% keep this comment\n\\end{document}");
  useFilesStore.setState({ files: { "main.tex": { content: changed, dirty: false } } });
  const next = structuredClone(currentModel()); next.nodes[0].x += 40;
  act(() => changeModel(next));
  await waitFor(() => expect(mocks.readOnly).toBe(true));
  expect(useFilesStore.getState().files["main.tex"].content).toBe(changed);
  expect(mocks.write).not.toHaveBeenCalled();
});
