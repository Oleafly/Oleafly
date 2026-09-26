// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enErrors from "@/i18n/locales/en/errors.json" with { type: "json" };
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { LATEX_ENGINE } from "@/lib/document-engine";
import type { FolderDetection } from "@/lib/folder-detection";

const mocks = vi.hoisted(() => ({
  chooseMainDocument: vi.fn(),
  grant: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/store/main-document", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/store/main-document")>()),
  chooseMainDocument: mocks.chooseMainDocument,
}));

import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { useFolderAccessStore } from "@/store/folder-access";
import { useMainDocumentStore } from "@/store/main-document";
import { useSettingsStore } from "@/store/settings";
import { useToastStore } from "@/store/toast";
import { CompileControls } from "./CompileControls";

const labels = enShell.openedFolder;
const recompile = vi.fn(async () => {});

const found: FolderDetection = {
  main: "paper/main.tex",
  decision: "auto",
  source: "scan",
  candidates: [
    {
      path: "paper/main.tex",
      family: "latex",
      tier: "s",
      kind: "document",
      class: "article",
      title: null,
      depth: 1,
      reasons: ["named_main"],
    },
    {
      path: "talk/slides.tex",
      family: "latex",
      tier: "s",
      kind: "presentation",
      class: "beamer",
      title: null,
      depth: 1,
      reasons: [],
    },
    {
      path: "figures/plot.tex",
      family: "latex",
      tier: "w",
      kind: "standalone",
      class: "standalone",
      title: null,
      depth: 1,
      reasons: ["standalone_figure"],
    },
  ],
  truncated: false,
  compile_dir: null,
};

function openFolder(overrides: Record<string, unknown> = {}) {
  useFilesStore.setState({
    projectId: "linked-a",
    manifestHome: "device",
    engine: LATEX_ENGINE,
    engineLoaded: true,
    loading: false,
    mainDoc: "paper/main.tex",
    activePath: null,
    files: {},
    tree: [
      { path: "paper/main.tex", is_dir: false },
      { path: "talk/slides.tex", is_dir: false },
    ],
    ...overrides,
  } as unknown as ReturnType<typeof useFilesStore.getState>);
}

beforeEach(() => {
  recompile.mockClear();
  mocks.chooseMainDocument.mockReset();
  mocks.chooseMainDocument.mockResolvedValue(true);
  mocks.grant.mockReset();
  mocks.grant.mockResolvedValue(true);
  useToastStore.getState().reset();
  openFolder();
  useCompileStore.setState({
    status: "idle",
    lastCompileCheckpoint: null,
    recompile,
  } as unknown as ReturnType<typeof useCompileStore.getState>);
  useSettingsStore.setState({ viewMode: "split" });
  useMainDocumentStore.getState().reset("linked-a");
  useFolderAccessStore.getState().reset("linked-a");
  useFolderAccessStore.setState({
    loaded: true,
    trust: { trusted: true, source: "folder", parent: null, repository: null },
    grant: mocks.grant,
  });
});

afterEach(() => {
  useMainDocumentStore.getState().reset(null);
  useFolderAccessStore.getState().reset(null);
});

