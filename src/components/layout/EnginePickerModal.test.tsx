// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

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
    source: "project-open" as "project-open" | "compile-failure",
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
}));
vi.mock("@/lib/toast", () => ({
  notifyError: vi.fn(),
  toast: { success: vi.fn() },
}));
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
  mocks.picker.source = "project-open";
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
