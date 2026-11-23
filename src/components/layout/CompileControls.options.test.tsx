// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { useCompileStore } from "@/store/compile";
import { useCompileRootStore } from "@/store/compile-root";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { useToastStore } from "@/store/toast";
import { LATEX_ENGINE } from "@/lib/document-engine";
import { CompileControls } from "./CompileControls";

const copy = enShell.compile;

const recompile = vi.fn(async () => {});
const stopCompile = vi.fn(async () => {});
const setEngine = vi.fn(async (_engine: string, _flavor?: string | null) => {});
const SYSTEM_TEX = { ...LATEX_ENGINE, id: "latexmk", tex_flavor: null };

async function openOptions() {
  const user = userEvent.setup();
  await user.click(screen.getByLabelText(copy.options));
  await screen.findByRole("menu");
  return user;
}

beforeEach(() => {
  recompile.mockClear();
  stopCompile.mockClear();
  setEngine.mockClear();
  useToastStore.getState().reset();
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
    recompile,
    stopCompile,
  } as unknown as ReturnType<typeof useCompileStore.getState>);
  useSettingsStore.setState({ viewMode: "editor" });
  useCompileRootStore.setState({ followOpenFile: true, latexUnits: null });
});

describe("CompileControls button", () => {
  it("reveals the preview pane when a compile starts from editor-only", async () => {
    render(<CompileControls />);
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(copy.compile));
    expect(useSettingsStore.getState().viewMode).toBe("split");
    expect(recompile).toHaveBeenCalled();
  });

  it("renames itself once a compile has produced a result", () => {
    useCompileStore.setState({ status: "success" });
    render(<CompileControls />);
    expect(screen.getByLabelText(copy.recompile)).toBeInTheDocument();
  });

  it("disables itself while a compile runs", () => {
    useCompileStore.setState({ status: "compiling" });
    render(<CompileControls />);
    expect(screen.getByTestId("compile-button")).toBeDisabled();
    expect(screen.getByTestId("compile-options-button")).toBeEnabled();
  });

  it("disables both halves before the engine resolves", () => {
    useFilesStore.setState({ engineLoaded: false });
    render(<CompileControls />);
    expect(screen.getByTestId("compile-button")).toBeDisabled();
    expect(screen.getByTestId("compile-options-button")).toBeDisabled();
  });
});

describe("CompileControls colours", () => {
  it("keeps white text on both halves when hovered or open in the light theme", () => {
    render(<CompileControls />);
    for (const id of ["compile-button", "compile-options-button"]) {
      const button = screen.getByTestId(id);
      expect(button).toHaveClass("text-white", "hover:text-white");
      expect(button).not.toHaveClass("hover:text-accent-foreground");
    }
    expect(screen.getByTestId("compile-options-button")).toHaveClass("data-[state=open]:text-white");
  });
});

