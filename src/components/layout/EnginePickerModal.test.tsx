// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useFolderAccessStore } from "@/store/folder-access";
import { useSettingsStore } from "@/store/settings";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  dismissEngineHint: vi.fn(),
  ensureLoaded: vi.fn(async () => {}),
  install: vi.fn(async () => {}),
  recompile: vi.fn(async () => {}),
  setEngine: vi.fn(async (_engine: string, _flavor?: string | null) => {}),
  setShellEscape: vi.fn(async () => {}),
  picker: {
    open: true,
    source: "manual" as "manual" | "compile-failure",
    findings: [] as { id: string; level: string; title: string; detail: string }[],
  },
  files: {
    projectId: "project-1" as string | null,
    engine: {
      id: "latex",
      allow_shell_escape: false,
    },
  },
  engine: {
    info: {
      kind: "system" as const,
      lualatex: "/Library/TeX/texbin/lualatex",
      tlmgr: "/Library/TeX/texbin/tlmgr",
      version: "TeX Live",
      latexmk: "/Library/TeX/texbin/latexmk",
    },
    installing: false,
    installPhase: null,
    progress: null,
    partialDownloadBytes: 0,
  },
}));

vi.mock("@/store/engine-picker", () => ({
  dismissEngineHint: mocks.dismissEngineHint,
  useEnginePickerStore: (selector: (state: unknown) => unknown) =>
    selector({ ...mocks.picker, close: mocks.close }),
}));
vi.mock("@/store/files", () => ({
  engineSwitchToastKey: (projectId: string) => `engine-switch:${projectId}`,
  useFilesStore: Object.assign(
    (selector: (state: unknown) => unknown) =>
      selector({
        ...mocks.files,
        setEngine: mocks.setEngine,
        setShellEscape: mocks.setShellEscape,
      }),
    {
      getState: () => ({
        ...mocks.files,
        setEngine: mocks.setEngine,
        setShellEscape: mocks.setShellEscape,
      }),
    },
  ),
}));
vi.mock("@/store/engine", () => ({
  TINYTEX_INSTALL_TOAST_KEY: "tinytex-install",
  installPhaseLabel: () => "Downloading…",
  useEngineStore: Object.assign(
    (selector: (state: unknown) => unknown) =>
      selector({
        ...mocks.engine,
        ensureLoaded: mocks.ensureLoaded,
        install: mocks.install,
      }),
    {
      getState: () => ({
        ...mocks.engine,
        ensureLoaded: mocks.ensureLoaded,
        install: mocks.install,
      }),
    },
  ),
}));
vi.mock("@oleafly/latex", () => ({
  latexmkFixesFinding: () => false,
  needsPdflatexFinding: (id: string) =>
    ["hyperref-pdftex-driver", "eps-image", "pdftex-only"].includes(id),
  needsShellEscapeFinding: (id: string) => ["minted", "pythontex", "shell-escape"].includes(id),
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), infoUnique: vi.fn(), errorUnique: vi.fn() },
}));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));
vi.mock("@/store/compile", () => ({
  useCompileStore: { getState: () => ({ recompile: mocks.recompile }) },
}));

import { EnginePickerModal } from "./EnginePickerModal";

beforeEach(() => {
  mocks.close.mockClear();
  mocks.ensureLoaded.mockClear();
  mocks.recompile.mockClear();
  mocks.setShellEscape.mockClear();
  mocks.setEngine.mockReset().mockImplementation(async (engine: string) => {
    mocks.files.engine = { ...mocks.files.engine, id: engine };
  });
  mocks.files.projectId = "project-1";
  mocks.files.engine = { id: "latex", allow_shell_escape: false };
  mocks.picker.source = "manual";
  mocks.picker.findings = [];
  document.body.style.pointerEvents = "none";
});

afterEach(() => {
  document.body.style.removeProperty("pointer-events");
});

