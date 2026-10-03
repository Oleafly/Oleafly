// @vitest-environment jsdom

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  syncTypstLivePreview: vi.fn(),
  stopTypstLivePreview: vi.fn(),
}));

vi.mock("@/features/typst-live-preview", () => ({
  syncLivePreview: vi.fn(async () => {}),
  stopLivePreview: vi.fn(async () => {}),
  interruptLivePreview: vi.fn(async () => {}),
  compileLive: vi.fn(),
}));
vi.mock("@/store/compile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/store/compile")>()),
  syncTypstLivePreview: mocks.syncTypstLivePreview,
  stopTypstLivePreview: mocks.stopTypstLivePreview,
}));

import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { LATEX_ENGINE } from "@/lib/document-engine";
import type { DocumentEngineDescriptor, TypstToolchainStatus } from "@/lib/tauri";
import { useCompileStore, type LivePreviewState } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { usePreviewDetachedStore } from "@/store/preview-detached";
import { useSettingsStore } from "@/store/settings";
import { useTypstToolchainStore } from "@/store/typst-toolchain";
import { CompileControls, CompileControlsView, type CompileControlsViewProps } from "./CompileControls";

const auto = enShell.compile.autoCompile;

function typstEngine(over: Partial<DocumentEngineDescriptor> = {}): DocumentEngineDescriptor {
  return {
    ...LATEX_ENGINE,
    id: "typst",
    label: "Typst",
    source_format: "typst",
    main_document: "main.typ",
    source_extensions: ["typ"],
    capabilities: { ...LATEX_ENGINE.capabilities, formatting_profile: "typst" },
    typst_version: "0.13.1",
    typst_resolved: { version: "0.13.1", source: "downloaded" },
    typst_missing: null,
    ...over,
  };
}

const toolchain: TypstToolchainStatus = {
  bundledVersion: "0.15.1",
  defaultVersion: "0.15.1",
  defaultChoice: null,
  system: null,
  installing: null,
  versions: [
    { version: "0.15.1", releasedAt: null, inCatalog: true, sources: ["bundled"], downloadBytes: null },
    { version: "0.14.2", releasedAt: null, inCatalog: true, sources: ["downloaded"], downloadBytes: null },
    { version: "0.13.1", releasedAt: null, inCatalog: true, sources: ["downloaded"], downloadBytes: null },
  ],
};

const off: LivePreviewState = { projectId: "p1", enabled: false, status: "off", message: null };

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
      setTypstVersion={vi.fn(async () => {})}
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
  localStorage.clear();
});

describe("auto compile drives the Typst watcher", () => {
  it("has no separate live preview group", async () => {
    renderView(typstEngine(), { autoCompile: true, livePreview: { ...off, enabled: true, status: "on" } });
    await openOptions();
    expect(screen.queryByTestId("typst-live-preview")).not.toBeInTheDocument();
    expect(screen.queryByText("Live preview")).not.toBeInTheDocument();
    expect(screen.queryByText("Update the PDF as I type")).not.toBeInTheDocument();
    expect(screen.getAllByRole("menuitemradio", { name: auto.on })).toHaveLength(1);
  });

  it("turns auto compile on for a Typst project", async () => {
    const setAutoCompile = vi.fn();
    renderView(typstEngine(), { livePreview: off, setAutoCompile });
    const user = await openOptions();
    await user.click(screen.getByRole("menuitemradio", { name: auto.on }));
    expect(setAutoCompile).toHaveBeenCalledWith(true);
  });

  it("explains a watcher that gave up under Auto compile", async () => {
    renderView(typstEngine(), {
      autoCompile: true,
      livePreview: { ...off, enabled: true, status: "failed", message: "Typst crashed" },
    });
    await openOptions();
    expect(screen.getByTestId("typst-live-preview-note")).toHaveTextContent(auto.typstFailed);
    expect(screen.getByTestId("typst-live-preview-note")).toHaveAttribute("title", "Typst crashed");
  });

  it("says nothing about the watcher once auto compile is off", async () => {
    renderView(typstEngine(), { livePreview: { ...off, status: "failed", message: "Typst crashed" } });
    await openOptions();
    expect(screen.queryByTestId("typst-live-preview-note")).not.toBeInTheDocument();
  });

  it("stops a running watch cycle from the menu", async () => {
    const stopCompile = vi.fn(async () => {});
    renderView(typstEngine(), {
      autoCompile: true,
      stopCompile,
      livePreview: { ...off, enabled: true, status: "compiling" },
    });
    const user = await openOptions();
    const stop = screen.getByRole("menuitem", { name: enShell.compile.stop });
    expect(stop).not.toHaveAttribute("data-disabled");
    await user.click(stop);
    expect(stopCompile).toHaveBeenCalledOnce();
  });

  it("keeps Stop compilation off while the watcher waits for an edit", async () => {
    renderView(typstEngine(), { autoCompile: true, livePreview: { ...off, enabled: true, status: "on" } });
    await openOptions();
    expect(screen.getByRole("menuitem", { name: enShell.compile.stop })).toHaveAttribute("data-disabled");
  });
});

