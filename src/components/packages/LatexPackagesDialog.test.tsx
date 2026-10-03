// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/locales/en/editor.json" with { type: "json" };
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };

const backend = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: backend.invoke }));

const view = vi.hoisted(() => ({ focus: vi.fn() }));
vi.mock("@/components/editor/cm/controller", () => ({ getEditorView: () => view }));

const filesState = vi.hoisted(() => ({
  projectId: "paper" as string | null,
  activePath: "main.tex" as string | null,
  engineLoaded: true,
  engine: { id: "latex" },
}));
vi.mock("@/store/files", () => ({
  useFilesStore: Object.assign(
    (selector: (state: typeof filesState) => unknown) => selector(filesState),
    { getState: () => filesState },
  ),
}));

const settingsState = vi.hoisted(() => ({ offline: false }));
vi.mock("@/store/settings", () => ({
  useSettingsStore: Object.assign(
    (selector: (state: typeof settingsState) => unknown) => selector(settingsState),
    { getState: () => settingsState },
  ),
}));

const engine = vi.hoisted(() => {
  const state = {
    info: { tlmgr: "/tex/bin/tlmgr" } as { tlmgr: string | null } | null,
    loaded: true,
    installed: ["booktabs"] as string[],
    busyPkg: null as string | null,
    packageError: null as { kind: string; name: string; detail: string } | null,
    packageNotice: null as string | null,
    ensureLoaded: vi.fn(async () => {}),
    refreshPackages: vi.fn(async () => {}),
    addPackage: vi.fn(async () => {}),
  };
  return { state };
});
vi.mock("@/store/engine", () => ({
  useEngineStore: Object.assign(
    (selector: (state: typeof engine.state) => unknown) => selector(engine.state),
    { getState: () => engine.state },
  ),
  packageErrorMessage: (error: { name: string }) => `Could not install ${error.name}.`,
}));

const documentApi = vi.hoisted(() => ({
  latexMainDocument: vi.fn(() => "main.tex" as string | null),
  documentPackages: vi.fn(async () => new Set(["amsmath"])),
  insertUsepackage: vi.fn(async () => "editor" as string),
}));
vi.mock("./latex-document", () => documentApi);

const readOnly = vi.hoisted(() => ({ readOnlyEditMessage: vi.fn(() => null as string | null) }));
vi.mock("@/lib/read-only-files", () => readOnly);

const toasts = vi.hoisted(() => ({ toast: { success: vi.fn() } }));
vi.mock("@/lib/toast", () => toasts);

import { resetLatexPackageIndexCache } from "@/lib/latex-package-index";
import { LatexPackagesDialog } from "./LatexPackagesDialog";

const text = en.latexPackages;

const INDEX = {
  source: "ctan",
  fetchedAt: Date.UTC(2026, 9, 1),
  stale: false,
  packages: [
    { name: "amsmath", caption: "AMS mathematical facilities for LaTeX", ctan: true, bundled: true },
    { name: "booktabs", caption: "Publication quality tables in LaTeX", ctan: true, bundled: true },
    { name: "geometry", caption: "Flexible and complete interface to document dimensions", ctan: true, bundled: true },
    { name: "ieeetran", caption: "Document class for IEEE Transactions", ctan: true, bundled: false, documentClass: "IEEEtran" },
  ],
};

