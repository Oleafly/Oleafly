// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  dismissEngineHint: vi.fn(),
  ensureLoaded: vi.fn(async () => {}),
  install: vi.fn(async () => {}),
  setEngine: vi.fn(async () => {}),
  setShellEscape: vi.fn(async () => {}),
  picker: {
    open: true,
    source: "project-open" as const,
    findings: [],
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
}));
vi.mock("@/lib/toast", () => ({
  notifyError: vi.fn(),
  toast: { success: vi.fn() },
}));

import { EnginePickerModal } from "./EnginePickerModal";

beforeEach(() => {
  mocks.close.mockClear();
  mocks.ensureLoaded.mockClear();
  mocks.setEngine.mockClear();
  mocks.setShellEscape.mockClear();
  mocks.files.projectId = "project-1";
  mocks.files.engine = { id: "latex", allow_shell_escape: false };
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
    await waitFor(() => expect(mocks.setEngine).toHaveBeenCalledWith("latexmk"));
  });
});
