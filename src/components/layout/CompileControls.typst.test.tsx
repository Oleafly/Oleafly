// @vitest-environment jsdom

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  downloadMissingTypst: vi.fn(async () => {}),
  switchToDefaultTypst: vi.fn(async () => {}),
}));

vi.mock("@/store/compile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/store/compile")>()),
  downloadMissingTypst: mocks.downloadMissingTypst,
  switchToDefaultTypst: mocks.switchToDefaultTypst,
}));

import enPreview from "@/i18n/locales/en/preview.json" with { type: "json" };
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { LATEX_ENGINE } from "@/lib/document-engine";
import type { DocumentEngineDescriptor, TypstToolchainStatus } from "@/lib/tauri";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { usePreviewDetachedStore } from "@/store/preview-detached";
import { useSettingsStore } from "@/store/settings";
import { useTypstToolchainStore } from "@/store/typst-toolchain";
import { CompileControls, CompileControlsView, type CompileControlsViewProps } from "./CompileControls";

const copy = enShell.compile.typstVersion;

function typstEngine(over: Partial<DocumentEngineDescriptor> = {}): DocumentEngineDescriptor {
  return {
    ...LATEX_ENGINE,
    id: "typst",
    label: "Typst",
    source_format: "typst",
    main_document: "main.typ",
    source_extensions: ["typ"],
    capabilities: { ...LATEX_ENGINE.capabilities, formatting_profile: "typst", supports_offline: false },
    typst_version: null,
    typst_resolved: { version: "0.15.1", source: "bundled" },
    typst_missing: null,
    ...over,
  };
}

const toolchain: TypstToolchainStatus = {
  bundledVersion: "0.15.1",
  defaultVersion: "0.15.1",
  defaultChoice: null,
  system: { version: "0.13.1", path: "/opt/homebrew/bin/typst" },
  installing: null,
  versions: [
    { version: "0.15.1", releasedAt: "2026-08-01", inCatalog: true, sources: ["bundled"], downloadBytes: 10_000_000 },
    { version: "0.14.2", releasedAt: "2026-03-01", inCatalog: true, sources: ["downloaded"], downloadBytes: 9_000_000 },
    { version: "0.14.0", releasedAt: "2026-01-01", inCatalog: true, sources: [], downloadBytes: 9_000_000 },
    { version: "0.13.1", releasedAt: "2025-03-07", inCatalog: true, sources: ["system"], downloadBytes: 8_000_000 },
  ],
};

const setTypstVersion = vi.fn(async (_version: string | null) => {});

