// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createContext, useContext, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiagramHost } from "@oleafly/diagram";

const captured = vi.hoisted(() => ({
  kit: null as null | { t: (key: string, params?: Record<string, unknown>) => string },
  props: null as null | {
    forcePreviewOpen?: boolean;
    host: DiagramHost;
    projectName?: string | null;
    brand?: ReactNode;
    onClose: () => void;
    language?: string;
    languageRequest?: number;
  },
}));

const tauri = vi.hoisted(() => ({ renderTypstSnippet: vi.fn(async () => ({ status: "failed", diagnostics: [] })) }));

const kitContext = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("@oleafly/diagram", () => {
  const DiagramKitContext = createContext(null);
  kitContext.value = DiagramKitContext;
  return {
    languageForPath: (path: string | null) => {
      if (/\.(?:tex|tikz)$/.test(path ?? "")) return "tikz";
      if (/\.typ$/.test(path ?? "")) return "typst";
      if (/\.(?:md|mmd)$/.test(path ?? "")) return "mermaid";
      return null;
    },
    DiagramKitContext,
    DiagramComposer: (props: NonNullable<typeof captured.props>) => {
      captured.props = props;
      captured.kit = useContext(DiagramKitContext);
      return <div data-testid="composer-core" />;
    },
  };
});
vi.mock("@/components/diagram/diagram-kit", () => ({ KIT: {} }));
vi.mock("@/components/diagram/code-extensions", () => ({
  diagramCodeExtensions: () => [],
  diagramLanguageExtensions: () => ({}),
}));
vi.mock("@/components/layout/HomeBrandButton", () => ({
  HomeBrandButton: ({ onClick }: { onClick: () => void }) => (
    <button type="button" data-testid="home-brand" onClick={onClick} />
  ),
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

import * as tauriApi from "@/lib/tauri";
import { completeText } from "@/lib/agent-backend";
import { APP_ERROR_PREFIX } from "@/lib/app-error";
import { pickSavePath } from "@/lib/native-file-dialog";
import { useFilesStore } from "@/store/files";
import { useHomeViewStore } from "@/store/home-view";
import { useDiagramComposerStore } from "@/store/diagram-composer";
import { useSettingsStore } from "@/store/settings";
import { useTourStore } from "@/store/tours";
import { tourRegistry } from "@/lib/tours/registry";
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
    render(<div>{props.brand}</div>);
    fireEvent.click(screen.getByTestId("home-brand"));
    expect(useHomeViewStore.getState().page).toBe("library");
  });

  it("translates the package's strings from the diagram catalog", async () => {
    await openComposer();
    expect(captured.kit?.t("composer.title")).toBe("Insert diagram");
  });

  it("opens the preview for the diagram tour's preview step only", async () => {
    useTourStore.setState({
      activeTourId: "diagram",
      activeStepIndex: tourRegistry.diagram.steps.findIndex((step) => step.id === "diagram-preview"),
    });
    const props = await openComposer();
    expect(props.forcePreviewOpen).toBe(true);
    act(() => useTourStore.setState({ activeStepIndex: 0 }));
    expect(captured.props?.forcePreviewOpen).toBe(false);
    act(() => useTourStore.setState({ activeTourId: null, activeStepIndex: 0 }));
  });

  it("renders Typst snippets without a project and reports an unresolved Typst version", async () => {
    useFilesStore.setState({
      projectId: "notes",
      engine: { ...useFilesStore.getState().engine, id: "typst", typst_resolved: undefined } as never,
    });
    useSettingsStore.setState({ offline: false });
    const props = await openComposer();
    expect(props.host.typstContext?.()).toEqual({ projectId: "notes", typstVersion: null });
    await props.host.renderTypst?.({ source: "= Title", format: "svg", projectId: null, document: false });
    expect(tauri.renderTypstSnippet).toHaveBeenLastCalledWith({
      source: "= Title",
      format: "svg",
      ppi: undefined,
      projectId: undefined,
      document: false,
      offline: false,
    });
  });
});

