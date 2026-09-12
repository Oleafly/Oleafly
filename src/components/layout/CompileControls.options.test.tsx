// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { LATEX_ENGINE } from "@/lib/document-engine";
import { CompileControls } from "./CompileControls";

const copy = enShell.compile;

const recompile = vi.fn(async () => {});
const stopCompile = vi.fn(async () => {});
const setEngine = vi.fn(async () => {});

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
});
