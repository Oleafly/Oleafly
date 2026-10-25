// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  installMissingNotebookTool: vi.fn(async () => {}),
}));

vi.mock("@/store/compile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/store/compile")>()),
  installMissingNotebookTool: mocks.installMissingNotebookTool,
}));

import enErrors from "@/i18n/locales/en/errors.json" with { type: "json" };
import enPreview from "@/i18n/locales/en/preview.json" with { type: "json" };
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { APP_ERROR_PREFIX } from "@/lib/app-error";
import { LATEX_ENGINE } from "@/lib/document-engine";
import { formatDownloadSize } from "@/lib/download-size";
import type { NotebookToolchainStatus } from "@/lib/notebook-commands";
import type { DocumentEngineDescriptor, TypstOptionsDescriptor } from "@/lib/tauri";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { QUARTO_SETTINGS_TARGET, useNotebookToolchainStore } from "@/store/notebook-toolchain";
import { usePreviewDetachedStore } from "@/store/preview-detached";
import { useSettingsStore } from "@/store/settings";
import { useToastStore } from "@/store/toast";
import { useTypstToolchainStore } from "@/store/typst-toolchain";
import { CompileControls, CompileControlsView, type CompileControlsViewProps } from "./CompileControls";

const code = enShell.compile.code;
const typEngine = enShell.compile.typEngine;

const typstOptions: TypstOptionsDescriptor = {
  system_fonts: true,
  reproducible: false,
  variants: ["draft"],
  font_dirs: [],
  flags: ["--ignore-system-fonts", "--creation-timestamp"],
  output_formats: ["pdf"],
  pdf_standards: [],
};

function engine(id: "typst" | "calepin" | "quarto", over: Partial<DocumentEngineDescriptor> = {}): DocumentEngineDescriptor {
  return {
    ...LATEX_ENGINE,
    id,
    label: id === "typst" ? "Typst" : id === "calepin" ? "Calepin" : "Quarto",
    source_format: id === "quarto" ? "markdown" : "typst",
    main_document: id === "quarto" ? "report.qmd" : "main.typ",
    source_extensions: id === "quarto" ? ["qmd", "rmd"] : ["typ"],
    capabilities: {
      ...LATEX_ENGINE.capabilities,
      formatting_profile: id === "quarto" ? "markdown" : "typst",
      compiler_prerequisite: id === "typst" ? null : id,
    },
    allow_shell_escape: false,
    typst_version: null,
    typst_resolved: { version: "0.15.1", source: "bundled" },
    typst_missing: null,
    typst_options: typstOptions,
    ...over,
  } as unknown as DocumentEngineDescriptor;
}

const setEngine = vi.fn(async (_engine: string) => {});
const setCodeExecution = vi.fn(async (_allow: boolean) => true);
const setTypstVersion = vi.fn(async (_version: string | null) => {});
const onTrust = vi.fn();

function renderView(current: DocumentEngineDescriptor, over: Partial<CompileControlsViewProps> = {}) {
  return render(
    <CompileControlsView
      engine={current}
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
      setTypstOptions={vi.fn(async () => {})}
      setTypstVariant={vi.fn()}
      setCodeExecution={setCodeExecution}
      onTrustForSystemTex={onTrust}
      {...over}
    />,
  );
}

async function openOptions() {
  const user = userEvent.setup();
  await user.click(screen.getByLabelText(enShell.compile.options));
  await screen.findByRole("menu");
  return user;
}

function noTypstBinaryGroups() {
  expect(screen.queryByTestId("typst-version-default")).not.toBeInTheDocument();
  expect(screen.queryByTestId("typst-system-fonts")).not.toBeInTheDocument();
  expect(screen.queryByTestId("typst-reproducible")).not.toBeInTheDocument();
  expect(screen.queryByTestId("typst-variant-none")).not.toBeInTheDocument();
}

beforeEach(() => {
  vi.clearAllMocks();
  useToastStore.getState().reset();
});