describe("the diagram host adapters", () => {
  const appError = `${APP_ERROR_PREFIX}${JSON.stringify({ code: "project.not_found", params: {} })}`;

  it("compiles in isolation with the offline setting", async () => {
    useSettingsStore.setState({ offline: false });
    const props = await openComposer();
    vi.mocked(tauriApi.compileIsolated).mockResolvedValue({ ok: true } as never);

    await props.host.compileIsolated("scratch", "\\draw (0,0);");

    expect(tauriApi.compileIsolated).toHaveBeenCalledWith("scratch", "\\draw (0,0);", false);
  });

  it("turns structured write failures into readable errors and passes others through", async () => {
    const props = await openComposer();
    vi.mocked(tauriApi.writeFileContent).mockRejectedValueOnce(new Error(appError));
    await expect(props.host.writeFileContent("p", "fig.tex", "x")).rejects.toThrow(
      "This project is no longer in your library.",
    );

    const plain = new Error("disk full");
    vi.mocked(tauriApi.writeProjectBytes).mockRejectedValueOnce(plain);
    await expect(props.host.writeProjectBytes("p", "fig.png", "AAAA")).rejects.toBe(plain);

    vi.mocked(tauriApi.writeProjectBytes).mockRejectedValueOnce(appError);
    await expect(props.host.writeProjectBytes("p", "fig.png", "AAAA")).rejects.toThrow(
      "This project is no longer in your library.",
    );

    vi.mocked(tauriApi.writeFileContent).mockResolvedValueOnce(undefined as never);
    await expect(props.host.writeFileContent("p", "fig.tex", "x")).resolves.toBeUndefined();
  });

  it("reads and updates the open project through the files store", async () => {
    const applyExternalWrite = vi.fn();
    const saveActive = vi.fn(async () => true);
    const refreshTree = vi.fn(async () => undefined);
    const refreshProjects = vi.fn(async () => undefined);
    useFilesStore.setState({
      mainDoc: "paper.tex",
      applyExternalWrite,
      saveActive,
      refreshTree,
      refreshProjects,
    } as never);
    const props = await openComposer();

    expect(props.host.getMainDoc()).toBe("paper.tex");
    props.host.applyExternalWrite("p", "fig.tex", "body");
    expect(applyExternalWrite).toHaveBeenCalledWith("p", "fig.tex", "body");
    await props.host.saveActive();
    expect(saveActive).toHaveBeenCalled();
    await expect(props.host.refreshTree()).resolves.toBeUndefined();
    expect(refreshTree).toHaveBeenCalled();
    await props.host.refreshProjects();
    expect(refreshProjects).toHaveBeenCalled();
  });

  it("finds projects by name and reports each project's diagram language", async () => {
    const projects = [
      { id: "a", name: "Thesis", engine: "latexmk", main_doc: "main.tex" },
      { id: "b", name: "Notes", engine: "typst", main_doc: "main.typ" },
      { id: "c", name: "Readme", engine: "markdown", main_doc: "README.md" },
      { id: "d", name: "Odd", engine: undefined, main_doc: "main.unknown" },
    ];
    const refreshProjects = vi.fn(async () => {
      useFilesStore.setState({ projects } as never);
    });
    useFilesStore.setState({ refreshProjects } as never);
    const props = await openComposer();

    await expect(props.host.findProjectIdByName("Notes")).resolves.toBe("b");
    await expect(props.host.findProjectIdByName("Missing")).resolves.toBeNull();
    await expect(props.host.listProjectNames()).resolves.toEqual([
      { id: "a", name: "Thesis", typst: false, language: "tikz" },
      { id: "b", name: "Notes", typst: true, language: "typst" },
      { id: "c", name: "Readme", typst: false, language: "mermaid" },
      { id: "d", name: "Odd", typst: false, language: "tikz" },
    ]);
  });

  it("caches figures and creates diagram projects through the backend", async () => {
    const props = await openComposer();
    vi.mocked(tauriApi.saveFigureToCache).mockResolvedValue({
      hash: "abc",
      alreadyCached: true,
      path: "/cache/abc.png",
    } as never);
    vi.mocked(tauriApi.createDiagramProject).mockResolvedValue("project-9" as never);

    await expect(props.host.saveFigureToCache("Flow", "UE5H", "\\draw;")).resolves.toEqual({
      hash: "abc",
      alreadyCached: true,
    });
    await props.host.createDiagramProject("Flow", "graph TD", "mermaid");
    expect(tauriApi.createDiagramProject).toHaveBeenCalledWith("Flow", "graph TD", "mermaid");
  });

  it("saves exported bytes where the user picks and reports a cancelled picker", async () => {
    const props = await openComposer();
    vi.mocked(pickSavePath).mockResolvedValueOnce(null);
    await expect(props.host.saveBytesToDisk("figure", "svg", "PHN2Zz4=")).resolves.toBe(false);
    expect(tauriApi.writeBytesFile).not.toHaveBeenCalled();

    vi.mocked(pickSavePath).mockResolvedValueOnce("/tmp/figure.svg");
    await expect(props.host.saveBytesToDisk("figure", "svg", "PHN2Zz4=")).resolves.toBe(true);
    expect(pickSavePath).toHaveBeenLastCalledWith({
      defaultPath: "figure.svg",
      filters: [{ name: "SVG", extensions: ["svg"] }],
    });
    expect(tauriApi.writeBytesFile).toHaveBeenCalledWith("/tmp/figure.svg", "PHN2Zz4=");
  });

  describe("Fix with AI", () => {
    const configured = {
      ai_provider: "openai",
      ai_model: "gpt-4o",
      ai_api_key: "key",
      ai_keys: { openai: "key" },
      ai_custom_providers: [],
    };

    async function openFixWithAi() {
      const props = await openComposer();
      const fixWithAi = props.host.fixWithAi?.bind(props.host);
      if (!fixWithAi) throw new Error("the composer host has no Fix with AI");
      return fixWithAi;
    }

    it("asks for a provider when none is connected", async () => {
      vi.mocked(tauriApi.getConfig).mockResolvedValue({
        ...configured,
        ai_api_key: "",
        ai_keys: {},
      } as never);
      const fixWithAi = await openFixWithAi();

      await expect(fixWithAi("code", "log")).rejects.toThrow(
        "Connect an AI provider in Settings to use Fix with AI.",
      );
      expect(completeText).not.toHaveBeenCalled();
    });

    it("returns the model's figure without code fences", async () => {
      vi.mocked(tauriApi.getConfig).mockResolvedValue(configured as never);
      vi.mocked(completeText).mockResolvedValue(
        "```latex\n\\begin{tikzpicture}\\end{tikzpicture}\n```",
      );
      const fixWithAi = await openFixWithAi();

      await expect(fixWithAi("bad", "! Undefined control sequence")).resolves.toBe(
        "\\begin{tikzpicture}\\end{tikzpicture}",
      );
      const request = vi.mocked(completeText).mock.calls.at(-1)?.[0] as { user: string };
      expect(request.user).toContain("CODE:\nbad");
      expect(request.user).toContain("! Undefined control sequence");
    });

    it("uses the caller's prompt when one is given and explains failures", async () => {
      vi.mocked(tauriApi.getConfig).mockResolvedValue(configured as never);
      vi.mocked(completeText).mockRejectedValueOnce(new Error("rate limited"));
      const fixWithAi = await openFixWithAi();
      const prompt = { system: "Fix Mermaid", user: "graph TD" };

      await expect(fixWithAi("graph TD", "", prompt)).rejects.toThrow(
        "Fix failed: rate limited",
      );
      expect(completeText).toHaveBeenLastCalledWith(prompt);
    });
  });

  describe("TikZ file picker", () => {
    function capturePicker() {
      const inputs: HTMLInputElement[] = [];
      const click = vi
        .spyOn(HTMLInputElement.prototype, "click")
        .mockImplementation(function (this: HTMLInputElement) {
          inputs.push(this);
        });
      return { inputs, restore: () => click.mockRestore() };
    }

    function choose(input: HTMLInputElement, files: File[]) {
      Object.defineProperty(input, "files", { configurable: true, value: files });
      input.dispatchEvent(new Event("change"));
    }

    it("reads the chosen file", async () => {
      const props = await openComposer();
      const picker = capturePicker();

      const picked = props.host.pickTikzFile();
      const [input] = picker.inputs;
      expect(input.type).toBe("file");
      expect(input.accept).toBe(".tikz,.tex");
      choose(input, [new File(["\\draw (0,0);"], "fig.tikz")]);

      await expect(picked).resolves.toEqual({ name: "fig.tikz", content: "\\draw (0,0);" });
      picker.restore();
    });

    it("resolves to nothing when the picker is cancelled or closes empty", async () => {
      const props = await openComposer();
      const picker = capturePicker();

      const cancelled = props.host.pickTikzFile(".mmd");
      expect(picker.inputs[0].accept).toBe(".mmd");
      picker.inputs[0].dispatchEvent(new Event("cancel"));
      choose(picker.inputs[0], [new File(["late"], "late.mmd")]);
      await expect(cancelled).resolves.toBeNull();

      const empty = props.host.pickTikzFile();
      choose(picker.inputs[1], []);
      await expect(empty).resolves.toBeNull();
      picker.restore();
    });

    it("uses a queued test pick instead of opening the dialog", async () => {
      const props = await openComposer();
      const picker = capturePicker();
      const hook = (window as unknown as {
        __setNextTikzImport: (name: string | null, content: string | null) => void;
      }).__setNextTikzImport;

      hook("queued.tikz", null);
      await expect(props.host.pickTikzFile()).resolves.toEqual({ name: "queued.tikz", content: "" });
      hook(null, null);
      await expect(props.host.pickTikzFile()).resolves.toBeNull();
      expect(picker.inputs).toHaveLength(0);
      picker.restore();
    });

    it("resolves to nothing when the file cannot be read", async () => {
      const props = await openComposer();
      const picker = capturePicker();
      const unreadable = new File(["x"], "broken.tex");
      unreadable.text = () => Promise.reject(new Error("unreadable"));

      const picked = props.host.pickTikzFile();
      choose(picker.inputs[0], [unreadable]);

      await expect(picked).resolves.toBeNull();
      picker.restore();
    });
  });
});
