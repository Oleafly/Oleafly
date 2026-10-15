// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { LATEX_ENGINE } from "@/lib/document-engine";
import { useCollabEditorGate } from "@/lib/collab-live-bridge";
import type { DocumentEngineDescriptor } from "@/lib/tauri";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { CompileControls, CompileControlsView } from "./CompileControls";

const copy = enShell.compile;
const setEngine = vi.fn(async (_engine: string, _flavor?: string | null) => {});
const setTypstVersion = vi.fn(async () => {});
const setTypstOptions = vi.fn(async () => {});

const TYPST: DocumentEngineDescriptor = {
  ...LATEX_ENGINE,
  id: "typst",
  label: "Typst",
  source_format: "typst",
  main_document: "main.typ",
  source_extensions: ["typ"],
  capabilities: { ...LATEX_ENGINE.capabilities, formatting_profile: "typst", supports_offline: false },
  typst_resolved: { version: "0.15.1", source: "bundled" },
  typst_options: {
    system_fonts: true,
    reproducible: false,
    variants: [],
    font_dirs: [],
    flags: ["--creation-timestamp", "--font-path", "--ignore-system-fonts", "--input"],
    output_formats: ["pdf"],
    pdf_standards: [],
  },
};

async function openOptions() {
  const user = userEvent.setup();
  await user.click(screen.getByLabelText(copy.options));
  await screen.findByRole("menu");
  return user;
}

function shared(viewer: boolean) {
  useCollabEditorGate.setState({ projectId: "p1", viewer, connecting: false });
}

beforeEach(() => {
  vi.clearAllMocks();
  useFilesStore.setState({
    projectId: "p1",
    engine: LATEX_ENGINE,
    engineLoaded: true,
    mainDoc: "main.tex",
    activePath: "main.tex",
    files: { "main.tex": { content: "hello" } },
    tree: [{ path: "main.tex", is_dir: false }],
    setEngine,
  } as unknown as ReturnType<typeof useFilesStore.getState>);
  useCompileStore.setState({
    status: "idle",
    autoCompile: false,
    compileMode: "normal",
    checkSyntaxBeforeCompile: true,
    stopOnFirstError: false,
    lastCompileCheckpoint: null,
  } as unknown as ReturnType<typeof useCompileStore.getState>);
  useSettingsStore.setState({ viewMode: "editor" });
});

afterEach(() => {
  useCollabEditorGate.setState({ projectId: null, viewer: false, connecting: false });
});

describe("shared compile settings in the compile menu", () => {
  it("lets an editor of a shared project pick the compiler everyone uses", async () => {
    shared(false);
    render(<CompileControls />);
    const user = await openOptions();
    expect(screen.queryByText(copy.sharedViewer)).not.toBeInTheDocument();
    await user.click(screen.getByTestId("compiler-xelatex"));
    expect(setEngine).toHaveBeenCalledWith("latexmk", "xelatex");
  });

  it("keeps the compiler read-only for a viewer of a shared project", async () => {
    shared(true);
    render(<CompileControls />);
    const user = await openOptions();
    expect(screen.getByText(copy.sharedViewer)).toBeInTheDocument();
    for (const id of ["compiler-tectonic", "compiler-auto", "compiler-pdflatex", "compiler-xelatex"]) {
      expect(screen.getByTestId(id)).toHaveAttribute("aria-disabled", "true");
    }
    await user.click(screen.getByTestId("compiler-xelatex"));
    expect(setEngine).not.toHaveBeenCalled();
  });

  it("keeps the Typst version, fonts and build read-only for a viewer", async () => {
    render(
      <CompileControlsView
        engine={TYPST}
        engineLoaded
        setEngine={setEngine}
        recompile={vi.fn()}
        stopCompile={vi.fn(async () => {})}
        autoCompile={false}
        setAutoCompile={vi.fn()}
        compileMode="normal"
        setCompileMode={vi.fn()}
        checkSyntaxBeforeCompile
        setCheckSyntaxBeforeCompile={vi.fn()}
        stopOnFirstError={false}
        setStopOnFirstError={vi.fn()}
        status="idle"
        compileRevision={0}
        setTypstVersion={setTypstVersion}
        setTypstOptions={setTypstOptions}
        sharedSettingsLocked
      />,
    );
    const user = await openOptions();
    expect(screen.getByText(copy.sharedViewer)).toBeInTheDocument();
    for (const id of ["typst-version-default", "typst-system-fonts", "typst-project-fonts", "typst-standard-build", "typst-reproducible"]) {
      expect(screen.getByTestId(id)).toHaveAttribute("aria-disabled", "true");
    }
    await user.click(screen.getByTestId("typst-project-fonts"));
    expect(setTypstOptions).not.toHaveBeenCalled();
  });
});