describe("code in the compile menu", () => {
  it("offers code for a Quarto project, off until allowed", async () => {
    renderView(engine("quarto"));
    const user = await openOptions();
    expect(screen.getByText(code.title)).toBeInTheDocument();
    expect(screen.getByTestId("code-execution-off")).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByTestId("typ-engine-typst")).not.toBeInTheDocument();
    noTypstBinaryGroups();
    await user.click(screen.getByTestId("code-execution-run"));
    expect(setCodeExecution).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("turns code off again", async () => {
    renderView(engine("quarto", { allow_shell_escape: true }));
    const user = await openOptions();
    expect(screen.getByTestId("code-execution-run")).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByTestId("code-execution-off"));
    expect(setCodeExecution).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("holds code in a folder that is not trusted and trusts it in one click", async () => {
    renderView(engine("quarto"), { systemTexLocked: true });
    const user = await openOptions();
    expect(screen.getByTestId("code-execution-run")).toHaveAttribute("data-disabled");
    expect(screen.getByTestId("code-execution-trust")).toHaveTextContent(enErrors.trust.notebook);
    await user.click(screen.getByTestId("code-execution-trust"));
    expect(onTrust).toHaveBeenCalledOnce();
    expect(setCodeExecution).not.toHaveBeenCalled();
  });

  it("is not offered for a Typst or LaTeX project", async () => {
    renderView(engine("typst"));
    await openOptions();
    expect(screen.queryByText(code.title)).not.toBeInTheDocument();
  });
});

describe("Typst or Calepin in the compile menu", () => {
  it("switches a Typst document to Calepin", async () => {
    renderView(engine("typst"));
    const user = await openOptions();
    expect(screen.getByText(typEngine.title)).toBeInTheDocument();
    expect(screen.getByTestId("typ-engine-typst")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("typst-version-default")).toBeInTheDocument();
    await user.click(screen.getByTestId("typ-engine-calepin"));
    expect(setEngine).toHaveBeenCalledExactlyOnceWith("calepin");
  });

  it("shows only Calepin's groups for a Calepin document and switches it back", async () => {
    renderView(engine("calepin"));
    const user = await openOptions();
    expect(screen.getByTestId("typ-engine-calepin")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(code.title)).toBeInTheDocument();
    noTypstBinaryGroups();
    await user.click(screen.getByTestId("typ-engine-typst"));
    expect(setEngine).toHaveBeenCalledExactlyOnceWith("typst");
  });

  it("asks for folder trust before Calepin in a folder that is not trusted", async () => {
    renderView(engine("typst"), { systemTexLocked: true });
    const user = await openOptions();
    expect(screen.getByTestId("typ-engine-calepin")).toHaveAttribute("data-disabled");
    await user.click(screen.getByTestId("typ-engine-trust"));
    expect(onTrust).toHaveBeenCalledOnce();
    expect(setEngine).not.toHaveBeenCalled();
  });

  it("keeps a shared project's viewers on its engine", async () => {
    renderView(engine("calepin"), { sharedSettingsLocked: true });
    const user = await openOptions();
    expect(screen.getByTestId("typ-engine-typst")).toHaveAttribute("data-disabled");
    expect(screen.getByText(enShell.compile.sharedViewer)).toBeInTheDocument();
    await user.click(screen.getByTestId("typ-engine-typst"));
    expect(setEngine).not.toHaveBeenCalled();
  });

  it("tells the user once why the switch was refused", async () => {
    useFilesStore.setState({ projectId: "p1" } as unknown as ReturnType<typeof useFilesStore.getState>);
    setEngine.mockRejectedValueOnce(
      `${APP_ERROR_PREFIX}${JSON.stringify({ code: "trust.notebook", params: {}, detail: null })}`,
    );
    renderView(engine("typst"));
    const user = await openOptions();
    await user.click(screen.getByTestId("typ-engine-calepin"));
    await waitFor(() =>
      expect(useToastStore.getState().toasts).toEqual([
        expect.objectContaining({ key: "engine-switch:p1", kind: "error", message: enErrors.trust.notebook }),
      ]),
    );
  });
});

describe("notebook wiring in the main window", () => {
  const setShellEscape = vi.fn(async (_allow: boolean) => {});
  const recompile = vi.fn(async () => undefined);

  function toolchain(installed: boolean): NotebookToolchainStatus {
    const quarto = {
      tool: "quarto" as const,
      pinnedVersion: "1.10.19",
      active: installed ? { path: "/q", version: "1.10.19", source: "managed" as const } : null,
      system: null,
      managed: null,
      offered: true,
      downloadBytes: 128_000_000,
      license: "MIT",
      installing: false,
    };
    return { quarto, calepin: { ...quarto, tool: "calepin", pinnedVersion: "0.0.61" }, runtimes: [] };
  }

  beforeEach(() => {
    setShellEscape.mockClear();
    recompile.mockClear();
    useFilesStore.setState({
      projectId: "p1",
      engine: engine("quarto"),
      engineLoaded: true,
      mainDoc: "report.qmd",
      activePath: "report.qmd",
      files: { "report.qmd": { content: "# Hi" } },
      tree: [{ path: "report.qmd", is_dir: false }],
      setShellEscape,
    } as unknown as ReturnType<typeof useFilesStore.getState>);
    useCompileStore.setState({ status: "idle", offer: null, recompile });
    useSettingsStore.setState({ viewMode: "editor", settingsOpen: false, settingsScrollTarget: null });
    usePreviewDetachedStore.setState({ projectId: null });
    useTypstToolchainStore.setState({ status: null, refresh: vi.fn(async () => null) });
    useNotebookToolchainStore.setState({
      status: toolchain(false),
      loading: false,
      loadFailed: false,
      installs: {},
      removing: null,
      ensureLoaded: vi.fn(async () => toolchain(false)),
    });
  });

  it("allows code through the project setting and compiles again", async () => {
    render(<CompileControls />);
    const user = await openOptions();
    await user.click(screen.getByTestId("code-execution-run"));
    await waitFor(() => expect(recompile).toHaveBeenCalledOnce());
    expect(setShellEscape).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("offers the install and the engine settings next to Compile when Quarto is missing", async () => {
    useCompileStore.setState({
      status: "unavailable",
      offer: { kind: "notebook-tool-missing", projectId: "p1", tool: "quarto" },
    });
    const user = userEvent.setup();
    render(<CompileControls />);
    const install = await screen.findByTestId("toolbar-compile-offer");
    expect(install).toHaveTextContent(
      enPreview.actions.installToolSize
        .replace("{{tool}}", "Quarto")
        .replace("{{version}}", "1.10.19")
        .replace("{{size}}", formatDownloadSize(128_000_000)),
    );
    await user.click(install);
    expect(mocks.installMissingNotebookTool).toHaveBeenCalledExactlyOnceWith("p1", "quarto");
    await user.click(screen.getByTestId("toolbar-compile-offer-settings"));
    expect(useSettingsStore.getState()).toMatchObject({
      settingsOpen: true,
      settingsScrollTarget: QUARTO_SETTINGS_TARGET,
    });
  });

  it("shows the install progress on the offer and holds it", async () => {
    useCompileStore.setState({
      status: "unavailable",
      offer: { kind: "notebook-tool-missing", projectId: "p1", tool: "quarto" },
    });
    useNotebookToolchainStore.setState({
      installs: { quarto: { tool: "quarto", phase: "verifying", receivedBytes: 1, totalBytes: 1 } },
    });
    render(<CompileControls />);
    const install = await screen.findByTestId("toolbar-compile-offer");
    expect(install).toBeDisabled();
    expect(install).toHaveTextContent("Checking");
  });

  it("leaves the offer out for another engine", () => {
    useFilesStore.setState({ engine: engine("calepin") });
    useCompileStore.setState({
      status: "unavailable",
      offer: { kind: "notebook-tool-missing", projectId: "p1", tool: "quarto" },
    });
    render(<CompileControls />);
    expect(screen.queryByTestId("toolbar-compile-offer-settings")).not.toBeInTheDocument();
  });
});
