// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enErrors from "@/i18n/locales/en/errors.json" with { type: "json" };
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { LATEX_ENGINE } from "@/lib/document-engine";

const mocks = vi.hoisted(() => ({
  grant: vi.fn(),
}));

import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { useFolderAccessStore } from "@/store/folder-access";
import { useSettingsStore } from "@/store/settings";
import { CompileControls } from "./CompileControls";

const labels = enShell.openedFolder;
const recompile = vi.fn(async () => {});

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
  mocks.grant.mockReset();
  mocks.grant.mockResolvedValue(true);
  openFolder();
  useCompileStore.setState({
    status: "idle",
    lastCompileCheckpoint: null,
    recompile,
  } as unknown as ReturnType<typeof useCompileStore.getState>);
  useSettingsStore.setState({ viewMode: "split" });
  useFolderAccessStore.getState().reset("linked-a");
  useFolderAccessStore.setState({
    loaded: true,
    trust: { trusted: true, source: "folder", parent: null, repository: null },
    grant: mocks.grant,
  });
});

afterEach(() => {
  useFolderAccessStore.getState().reset(null);
});

describe("compile controls for an opened folder", () => {
  it("leaves the main document and its switcher out of the compile controls", () => {
    render(<CompileControls />);
    expect(screen.queryByText(/paper\/main\.tex/)).not.toBeInTheDocument();
    expect(screen.queryByText(/talk\/slides\.tex/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
      enShell.compile.compile,
      enShell.compile.options,
    ]);
  });

  it("keeps library projects exactly as they were", () => {
    openFolder({ projectId: "paper", manifestHome: "library" });
    render(<CompileControls />);
    expect(screen.getByTestId("compile-button")).not.toHaveAttribute("aria-disabled");
  });

  it("holds Compile with the reason while the folder has no main document", async () => {
    openFolder({ mainDoc: "main.tex", tree: [{ path: "notes/draft.md", is_dir: false }] });
    render(<CompileControls />);
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