function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{{${key}}}`, String(value)),
    template,
  );
}

function row(name: string): HTMLElement {
  return screen.getByTestId(`latex-package-${name}`);
}

function insertButton(name: string): HTMLElement {
  return within(row(name)).getByRole("button", { name: fill(text.insertAria, { name, file: "main.tex" }) });
}

async function openDialog(onClose = vi.fn()) {
  render(<LatexPackagesDialog open onClose={onClose} />);
  await screen.findByText("geometry");
  return onClose;
}

describe("LatexPackagesDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetLatexPackageIndexCache();
    backend.invoke.mockImplementation(async (command: string) => {
      if (command === "latex_package_index") return INDEX;
      throw new Error(`unexpected command ${command}`);
    });
    filesState.engine = { id: "latex" };
    filesState.engineLoaded = true;
    settingsState.offline = false;
    engine.state.info = { tlmgr: "/tex/bin/tlmgr" };
    engine.state.installed = ["booktabs"];
    engine.state.busyPkg = null;
    engine.state.packageError = null;
    engine.state.packageNotice = null;
    documentApi.latexMainDocument.mockReturnValue("main.tex");
    documentApi.documentPackages.mockResolvedValue(new Set(["amsmath"]));
    documentApi.insertUsepackage.mockResolvedValue("editor");
    readOnly.readOnlyEditMessage.mockReturnValue(null);
  });

  it("lists CTAN packages with captions, links and what the document loads", async () => {
    await openDialog();
    expect(backend.invoke).toHaveBeenCalledWith("latex_package_index", { offline: false, refresh: false });
    expect(screen.getByText(fill(text.results_other, { count: 4 }))).toBeInTheDocument();
    expect(within(row("booktabs")).getByText("Publication quality tables in LaTeX")).toBeInTheDocument();
    expect(within(row("booktabs")).getByRole("link", { name: fill(text.ctanAria, { name: "booktabs" }) })).toHaveAttribute(
      "href",
      "https://ctan.org/pkg/booktabs",
    );
    expect(await within(row("amsmath")).findByText(text.loaded)).toBeInTheDocument();
    expect(insertButton("amsmath")).toBeDisabled();
    expect(insertButton("booktabs")).toBeEnabled();
    expect(documentApi.documentPackages).toHaveBeenCalledWith("main.tex");

    fireEvent.change(screen.getByLabelText(text.searchLabel), { target: { value: "tables" } });
    expect(screen.queryByTestId("latex-package-geometry")).not.toBeInTheDocument();
    expect(screen.getByText(fill(text.results_one, { count: 1 }))).toBeInTheDocument();
  });

  it("says Tectonic needs no installs", async () => {
    await openDialog();
    expect(screen.getByText(text.onDemand)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: fill(text.installAria, { name: "geometry" }) })).not.toBeInTheDocument();
    expect(engine.state.refreshPackages).not.toHaveBeenCalled();
  });

  it("shows tlmgr's install state for latexmk and installs through it", async () => {
    filesState.engine = { id: "latexmk" };
    await openDialog();
    await waitFor(() => expect(engine.state.refreshPackages).toHaveBeenCalled());
    expect(await within(row("booktabs")).findByText(text.installed)).toBeInTheDocument();
    const install = within(row("geometry")).getByRole("button", { name: fill(text.installAria, { name: "geometry" }) });
    expect(screen.queryByText(text.checking)).not.toBeInTheDocument();
    fireEvent.click(install);
    expect(engine.state.addPackage).toHaveBeenCalledWith("geometry");
    expect(within(row("booktabs")).queryByRole("button", { name: fill(text.installAria, { name: "booktabs" }) })).toBeNull();
  });

  it("explains when latexmk has no tlmgr to ask", async () => {
    filesState.engine = { id: "latexmk" };
    engine.state.info = { tlmgr: null };
    await openDialog();
    expect(screen.getByText(text.unknownInstall)).toBeInTheDocument();
    expect(screen.queryByText(text.installed)).not.toBeInTheDocument();
    expect(engine.state.refreshPackages).not.toHaveBeenCalled();
  });

  it("adds the package with its options through the editor and closes", async () => {
    const onClose = await openDialog();
    fireEvent.change(within(row("geometry")).getByLabelText(fill(text.optionsAria, { name: "geometry" })), {
      target: { value: " margin=1in " },
    });
    fireEvent.click(insertButton("geometry"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(documentApi.insertUsepackage).toHaveBeenCalledWith("main.tex", "geometry", "margin=1in");
    await waitFor(() => expect(view.focus).toHaveBeenCalled());
    expect(toasts.toast.success).not.toHaveBeenCalled();
  });

  it("confirms a change to a main file that is not on screen", async () => {
    documentApi.insertUsepackage.mockResolvedValue("file");
    const onClose = await openDialog();
    fireEvent.click(insertButton("booktabs"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toasts.toast.success).toHaveBeenCalledWith(fill(text.added, { name: "booktabs", file: "main.tex" }));
  });

  it("explains a main file without a preamble", async () => {
    documentApi.insertUsepackage.mockResolvedValue("no-preamble");
    const onClose = await openDialog();
    fireEvent.click(insertButton("booktabs"));
    expect(await screen.findByRole("alert")).toHaveTextContent(fill(text.noPreamble, { file: "main.tex" }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("refuses options that would break the line", async () => {
    await openDialog();
    fireEvent.change(within(row("geometry")).getByLabelText(fill(text.optionsAria, { name: "geometry" })), {
      target: { value: "margin=1in]" },
    });
    expect(insertButton("geometry")).toBeDisabled();
    expect(within(row("geometry")).getByText(text.optionsInvalid)).toBeInTheDocument();
  });

  it("copies the document class line for a class instead of adding it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    await openDialog();
    expect(within(row("ieeetran")).getByText(text.documentClass)).toBeInTheDocument();
    expect(insertButton("ieeetran")).toBeDisabled();
    expect(within(row("ieeetran")).getByText(text.classNote)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(row("ieeetran")).getByRole("button", { name: fill(text.copyAria, { name: "ieeetran" }) }));
    });
    expect(writeText).toHaveBeenCalledWith("\\documentclass{IEEEtran}");
    expect(within(row("ieeetran")).getByText(enCommon.actions.copied)).toBeInTheDocument();
  });

  it("blocks adding to a read-only main file", async () => {
    readOnly.readOnlyEditMessage.mockReturnValue("main.tex is read-only.");
    await openDialog();
    expect(screen.getByText("main.tex is read-only.")).toBeInTheDocument();
    expect(insertButton("booktabs")).toBeDisabled();
  });

  it("says when the list is the built-in one", async () => {
    settingsState.offline = true;
    backend.invoke.mockResolvedValue({ ...INDEX, source: "bundled", fetchedAt: null });
    await openDialog();
    expect(backend.invoke).toHaveBeenCalledWith("latex_package_index", { offline: true, refresh: false });
    expect(screen.getByText(text.partialOffline)).toBeInTheDocument();
  });
});