describe("Typst version group", () => {
  it("leaves version management and the upgrade check to Settings", async () => {
    renderView(typstEngine());
    await openOptions();
    expect(screen.queryByText(/Check this project with Typst/)).not.toBeInTheDocument();
    expect(screen.queryByText("Manage Typst versions")).not.toBeInTheDocument();
    expect(screen.queryByTestId("typst-version-check-newer")).not.toBeInTheDocument();
    expect(screen.queryByTestId("typst-version-manage")).not.toBeInTheDocument();
  });
});

describe("live preview wiring in the main window", () => {
  beforeEach(() => {
    useFilesStore.setState({
      projectId: "p1",
      engine: typstEngine(),
      engineLoaded: true,
      mainDoc: "main.typ",
      activePath: "main.typ",
      files: { "main.typ": { content: "= Hi" } },
      tree: [{ path: "main.typ", is_dir: false }],
    } as unknown as ReturnType<typeof useFilesStore.getState>);
    useCompileStore.setState({ status: "idle", offer: null, recompile: vi.fn(), autoCompile: false, livePreview: off });
    useSettingsStore.setState({ viewMode: "split", settingsOpen: false, settingsScrollTarget: null });
    usePreviewDetachedStore.setState({ projectId: null });
    useTypstToolchainStore.setState({
      status: toolchain,
      refresh: vi.fn(async () => toolchain),
      ensureLoaded: vi.fn(async () => toolchain),
    });
  });

  it("keeps the watcher in step with the open project and stops it on unmount", async () => {
    const { unmount } = render(<CompileControls />);
    await waitFor(() => expect(mocks.syncTypstLivePreview).toHaveBeenCalled());
    unmount();
    expect(mocks.stopTypstLivePreview).toHaveBeenCalled();
  });

  it("syncs the watcher again only when its inputs change", async () => {
    render(<CompileControls />);
    await waitFor(() => expect(mocks.syncTypstLivePreview).toHaveBeenCalled());
    const calls = () => mocks.syncTypstLivePreview.mock.calls.length;
    const before = calls();
    act(() => useFilesStore.setState({ activePath: "other.typ" }));
    expect(calls()).toBe(before);
    act(() => useFilesStore.setState({ projectId: "p2" }));
    expect(calls()).toBe(before + 1);
    act(() => useFilesStore.setState({ engine: typstEngine({ typst_missing: "0.14.2" }) }));
    expect(calls()).toBe(before + 2);
    act(() => useFilesStore.setState({ engineLoaded: false }));
    expect(calls()).toBe(before + 3);
    act(() => useFilesStore.setState({ engine: { ...LATEX_ENGINE } }));
    expect(calls()).toBe(before + 4);
    expect(mocks.stopTypstLivePreview).not.toHaveBeenCalled();
  });

  it("starts the watcher when Auto compile is turned on", async () => {
    render(<CompileControls />);
    const user = await openOptions();
    await user.click(screen.getByRole("menuitemradio", { name: auto.on }));
    expect(useCompileStore.getState().autoCompile).toBe(true);
    expect(useCompileStore.getState().livePreview).toMatchObject({ projectId: "p1", enabled: true });
    expect(localStorage.getItem("oleafly:compile:typst-live:p1")).toBeNull();
  });
});