function renderView(engine: DocumentEngineDescriptor, over: Partial<CompileControlsViewProps> = {}) {
  return render(
    <CompileControlsView
      engine={engine}
      engineLoaded
      setEngine={vi.fn(async () => {})}
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
      typstToolchain={toolchain}
      setTypstVersion={setTypstVersion}
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

beforeEach(() => {
  vi.clearAllMocks();
  useTypstToolchainStore.setState({
    status: toolchain,
    loading: false,
    loadFailed: false,
    install: null,
    busy: false,
    refresh: vi.fn(async () => toolchain),
    ensureLoaded: vi.fn(async () => toolchain),
  });
});

describe("Typst version in the compile menu", () => {
  it("is not offered for a LaTeX project", async () => {
    renderView(LATEX_ENGINE);
    await openOptions();
    expect(screen.queryByText(copy.title)).not.toBeInTheDocument();
    expect(screen.queryByTestId("typst-version-default")).not.toBeInTheDocument();
  });

  it("lists the default and every installed version with its source", async () => {
    renderView(typstEngine());
    await openOptions();
    expect(screen.getByText(copy.title)).toBeInTheDocument();
    const fallback = screen.getByTestId("typst-version-default");
    expect(fallback).toHaveTextContent(copy.default.replace("{{version}}", "0.15.1"));
    expect(fallback).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("typst-version-0.15.1")).toHaveTextContent(copy.builtIn);
    expect(screen.getByTestId("typst-version-0.14.2")).not.toHaveTextContent("[");
    expect(screen.getByTestId("typst-version-0.13.1")).toHaveTextContent(copy.system);
    expect(screen.queryByTestId("typst-version-0.14.0")).not.toBeInTheDocument();
  });

  it("pins the chosen version", async () => {
    renderView(typstEngine());
    const user = await openOptions();
    await user.click(screen.getByTestId("typst-version-0.14.2"));
    expect(setTypstVersion).toHaveBeenCalledExactlyOnceWith("0.14.2");
  });

  it("clears the pin when Default is chosen", async () => {
    renderView(typstEngine({ typst_version: "0.14.2", typst_resolved: { version: "0.14.2", source: "downloaded" } }));
    const user = await openOptions();
    expect(screen.getByTestId("typst-version-0.14.2")).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByTestId("typst-version-default"));
    expect(setTypstVersion).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("ignores a choice that is already in effect", async () => {
    renderView(typstEngine({ typst_version: "0.14.2" }));
    const user = await openOptions();
    await user.click(screen.getByTestId("typst-version-0.14.2"));
    expect(setTypstVersion).not.toHaveBeenCalled();
  });

  it("shows a pinned version that is not installed", async () => {
    renderView(typstEngine({ typst_version: "0.12.0", typst_resolved: null, typst_missing: "0.12.0" }));
    await openOptions();
    const pinned = screen.getByTestId("typst-version-0.12.0");
    expect(pinned).toHaveTextContent(copy.missing);
    expect(pinned).toHaveAttribute("aria-checked", "true");
  });

  it("names the default plainly before the versions load", async () => {
    renderView(typstEngine(), { typstToolchain: null });
    await openOptions();
    expect(screen.getByTestId("typst-version-default")).toHaveTextContent(copy.defaultPlain);
  });

  it("holds only version choices and points to Settings for the rest", async () => {
    renderView(typstEngine());
    await openOptions();
    expect(screen.queryByText("Manage Typst versions")).not.toBeInTheDocument();
    expect(screen.queryByTestId("typst-version-manage")).not.toBeInTheDocument();
    expect(copy.help).toContain("Settings → Engines → Typst");
  });
});

describe("Typst version wiring in the main window", () => {
  beforeEach(() => {
    useFilesStore.setState({
      projectId: "p1",
      engine: typstEngine(),
      engineLoaded: true,
      mainDoc: "main.typ",
      activePath: "main.typ",
      files: { "main.typ": { content: "= Hi" } },
      tree: [{ path: "main.typ", is_dir: false }],
      setTypstVersion,
    } as unknown as ReturnType<typeof useFilesStore.getState>);
    useCompileStore.setState({ status: "idle", offer: null, recompile: vi.fn() });
    useSettingsStore.setState({ viewMode: "split", settingsOpen: false, settingsScrollTarget: null });
    usePreviewDetachedStore.setState({ projectId: null });
  });

  it("reads the versions and pins through the files store", async () => {
    render(<CompileControls />);
    await waitFor(() => expect(useTypstToolchainStore.getState().refresh).toHaveBeenCalled());
    const user = await openOptions();
    await user.click(screen.getByTestId("typst-version-0.13.1"));
    expect(setTypstVersion).toHaveBeenCalledExactlyOnceWith("0.13.1");
  });
});

describe("missing Typst version offer", () => {
  beforeEach(() => {
    useFilesStore.setState({
      projectId: "p1",
      engine: typstEngine({ typst_version: "0.14.0", typst_resolved: null, typst_missing: "0.14.0" }),
      engineLoaded: true,
      setTypstVersion,
    } as unknown as ReturnType<typeof useFilesStore.getState>);
    useCompileStore.setState({ status: "unavailable", offer: null, recompile: vi.fn() });
    useSettingsStore.setState({ viewMode: "editor" });
    usePreviewDetachedStore.setState({ projectId: null });
  });

  it("offers the download and the default version next to Compile", async () => {
    const user = userEvent.setup();
    render(<CompileControls />);
    const download = screen.getByTestId("toolbar-compile-offer");
    expect(download).toHaveTextContent(enPreview.actions.downloadTypst.replace("{{version}}", "0.14.0"));
    const fallback = screen.getByTestId("toolbar-compile-offer-default");
    expect(fallback).toHaveTextContent(enPreview.actions.useTypst.replace("{{version}}", "0.15.1"));
    await user.click(download);
    expect(mocks.downloadMissingTypst).toHaveBeenCalledExactlyOnceWith("p1", "0.14.0");
    await user.click(fallback);
    expect(mocks.switchToDefaultTypst).toHaveBeenCalledExactlyOnceWith("p1");
  });

  it("shows the download progress inline and holds both actions", () => {
    useTypstToolchainStore.setState({
      install: { version: "0.14.0", phase: "downloading", receivedBytes: 30, totalBytes: 100 },
    });
    render(<CompileControls />);
    const download = screen.getByTestId("toolbar-compile-offer");
    expect(download).toHaveTextContent(enSettings.engine.typst.progress.downloading.replace("{{percent}}", "30"));
    expect(download).toBeDisabled();
    expect(screen.getByTestId("toolbar-compile-offer-default")).toBeDisabled();
  });

  it("takes the version from a failed compile when the descriptor still looks installed", () => {
    useFilesStore.setState({ engine: typstEngine({ typst_version: "0.14.0" }) });
    useCompileStore.setState({ offer: { kind: "typst-version-missing", projectId: "p1", version: "0.14.0" } });
    render(<CompileControls />);
    expect(screen.getByTestId("toolbar-compile-offer")).toHaveTextContent(
      enPreview.actions.downloadTypst.replace("{{version}}", "0.14.0"),
    );
  });

  it("does not offer a download Oleafly cannot make", () => {
    useFilesStore.setState({
      engine: typstEngine({ typst_version: "0.11.0-rc1", typst_resolved: null, typst_missing: "0.11.0-rc1" }),
    });
    render(<CompileControls />);
    expect(screen.queryByTestId("toolbar-compile-offer")).not.toBeInTheDocument();
    expect(screen.getByTestId("toolbar-compile-offer-default")).toBeInTheDocument();
  });

  it("stays out of a LaTeX project", () => {
    useFilesStore.setState({ engine: LATEX_ENGINE });
    useCompileStore.setState({ offer: { kind: "typst-version-missing", projectId: "p1", version: "0.14.0" } });
    const { container } = render(<CompileControls />);
    expect(within(container).queryByTestId("toolbar-compile-offer")).not.toBeInTheDocument();
  });
});