describe("EnginePickerModal", () => {
  it("remains interactive while a previous dialog releases its body pointer lock", async () => {
    render(<EnginePickerModal />);

    const dialog = screen.getByTestId("engine-picker-modal");
    expect(document.body).toHaveStyle({ pointerEvents: "none" });
    expect(dialog.parentElement).toHaveClass("pointer-events-auto");

    fireEvent.click(screen.getByTestId("engine-picker-use-system"));
    await waitFor(() => expect(mocks.setEngine).toHaveBeenCalledWith("latexmk", null));
  });

  it("pins the pdfLaTeX flavor in one click for a driver or EPS failure", async () => {
    mocks.picker.source = "compile-failure";
    mocks.picker.findings = [
      {
        id: "hyperref-pdftex-driver",
        level: "blocker",
        title: "hyperref is pinned to the pdfTeX driver",
        detail: "detail",
      },
    ];
    render(<EnginePickerModal />);

    const button = screen.getByTestId("engine-picker-use-system");
    expect(button).toHaveTextContent("Switch to pdfLaTeX and recompile");
    fireEvent.click(button);
    await waitFor(() =>
      expect(mocks.setEngine).toHaveBeenCalledWith("latexmk", "pdflatex"),
    );
    await waitFor(() => expect(mocks.close).toHaveBeenCalled());
    await waitFor(() => expect(mocks.recompile).toHaveBeenCalled());
    expect(mocks.files.engine.id).toBe("latexmk");
  });

  it("opens the preview when it recompiles after the switch", async () => {
    useSettingsStore.setState({ viewMode: "editor" });
    mocks.picker.source = "compile-failure";
    render(<EnginePickerModal />);

    fireEvent.click(screen.getByTestId("engine-picker-use-system"));
    await waitFor(() => expect(mocks.recompile).toHaveBeenCalled());
    expect(useSettingsStore.getState().viewMode).toBe("split");
  });

  it("recompiles instead of dead-ending when system LaTeX is already in use", async () => {
    useSettingsStore.setState({ viewMode: "editor" });
    mocks.picker.source = "compile-failure";
    mocks.files.engine = { id: "latexmk", allow_shell_escape: false };
    render(<EnginePickerModal />);

    const button = screen.getByTestId("engine-picker-use-system");
    expect(button).toHaveTextContent(enShell.compile.recompile);
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() => expect(mocks.recompile).toHaveBeenCalledOnce());
    expect(mocks.close).toHaveBeenCalled();
    expect(mocks.setEngine).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().viewMode).toBe("split");
  });

  it("stops before recompiling when the engine did not change", async () => {
    mocks.picker.source = "compile-failure";
    mocks.setEngine.mockImplementation(async () => {});
    render(<EnginePickerModal />);

    fireEvent.click(screen.getByTestId("engine-picker-use-system"));
    await waitFor(() => expect(mocks.setEngine).toHaveBeenCalled());
    expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.recompile).not.toHaveBeenCalled();
  });
});

describe("EnginePickerModal in a folder that is not trusted yet", () => {
  afterEach(() => {
    useFolderAccessStore.getState().reset(null);
  });

  it("explains that system TeX needs trust and holds the switch", () => {
    useFolderAccessStore.getState().reset("project-1");
    useFolderAccessStore.setState({
      loaded: true,
      trust: { trusted: false, source: null, parent: null, repository: null },
    });
    render(<EnginePickerModal />);
    expect(screen.getByTestId("trust-required-notice")).toHaveTextContent(
      "Trust this folder to compile with latexmk.",
    );
    expect(screen.getByTestId("engine-picker-use-system")).toBeDisabled();
    expect(screen.getByTestId("engine-picker-keep-tectonic")).not.toBeDisabled();
  });

  it("only trusts the folder when trust is granted from the dialog", async () => {
    useFolderAccessStore.getState().reset("project-1");
    const grant = vi.fn(async () => {
      useFolderAccessStore.setState({
        trust: { trusted: true, source: "folder", parent: null, repository: null },
      });
      return true;
    });
    useFolderAccessStore.setState({
      loaded: true,
      trust: { trusted: false, source: null, parent: null, repository: null },
      grant,
    });
    mocks.picker.source = "compile-failure";
    mocks.picker.findings = [
      { id: "minted", level: "blocker", title: "minted needs a shell", detail: "why" },
    ];
    render(<EnginePickerModal />);
    fireEvent.click(screen.getByRole("button", { name: enShell.openedFolder.trust.trustFolder }));
    await waitFor(() => expect(screen.getByTestId("engine-picker-use-system")).toBeEnabled());
    expect(grant).toHaveBeenCalledExactlyOnceWith("folder");
    expect(mocks.setEngine).not.toHaveBeenCalled();
    expect(mocks.setShellEscape).not.toHaveBeenCalled();
    expect(mocks.recompile).not.toHaveBeenCalled();
    expect(mocks.close).not.toHaveBeenCalled();
  });
});
