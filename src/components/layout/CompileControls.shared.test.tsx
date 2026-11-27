// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { LATEX_ENGINE } from "@/lib/document-engine";
import { useCollabEditorGate, useOverleafFilling } from "@/lib/collab-live-bridge";
import { useCoauthorEdits } from "@/lib/live-file-mirror";
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
  useOverleafFilling.setState({ projectId: null });
});

describe("compiling a project that is still downloading from Overleaf", () => {
  it("keeps Compile off with the reason until every file is here, and only for that project", () => {
    useOverleafFilling.setState({ projectId: "p1" });
    const { rerender } = render(<CompileControls />);
    expect(screen.getByTestId("compile-button")).toHaveAttribute("aria-disabled", "true");
    useOverleafFilling.setState({ projectId: "p2" });
    rerender(<CompileControls />);
    expect(screen.getByTestId("compile-button")).not.toHaveAttribute("aria-disabled");
    useOverleafFilling.setState({ projectId: null });
    rerender(<CompileControls />);
    expect(screen.getByTestId("compile-button")).not.toHaveAttribute("aria-disabled");
    expect(copy.filling).toMatch(/still downloading from Overleaf/);
  });
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

describe("coauthor changes and the compile button", () => {
  afterEach(() => {
    useCoauthorEdits.setState({ projectId: null, path: null, text: null, at: null });
    useCompileStore.setState({ lastCompiledAt: null });
  });

  it("shows a dot once coauthors changed the project after the last compile", () => {
    useCompileStore.setState({ lastCompiledAt: 1_000 });
    useCoauthorEdits.setState({ projectId: "p1", path: "main.tex", text: "theirs", at: 2_000 });
    render(<CompileControls />);
    expect(screen.getByTestId("compile-coauthors-dot")).toBeInTheDocument();
  });

  it.each([
    ["an edit before the last compile", { lastCompiledAt: 3_000, edit: { projectId: "p1", at: 2_000 } }],
    ["another project's edit", { lastCompiledAt: 1_000, edit: { projectId: "p2", at: 2_000 } }],
    ["no compile yet", { lastCompiledAt: null, edit: { projectId: "p1", at: 2_000 } }],
  ] as const)("shows no dot for %s", (_label, { lastCompiledAt, edit }) => {
    useCompileStore.setState({ lastCompiledAt });
    useCoauthorEdits.setState({ ...edit, path: "main.tex", text: "theirs" });
    render(<CompileControls />);
    expect(screen.queryByTestId("compile-coauthors-dot")).toBeNull();
  });
});
