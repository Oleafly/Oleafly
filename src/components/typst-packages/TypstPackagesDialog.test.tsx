// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import en from "@/i18n/locales/en/editor.json" with { type: "json" };
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };

const backend = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: backend.invoke }));

const editor = vi.hoisted(() => {
  const view = {
    state: null as unknown as import("@codemirror/state").EditorState,
    dispatch: (spec: Parameters<import("@codemirror/state").EditorState["update"]>[0]) => {
      view.state = view.state.update(spec).state;
    },
    focus: vi.fn(),
  };
  return { view, getEditorView: vi.fn(() => view) };
});
vi.mock("@/components/editor/cm/controller", () => ({ getEditorView: editor.getEditorView }));

const filesState = vi.hoisted(() => ({
  projectId: "paper" as string | null,
  activePath: "main.typ" as string | null,
  engine: { id: "typst", typst_resolved: { version: "0.13.1", source: "bundled" } },
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

import { resetUniverseIndexCache, type UniversePackage } from "@/lib/typst-universe";
import { showTypstPackagesDialog, TypstPackagesDialog } from "./TypstPackagesDialog";

const text = en.typstPackages;

function universePackage(overrides: Partial<UniversePackage> & { name: string }): UniversePackage {
  return {
    version: "1.0.0",
    versions: ["1.0.0"],
    description: "",
    authors: [],
    license: null,
    keywords: [],
    categories: [],
    disciplines: [],
    compiler: null,
    template: false,
    updatedAt: null,
    homepage: null,
    ...overrides,
  };
}

const INDEX = {
  fetchedAt: Date.UTC(2026, 8, 30),
  stale: false,
  packages: [
    universePackage({
      name: "cetz",
      version: "0.5.2",
      description: "Drawing with Typst made easy",
      keywords: ["draw"],
      categories: ["visualization"],
      compiler: "0.14.0",
    }),
    universePackage({
      name: "tablex",
      version: "0.0.9",
      description: "More powerful tables",
      categories: ["layout"],
    }),
  ],
};

type Handler = (args: Record<string, unknown>) => unknown;

function backendWith(overrides: Record<string, Handler> = {}) {
  const handlers: Record<string, Handler> = {
    typst_universe_index: () => INDEX,
    typst_package_settings: () => ({ vendorPackages: false, vendored: [] }),
    set_typst_vendor_packages: () => ({}),
    vendor_typst_packages: () => ({
      report: { vendored: ["@preview/cetz:0.5.2"], unchanged: [], missing: [] },
      project: {},
    }),
    ...overrides,
  };
  backend.invoke.mockImplementation(async (command: string, args: Record<string, unknown>) => {
    const handler = handlers[command];
    if (!handler) throw new Error(`unexpected command ${command}`);
    return handler(args);
  });
}

function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{{${key}}}`, String(value)),
    template,
  );
}

async function openDialog(onClose = vi.fn()) {
  render(<TypstPackagesDialog open onClose={onClose} />);
  await screen.findByText("cetz");
  return onClose;
}

function row(name: string): HTMLElement {
  return screen.getByTestId(`typst-package-${name}`);
}

describe("TypstPackagesDialog", () => {
  beforeEach(() => {
    resetUniverseIndexCache();
    backend.invoke.mockReset();
    backendWith();
    editor.view.state = EditorState.create({ doc: "= Title\n" });
    editor.view.focus.mockReset();
    editor.getEditorView.mockImplementation(() => editor.view);
    filesState.activePath = "main.typ";
    settingsState.offline = false;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists packages and narrows them by search and category", async () => {
    await openDialog();
    expect(backend.invoke).toHaveBeenCalledWith("typst_universe_index", { offline: false, refresh: false });
    expect(screen.getByText(fill(text.results_other, { count: 2 }))).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(text.searchLabel), { target: { value: "draw" } });
    expect(screen.queryByText("tablex")).not.toBeInTheDocument();
    expect(screen.getByText(fill(text.results_one, { count: 1 }))).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(text.searchLabel), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "layout" }));
    expect(screen.getByText("tablex")).toBeInTheDocument();
    expect(screen.queryByText("cetz")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: text.allCategories }));
    expect(screen.getByText("cetz")).toBeInTheDocument();
  });

  it("warns when a package needs a newer Typst than the project uses", async () => {
    await openDialog();
    expect(
      within(row("cetz")).getByText(fill(text.needsTypst, { version: "0.14.0", current: "0.13.1" })),
    ).toBeInTheDocument();
    expect(within(row("tablex")).queryByText(/Needs Typst/)).not.toBeInTheDocument();
  });

  it("inserts the import at the top of the open Typst file and closes", async () => {
    const onClose = await openDialog();
    fireEvent.click(within(row("cetz")).getByRole("button", { name: fill(text.insertAria, { name: "cetz" }) }));
    expect(editor.view.state.doc.toString()).toBe('#import "@preview/cetz:0.5.2": *\n= Title\n');
    expect(onClose).toHaveBeenCalled();
    await waitFor(() => expect(editor.view.focus).toHaveBeenCalled());
  });

  it("only copies when no Typst file is open", async () => {
    filesState.activePath = "refs.bib";
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    await openDialog();
    const insert = within(row("cetz")).getByRole("button", { name: fill(text.insertAria, { name: "cetz" }) });
    expect(insert).toBeDisabled();
    expect(screen.getAllByText(text.insertNeedsFile).length).toBeGreaterThan(0);
    await act(async () => {
      fireEvent.click(within(row("cetz")).getByRole("button", { name: fill(text.copyAria, { name: "cetz" }) }));
    });
    expect(writeText).toHaveBeenCalledWith('#import "@preview/cetz:0.5.2": *');
    expect(within(row("cetz")).getByText(enCommon.actions.copied)).toBeInTheDocument();
  });

  it("shows an old list with a note when offline", async () => {
    settingsState.offline = true;
    backendWith({ typst_universe_index: () => ({ ...INDEX, stale: true }) });
    await openDialog();
    expect(backend.invoke).toHaveBeenCalledWith("typst_universe_index", { offline: true, refresh: false });
    expect(screen.getByText(/You're offline\. This list is from/)).toBeInTheDocument();
  });

  it("reports a list that cannot load and retries on request", async () => {
    let calls = 0;
    backendWith({
      typst_universe_index: () => {
        calls += 1;
        if (calls === 1) throw new Error("The list is unavailable.");
        return INDEX;
      },
    });
    render(<TypstPackagesDialog open onClose={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("The list is unavailable.");
    fireEvent.click(screen.getByRole("button", { name: enCommon.actions.retry }));
    expect(await screen.findByText("cetz")).toBeInTheDocument();
    expect(backend.invoke).toHaveBeenLastCalledWith("typst_universe_index", { offline: false, refresh: true });
  });

  it("turns vendoring on and copies the project's packages into it", async () => {
    await openDialog();
    const toggle = await screen.findByRole("switch", { name: text.vendor.toggle });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(text.vendor.none)).toBeInTheDocument();

    backendWith({
      set_typst_vendor_packages: () => ({}),
      typst_package_settings: () => ({ vendorPackages: true, vendored: [] }),
    });
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(backend.invoke).toHaveBeenCalledWith("set_typst_vendor_packages", { projectId: "paper", enabled: true }),
    );
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));

    backendWith({
      typst_package_settings: () => ({ vendorPackages: true, vendored: ["@preview/cetz:0.5.2"] }),
    });
    fireEvent.click(screen.getByRole("button", { name: text.vendor.action }));
    expect(await screen.findByText(fill(text.vendor.copied_one, { count: 1 }))).toBeInTheDocument();
    expect(backend.invoke).toHaveBeenCalledWith("vendor_typst_packages", { projectId: "paper", offline: false });
    expect(await screen.findByText(fill(text.vendor.count_one, { count: 1 }))).toBeInTheDocument();
  });

  it("names the packages that could not be vendored", async () => {
    backendWith({
      vendor_typst_packages: () => ({
        report: { vendored: [], unchanged: ["@preview/cetz:0.5.2"], missing: ["@preview/absent:1.0.0"] },
        project: {},
      }),
    });
    await openDialog();
    await screen.findByRole("switch", { name: text.vendor.toggle });
    fireEvent.click(screen.getByRole("button", { name: text.vendor.action }));
    expect(
      await screen.findByText(fill(text.vendor.missing, { names: "@preview/absent:1.0.0" })),
    ).toBeInTheDocument();
  });

  it("marks templates and says when every package is already vendored", async () => {
    backendWith({
      typst_universe_index: () => ({
        ...INDEX,
        packages: [...INDEX.packages, universePackage({ name: "charged-ieee", template: true })],
      }),
      vendor_typst_packages: () => ({
        report: { vendored: [], unchanged: ["@preview/cetz:0.5.2"], missing: [] },
        project: {},
      }),
    });
    await openDialog();

    expect(within(row("charged-ieee")).getByText(text.template)).toBeInTheDocument();
    expect(within(row("cetz")).queryByText(text.template)).toBeNull();
    await screen.findByRole("switch", { name: text.vendor.toggle });
    fireEvent.click(screen.getByRole("button", { name: text.vendor.action }));
    expect(await screen.findByText(text.vendor.upToDate)).toBeInTheDocument();
  });

  it("reports vendoring failures", async () => {
    backendWith({
      typst_package_settings: () => {
        throw new Error("settings unreadable");
      },
    });
    await openDialog();
    expect(await screen.findByRole("alert")).toHaveTextContent("settings unreadable");

    backendWith({
      typst_package_settings: () => ({ vendorPackages: false, vendored: [] }),
      vendor_typst_packages: () => {
        throw new Error("cache missing");
      },
    });
    fireEvent.click(screen.getByRole("button", { name: text.vendor.action }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("cache missing"));
  });

  it("reports a failed vendoring switch", async () => {
    backendWith({
      set_typst_vendor_packages: () => {
        throw new Error("folder is read-only");
      },
    });
    await openDialog();
    const toggle = await screen.findByRole("switch", { name: text.vendor.toggle });
    await waitFor(() => expect(toggle).toBeEnabled());

    fireEvent.click(toggle);

    expect(await screen.findByRole("alert")).toHaveTextContent("folder is read-only");
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("leaves out the vendoring section without a project", async () => {
    filesState.projectId = null;
    await openDialog();

    expect(screen.queryByRole("switch", { name: text.vendor.toggle })).toBeNull();
    filesState.projectId = "paper";
  });

  it("keeps the dialog open when no editor is available to insert into", async () => {
    editor.getEditorView.mockImplementation(() => null as never);
    const onClose = await openDialog();

    fireEvent.click(within(row("tablex")).getByRole("button", { name: fill(text.insertAria, { name: "tablex" }) }));

    expect(onClose).not.toHaveBeenCalled();
  });

  it("says when nothing matches and dates a stale list", async () => {
    backendWith({ typst_universe_index: () => ({ ...INDEX, stale: true }) });
    await openDialog();

    expect(screen.getByText(/It couldn't be refreshed\./)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(text.searchLabel), { target: { value: "zzzz-no-such" } });
    expect(screen.getByText(text.empty)).toBeInTheDocument();
  });

  it("opens from anywhere as a shared dialog", async () => {
    showTypstPackagesDialog();

    expect(await screen.findByRole("dialog", { name: text.title })).toBeInTheDocument();
    expect(await screen.findByText("tablex")).toBeInTheDocument();
  });
});
