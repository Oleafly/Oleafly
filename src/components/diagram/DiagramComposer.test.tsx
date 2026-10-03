// @vitest-environment jsdom
import { act, render, waitFor } from "@testing-library/react";
import { createContext, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiagramHost } from "@oleafly/diagram";

const captured = vi.hoisted(() => ({
  props: null as null | {
    host: DiagramHost;
    projectName?: string | null;
    brand?: ReactNode;
    onClose: () => void;
    language?: string;
    languageRequest?: number;
  },
}));

const tauri = vi.hoisted(() => ({ renderTypstSnippet: vi.fn(async () => ({ status: "failed", diagnostics: [] })) }));

vi.mock("@oleafly/diagram", () => ({
  languageForPath: (path: string | null) => {
    if (/\.(?:tex|tikz)$/.test(path ?? "")) return "tikz";
    if (/\.typ$/.test(path ?? "")) return "typst";
    if (/\.(?:md|mmd)$/.test(path ?? "")) return "mermaid";
    return null;
  },
  DiagramKitContext: createContext(null),
  DiagramComposer: (props: NonNullable<typeof captured.props>) => {
    captured.props = props;
    return <div data-testid="composer-core" />;
  },
}));
vi.mock("@/components/diagram/diagram-kit", () => ({ KIT: {} }));
vi.mock("@/components/diagram/code-extensions", () => ({
  diagramCodeExtensions: () => [],
  diagramLanguageExtensions: () => ({}),
}));
vi.mock("@/components/layout/HomeBrandButton", () => ({
  HomeBrandButton: () => <button type="button" data-testid="home-brand" />,
}));
vi.mock("@/components/layout/WindowControls", () => ({ WindowControls: () => null }));
vi.mock("@/components/editor/cm/controller", () => ({ insertAtCursor: vi.fn() }));
vi.mock("@/lib/pdf-image", () => ({ pdfPageToPng: vi.fn() }));
vi.mock("@/lib/use-fullscreen", () => ({ useFullscreen: () => false }));
vi.mock("@/lib/native-file-dialog", () => ({ pickSavePath: vi.fn() }));
vi.mock("@/lib/agent-backend", () => ({ completeText: vi.fn() }));
vi.mock("@/lib/tauri", () => ({
  compileIsolated: vi.fn(),
  readIsolatedPdf: vi.fn(),
  writeProjectBytes: vi.fn(),
  writeFileContent: vi.fn(),
  writeBytesFile: vi.fn(),
  listFiles: vi.fn(),
  createImageProject: vi.fn(),
  createDiagramProject: vi.fn(),
  getOrCreateScratchProject: vi.fn(async () => "scratch"),
  saveFigureToCache: vi.fn(),
  getConfig: vi.fn(),
  renderTypstSnippet: tauri.renderTypstSnippet,
}));

import { useFilesStore } from "@/store/files";
import { useHomeViewStore } from "@/store/home-view";
import { useDiagramComposerStore } from "@/store/diagram-composer";
import { useSettingsStore } from "@/store/settings";
import { DiagramComposer } from "./DiagramComposer";

async function openComposer() {
  useHomeViewStore.setState({ page: "diagram-composer" });
  render(<DiagramComposer />);
  await waitFor(() => expect(captured.props).not.toBeNull());
  const props = captured.props;
  if (!props) throw new Error("the composer did not render");
  return props;
}

beforeEach(() => {
  captured.props = null;
  useFilesStore.setState({ projectId: null, projectName: "", activePath: null });
});

describe("the diagram composer bridge", () => {
  it("goes back to the open project and inserts into its LaTeX document", async () => {
    useFilesStore.setState({ projectId: "paper", projectName: "Paper", activePath: "chapters/intro.tex" });
    const props = await openComposer();
    expect(props.projectName).toBe("Paper");
    expect(props.brand).toBeUndefined();
    expect(props.host.insertTarget?.()).toEqual({ projectId: "paper", language: "tikz" });
    props.onClose();
    expect(useHomeViewStore.getState().page).toBe("library");
    expect(useFilesStore.getState().projectId).toBe("paper");
  });

  it("offers Typst insertion for an open Typst document", async () => {
    useFilesStore.setState({ projectId: "notes", projectName: "Notes", activePath: "main.typ" });
    const props = await openComposer();
    expect(props.host.insertTarget?.()).toEqual({ projectId: "notes", language: "typst" });
  });

  it("opens in the language the chooser or a toolbar asked for and follows later requests", async () => {
    useDiagramComposerStore.setState({ language: "typst", requestId: 4 });
    const props = await openComposer();
    expect(props.language).toBe("typst");
    expect(props.languageRequest).toBe(4);
    act(() => useDiagramComposerStore.getState().requestLanguage("mermaid"));
    await waitFor(() => expect(captured.props?.language).toBe("mermaid"));
    expect(captured.props?.languageRequest).toBe(5);
  });

  it("offers Mermaid insertion for a Markdown document and none for a diagram source file", async () => {
    useFilesStore.setState({ projectId: "md", projectName: "Notes", activePath: "notes/intro.md" });
    const props = await openComposer();
    expect(props.host.insertTarget?.()).toEqual({ projectId: "md", language: "mermaid" });
    useFilesStore.setState({ activePath: "figures/flow.mmd" });
    expect(props.host.insertTarget?.()).toBeNull();
  });

  it("renders Typst previews with the open Typst project and the offline setting", async () => {
    useFilesStore.setState({
      projectId: "notes",
      activePath: "main.typ",
      engine: { ...useFilesStore.getState().engine, id: "typst", typst_resolved: { version: "0.13.1" } } as never,
    });
    useSettingsStore.setState({ offline: true });
    const props = await openComposer();
    expect(props.host.typstContext?.()).toEqual({ projectId: "notes", typstVersion: "0.13.1" });
    await props.host.renderTypst?.({ source: "#set page()", format: "png", projectId: "notes", document: true });
    expect(tauri.renderTypstSnippet).toHaveBeenCalledWith({
      source: "#set page()",
      format: "png",
      ppi: undefined,
      projectId: "notes",
      document: true,
      offline: true,
    });
    useFilesStore.setState({ engine: { ...useFilesStore.getState().engine, id: "latexmk" } as never });
    expect(props.host.typstContext?.()).toEqual({ projectId: null, typstVersion: null });
  });

  it("keeps the home button and offers no insertion from the home screen", async () => {
    const props = await openComposer();
    expect(props.brand).toBeDefined();
    expect(props.projectName).toBeNull();
    expect(props.host.insertTarget?.()).toBeNull();
  });
});