describe("CompileControls options menu", () => {
  it("labels every preference group", async () => {
    render(<CompileControls />);
    await openOptions();
    for (const label of [
      copy.autoCompile.title,
      copy.mode.title,
      copy.syntax.title,
      copy.compiler.title,
      copy.errors.title,
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("turns auto compile on", async () => {
    render(<CompileControls />);
    const user = await openOptions();
    await user.click(screen.getByRole("menuitemradio", { name: copy.autoCompile.on }));
    await waitFor(() => expect(useCompileStore.getState().autoCompile).toBe(true));
  });

  it("switches to the fast compile mode", async () => {
    render(<CompileControls />);
    const user = await openOptions();
    await user.click(
      screen.getByRole("menuitemradio", { name: new RegExp(copy.mode.fast.split("<")[0].trim()) }),
    );
    await waitFor(() => expect(useCompileStore.getState().compileMode).toBe("fast"));
  });

  it("skips the syntax check", async () => {
    render(<CompileControls />);
    const user = await openOptions();
    await user.click(screen.getByRole("menuitemradio", { name: copy.syntax.skip }));
    await waitFor(() =>
      expect(useCompileStore.getState().checkSyntaxBeforeCompile).toBe(false),
    );
  });

  it("stops on the first error", async () => {
    render(<CompileControls />);
    const user = await openOptions();
    await user.click(screen.getByRole("menuitemradio", { name: copy.errors.stop }));
    await waitFor(() => expect(useCompileStore.getState().stopOnFirstError).toBe(true));
  });

  it("pins a compiler flavor through latexmk", async () => {
    render(<CompileControls />);
    const user = await openOptions();
    await user.click(screen.getByTestId("compiler-lualatex"));
    await waitFor(() => expect(setEngine).toHaveBeenCalledWith("latexmk", "lualatex"));
  });

  it("pins upLaTeX and pLaTeX for Japanese documents", async () => {
    render(<CompileControls />);
    const user = await openOptions();
    await user.click(screen.getByTestId("compiler-uplatex"));
    await waitFor(() => expect(setEngine).toHaveBeenCalledWith("latexmk", "uplatex"));
    setEngine.mockClear();
    const again = await openOptions();
    await again.click(screen.getByTestId("compiler-platex"));
    await waitFor(() => expect(setEngine).toHaveBeenCalledWith("latexmk", "platex"));
  });

  it("lets latexmk pick the compiler", async () => {
    useFilesStore.setState({
      engine: { ...LATEX_ENGINE, id: "latexmk", tex_flavor: "xelatex" },
    } as unknown as ReturnType<typeof useFilesStore.getState>);
    render(<CompileControls />);
    const user = await openOptions();
    await user.click(screen.getByTestId("compiler-auto"));
    await waitFor(() => expect(setEngine).toHaveBeenCalledWith("latexmk", null));
  });

  it("switches back to the bundled engine", async () => {
    useFilesStore.setState({
      engine: { ...LATEX_ENGINE, id: "latexmk", tex_flavor: null },
    } as unknown as ReturnType<typeof useFilesStore.getState>);
    render(<CompileControls />);
    const user = await openOptions();
    await user.click(screen.getByTestId("compiler-tectonic"));
    await waitFor(() => expect(setEngine).toHaveBeenCalledWith("xetex"));
  });

  it("tells the user once when the compiler switch is refused", async () => {
    setEngine.mockRejectedValue(new Error("latexmk is not installed"));
    render(<CompileControls />);
    const user = await openOptions();
    await user.click(screen.getByTestId("compiler-lualatex"));
    await waitFor(() =>
      expect(useToastStore.getState().toasts).toEqual([
        expect.objectContaining({
          key: "engine-switch:p1",
          kind: "error",
          message: enShell.enginePicker.switchFailed,
        }),
      ]),
    );
  });

  it("says why when a read-only folder refuses the compiler switch", async () => {
    setEngine.mockRejectedValue(`@oleafly/error:${JSON.stringify({
      code: "project.folder_read_only",
      params: { name: "project.json" },
      detail: null,
    })}`);
    render(<CompileControls />);
    const user = await openOptions();
    await user.click(screen.getByTestId("compiler-lualatex"));
    await waitFor(() =>
      expect(useToastStore.getState().toasts).toEqual([
        expect.objectContaining({
          key: "engine-switch:p1",
          kind: "error",
          message: "Oleafly can't make this change because project.json or its folder is read-only. Copy the folder you opened into your library and edit it there.",
        }),
      ]),
    );
  });

  it("ignores a choice that is already in effect", async () => {
    render(<CompileControls />);
    const user = await openOptions();
    await user.click(screen.getByTestId("compiler-tectonic"));
    expect(setEngine).not.toHaveBeenCalled();
  });

  it("hides the compiler group for a non-LaTeX engine", async () => {
    useFilesStore.setState({
      engine: { ...LATEX_ENGINE, id: "typst", source_format: "typst" },
    } as unknown as ReturnType<typeof useFilesStore.getState>);
    render(<CompileControls />);
    await openOptions();
    expect(screen.queryByText(copy.compiler.title)).not.toBeInTheDocument();
  });

  it("hides the LaTeX-only options for a Typst project", async () => {
    useFilesStore.setState({
      engine: {
        ...LATEX_ENGINE,
        id: "typst",
        label: "Typst",
        source_format: "typst",
        capabilities: { ...LATEX_ENGINE.capabilities, formatting_profile: "typst", supports_offline: false },
      },
    } as unknown as ReturnType<typeof useFilesStore.getState>);
    render(<CompileControls />);
    await openOptions();
    expect(screen.getByText(copy.autoCompile.title)).toBeInTheDocument();
    expect(screen.queryByText(copy.mode.title)).not.toBeInTheDocument();
    expect(screen.queryByText(copy.syntax.title)).not.toBeInTheDocument();
    expect(screen.queryByText(copy.errors.title)).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: copy.fromScratch })).toBeInTheDocument();
  });

  it("hides the LaTeX-only options for a Markdown project", async () => {
    useFilesStore.setState({
      engine: {
        ...LATEX_ENGINE,
        id: "markdown",
        label: "Markdown / Pandoc",
        source_format: "markdown",
        capabilities: {
          ...LATEX_ENGINE.capabilities,
          formatting_profile: "markdown",
          supports_offline: false,
          compiler_prerequisite: "pandoc",
        },
      },
    } as unknown as ReturnType<typeof useFilesStore.getState>);
    render(<CompileControls />);
    await openOptions();
    expect(screen.queryByText(copy.mode.title)).not.toBeInTheDocument();
    expect(screen.queryByText(copy.syntax.title)).not.toBeInTheDocument();
    expect(screen.queryByText(copy.errors.title)).not.toBeInTheDocument();
  });

  it("drops only the draft mode for latexmk, which picks its own passes", async () => {
    useFilesStore.setState({
      engine: { ...LATEX_ENGINE, id: "latexmk", tex_flavor: null },
    } as unknown as ReturnType<typeof useFilesStore.getState>);
    render(<CompileControls />);
    await openOptions();
    expect(screen.queryByText(copy.mode.title)).not.toBeInTheDocument();
    expect(screen.getByText(copy.syntax.title)).toBeInTheDocument();
    expect(screen.getByText(copy.errors.title)).toBeInTheDocument();
  });

  it("stops a running compile from the menu", async () => {
    useCompileStore.setState({ status: "compiling" });
    render(<CompileControls />);
    const user = await openOptions();
    await user.click(screen.getByRole("menuitem", { name: copy.stop }));
    await waitFor(() => expect(stopCompile).toHaveBeenCalled());
  });

  it("recompiles from scratch and reveals the preview", async () => {
    render(<CompileControls />);
    const user = await openOptions();
    await user.click(screen.getByRole("menuitem", { name: copy.fromScratch }));
    await waitFor(() =>
      expect(recompile).toHaveBeenCalledWith({ fromScratch: true }),
    );
    expect(useSettingsStore.getState().viewMode).toBe("split");
  });
});

describe("CompileControls external commands", () => {
  it("keeps the external commands switch out of the menu", async () => {
    useFilesStore.setState({
      engine: SYSTEM_TEX,
    } as unknown as ReturnType<typeof useFilesStore.getState>);
    render(<CompileControls />);
    await openOptions();
    expect(screen.queryByRole("menuitemcheckbox")).not.toBeInTheDocument();
  });
});

describe("CompileControls TeX root indicator", () => {
  it("says nothing while the stored main document is in effect", () => {
    render(<CompileControls />);
    expect(screen.queryByTestId("tex-root-indicator")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tex-root-broken")).not.toBeInTheDocument();
  });

  it("names the document a root comment redirects to", () => {
    useFilesStore.setState({
      activePath: "chapter.tex",
      files: {
        "chapter.tex": { content: "% !TEX root = main.tex\n" },
        "main.tex": { content: "" },
      },
      tree: [
        { path: "chapter.tex", is_dir: false },
        { path: "main.tex", is_dir: false },
      ],
    } as unknown as ReturnType<typeof useFilesStore.getState>);
    render(<CompileControls />);
    expect(screen.getByTestId("tex-root-indicator")).toHaveTextContent(
      copy.texRootName.replace("{{name}}", "main.tex"),
    );
  });

  it("warns when the root comment points nowhere", () => {
    useFilesStore.setState({
      activePath: "chapter.tex",
      files: { "chapter.tex": { content: "% !TEX root = missing.tex\n" } },
      tree: [{ path: "chapter.tex", is_dir: false }],
    } as unknown as ReturnType<typeof useFilesStore.getState>);
    render(<CompileControls />);
    expect(screen.getByTestId("tex-root-broken")).toHaveTextContent(
      copy.texRootLabel,
    );
  });

  it("warns when the root comment points at a file LaTeX can't compile", async () => {
    useFilesStore.setState({
      activePath: "chapter.tex",
      files: { "chapter.tex": { content: "% !TEX root = notes.md\n" } },
      tree: [
        { path: "chapter.tex", is_dir: false },
        { path: "notes.md", is_dir: false },
      ],
    } as unknown as ReturnType<typeof useFilesStore.getState>);
    render(<CompileControls />);
    const user = userEvent.setup();
    await user.hover(screen.getByTestId("tex-root-broken"));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      copy.texRootNotTex.replace("{{file}}", "chapter.tex").replace("{{target}}", "notes.md"),
    );
  });

  it("says when the open file compiles because it has its own \\documentclass", async () => {
    const letter = "\\documentclass{letter}\n\\begin{document}\n\\end{document}\n";
    useFilesStore.setState({
      activePath: "response.tex",
      openTabs: ["response.tex"],
      files: { "response.tex": { content: letter }, "main.tex": { content: "" } },
      tree: [
        { path: "response.tex", is_dir: false },
        { path: "main.tex", is_dir: false },
      ],
    } as unknown as ReturnType<typeof useFilesStore.getState>);
    render(<CompileControls />);
    const user = userEvent.setup();
    await user.hover(screen.getByTestId("tex-root-indicator"));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      copy.texRootDocument.replace("{{path}}", "response.tex"),
    );
  });

  it("names the document that includes the open file", async () => {
    useFilesStore.setState({
      activePath: "supplement/methods.tex",
      files: { "supplement/methods.tex": { content: "\\section{Methods}\n" } },
      tree: [
        { path: "supplement/methods.tex", is_dir: false },
        { path: "supplement.tex", is_dir: false },
        { path: "main.tex", is_dir: false },
      ],
    } as unknown as ReturnType<typeof useFilesStore.getState>);
    useCompileRootStore.setState({
      latexUnits: {
        projectId: "p1",
        units: { roots: ["main.tex", "supplement.tex"], groups: [[1]], fileGroups: { "supplement/methods.tex": 0 }, openUnits: [] },
      },
    });
    render(<CompileControls />);
    expect(screen.getByTestId("tex-root-indicator")).toHaveTextContent(
      copy.texRootName.replace("{{name}}", "supplement.tex"),
    );
    const user = userEvent.setup();
    await user.hover(screen.getByTestId("tex-root-indicator"));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      copy.texRootInclude.replace("{{path}}", "supplement.tex").replace("{{file}}", "supplement/methods.tex"),
    );
  });
});