describe("compile controls for an opened folder", () => {
  it("names the main document and offers to change it", () => {
    render(<CompileControls />);
    const indicator = screen.getByTestId("main-document-indicator");
    expect(within(indicator).getByText("Main: paper/main.tex")).toBeInTheDocument();
    fireEvent.click(within(indicator).getByRole("button", { name: labels.main.changeLabel }));
    expect(useMainDocumentStore.getState().changing).toBe(true);
  });

  it("keeps the file name of a deep main in view and puts the whole path in the tooltip", async () => {
    const deep = "thesis/chapters/part-one/appendices/final/main.tex";
    openFolder({ mainDoc: deep, tree: [{ path: deep, is_dir: false }] });
    render(<CompileControls />);
    const label = screen.getByTestId("main-document-label");
    expect(label).toHaveTextContent("Main: …/appendices/final/main.tex");
    const user = userEvent.setup();
    await user.hover(label);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(deep);
  });

  it("adds the other documents switcher before the main without moving it", () => {
    render(<CompileControls />);
    const label = screen.getByTestId("main-document-label");
    expect(screen.queryByRole("button", { name: labels.main.others })).not.toBeInTheDocument();
    act(() => useMainDocumentStore.getState().seed("linked-a", found));
    const trigger = screen.getByRole("button", { name: labels.main.others });
    expect(label.compareDocumentPosition(trigger) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(trigger.className).toMatch(/animate-in/);
    expect(trigger.className).toMatch(/motion-reduce:animate-none/);
    expect(screen.getByTestId("main-document-label")).toBe(label);
  });

  it("keeps library projects exactly as they were", () => {
    openFolder({ projectId: "paper", manifestHome: "library" });
    render(<CompileControls />);
    expect(screen.queryByTestId("main-document-indicator")).not.toBeInTheDocument();
    expect(screen.getByTestId("compile-button")).not.toHaveAttribute("aria-disabled");
  });

  it("switches to one of the other documents", async () => {
    useMainDocumentStore.getState().seed("linked-a", found);
    render(<CompileControls />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: labels.main.others }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).queryByText("paper/main.tex")).not.toBeInTheDocument();
    expect(within(menu).queryByText("figures/plot.tex")).not.toBeInTheDocument();
    expect(within(menu).getByText(labels.kind.presentation)).toBeInTheDocument();
    await user.click(within(menu).getByText("talk/slides.tex"));
    await waitFor(() => expect(mocks.chooseMainDocument).toHaveBeenCalledWith("talk/slides.tex"));
  });

  it("reports a refused switch once", async () => {
    mocks.chooseMainDocument.mockRejectedValue(new Error("refused"));
    useMainDocumentStore.getState().seed("linked-a", found);
    render(<CompileControls />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: labels.main.others }));
    await user.click(within(await screen.findByRole("menu")).getByText("talk/slides.tex"));
    await waitFor(() =>
      expect(useToastStore.getState().toasts).toEqual([
        expect.objectContaining({
          kind: "error",
          message: labels.main.switchFailed.replace("{{path}}", "talk/slides.tex"),
        }),
      ]),
    );
  });

  it("hides the switcher when no other document is known", () => {
    render(<CompileControls />);
    expect(screen.queryByRole("button", { name: labels.main.others })).not.toBeInTheDocument();
  });

  it("holds Compile with the reason while the folder has no main document", async () => {
    openFolder({ mainDoc: "main.tex", tree: [{ path: "notes/draft.md", is_dir: false }] });
    render(<CompileControls />);
    expect(screen.queryByTestId("main-document-indicator")).not.toBeInTheDocument();
    const button = screen.getByTestId("compile-button");
    expect(button).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(button);
    expect(recompile).not.toHaveBeenCalled();
    const user = userEvent.setup();
    await user.hover(button);
    expect(await screen.findByText(labels.noMain)).toBeInTheDocument();

    act(() => openFolder({ mainDoc: "notes/draft.md", tree: [{ path: "notes/draft.md", is_dir: false }] }));
    expect(screen.getByTestId("compile-button")).not.toHaveAttribute("aria-disabled");
    fireEvent.click(screen.getByTestId("compile-button"));
    expect(recompile).toHaveBeenCalledTimes(1);
  });

  it("explains that latexmk needs trust and offers it", async () => {
    useFolderAccessStore.setState({
      trust: { trusted: false, source: null, parent: null, repository: null },
    });
    render(<CompileControls />);
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(enShell.compile.options));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByTestId("compiler-lualatex")).toHaveAttribute("aria-disabled", "true");
    expect(within(menu).getByTestId("compiler-auto")).toHaveAttribute("aria-disabled", "true");
    expect(within(menu).getByTestId("compiler-tectonic")).not.toHaveAttribute("aria-disabled");
    await user.click(within(menu).getByText(enErrors.trust.system_tex));
    await waitFor(() => expect(mocks.grant).toHaveBeenCalledWith("folder"));
  });

  it("offers every compiler once the folder is trusted", async () => {
    render(<CompileControls />);
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(enShell.compile.options));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByTestId("compiler-lualatex")).not.toHaveAttribute("aria-disabled");
    expect(within(menu).queryByText(enErrors.trust.system_tex)).not.toBeInTheDocument();
  });
});