describe("CompileControls compile target", () => {
  it("switches between following the open file and the main document", async () => {
    const letter = "\\documentclass{letter}\n\\begin{document}\n\\end{document}\n";
    useFilesStore.setState({
      activePath: "response.tex",
      files: { "response.tex": { content: letter } },
      tree: [
        { path: "response.tex", is_dir: false },
        { path: "main.tex", is_dir: false },
      ],
    } as unknown as ReturnType<typeof useFilesStore.getState>);
    render(<CompileControls />);
    expect(screen.getByTestId("tex-root-indicator")).toBeInTheDocument();
    const user = await openOptions();
    expect(screen.getByTestId("compile-target-open")).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByTestId("compile-target-main"));
    expect(useCompileRootStore.getState().followOpenFile).toBe(false);
    await waitFor(() => expect(screen.queryByTestId("tex-root-indicator")).not.toBeInTheDocument());
  });

  it("is offered in every format, with a way to change the main document", async () => {
    useFilesStore.setState({
      engine: { ...LATEX_ENGINE, id: "typst", source_format: "typst" },
    } as unknown as ReturnType<typeof useFilesStore.getState>);
    render(<CompileControls />);
    await openOptions();
    expect(screen.getByTestId("compile-target-open")).toBeInTheDocument();
    expect(screen.getByTestId("compile-change-main")).toHaveTextContent(copy.target.change);
  });

  it("names the format when a document in another format is the compile root", async () => {
    useFilesStore.setState({
      mainDoc: "main.tex",
      activePath: "notes/meeting.md",
      openTabs: ["notes/meeting.md"],
      files: { "notes/meeting.md": { content: "# Meeting\n" } },
      tree: [
        { path: "main.tex", is_dir: false },
        { path: "notes/meeting.md", is_dir: false },
      ],
    } as unknown as ReturnType<typeof useFilesStore.getState>);
    render(<CompileControls />);
    expect(screen.getByTestId("tex-root-indicator")).toHaveTextContent(
      copy.texRootName.replace("{{name}}", "meeting.md"),
    );
    await userEvent.setup().hover(screen.getByTestId("tex-root-indicator"));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      copy.texRootFormat.replace("{{path}}", "notes/meeting.md").replace("{{format}}", "Markdown"),
    );
  });
});
