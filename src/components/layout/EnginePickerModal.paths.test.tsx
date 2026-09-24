// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  dismissEngineHint: vi.fn(),
  ensureLoaded: vi.fn(async () => {}),
  install: vi.fn(async () => {}),
  recompile: vi.fn(async () => {}),
  setEngine: vi.fn(async (_engine: string, _flavor?: string | null) => {}),
  setShellEscape: vi.fn(async () => {}),
  logError: vi.fn(),
  success: vi.fn(),
  infoUnique: vi.fn(),
  successUnique: vi.fn(),
  errorUnique: vi.fn(),
  picker: {
    open: true,
    source: "manual" as "manual" | "compile-failure",
    findings: [] as { id: string; level: string; title: string; detail: string }[],
  },
  files: {
    projectId: "project-1" as string | null,
    engine: { id: "latex", allow_shell_escape: false },
  },
  engine: {
    info: { latexmk: "/usr/bin/latexmk" } as { latexmk?: string } | null,
    installing: false,
    installPhase: null,
    progress: null,
    partialDownloadBytes: 0,
  },
  fixes: false,
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
  installPhaseLabel: () => "Downloading",
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
  latexmkFixesFinding: () => mocks.fixes,
  needsPdflatexFinding: (id: string) =>
    ["hyperref-pdftex-driver", "eps-image", "pdftex-only"].includes(id),
}));
vi.mock("@/lib/toast", () => ({
  toast: {
    success: mocks.success,
    infoUnique: mocks.infoUnique,
    successUnique: mocks.successUnique,
    errorUnique: mocks.errorUnique,
  },
}));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));
vi.mock("@/store/compile", () => ({
  useCompileStore: { getState: () => ({ recompile: mocks.recompile }) },
}));

import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { EnginePickerModal } from "./EnginePickerModal";

const copy = enShell.enginePicker;

beforeEach(() => {
  for (const value of Object.values(mocks)) {
    if (typeof value === "function" && "mockClear" in value) value.mockClear();
  }
  mocks.setEngine.mockReset().mockImplementation(async (engine: string) => {
    mocks.files.engine = { ...mocks.files.engine, id: engine };
  });
  mocks.install.mockReset().mockResolvedValue(undefined);
  mocks.setShellEscape.mockReset().mockResolvedValue(undefined);
  mocks.picker.open = true;
  mocks.picker.source = "manual";
  mocks.picker.findings = [];
  mocks.files.projectId = "project-1";
  mocks.files.engine = { id: "latex", allow_shell_escape: false };
  mocks.engine.info = { latexmk: "/usr/bin/latexmk" };
  mocks.engine.installing = false;
  mocks.engine.partialDownloadBytes = 0;
  mocks.fixes = false;
});

describe("EnginePickerModal states", () => {
  it("renders nothing while it is closed", () => {
    mocks.picker.open = false;
    const { container } = render(<EnginePickerModal />);
    expect(container).toBeEmptyDOMElement();
  });

  it("recommends the system TeX it found", () => {
    render(<EnginePickerModal />);
    expect(screen.getByText(copy.titleImportScan)).toBeInTheDocument();
    expect(screen.getByText(copy.descriptionImportScan)).toBeInTheDocument();
    expect(screen.getByText(copy.recommended)).toBeInTheDocument();
    expect(screen.getByText(copy.systemTex.found)).toBeInTheDocument();
    expect(screen.getByText("/usr/bin/latexmk")).toBeInTheDocument();
    expect(screen.queryByText(copy.tinytex.title)).not.toBeInTheDocument();
  });

  it("offers the download when no system TeX is present", async () => {
    mocks.engine.info = null;
    render(<EnginePickerModal />);
    expect(screen.getByText(copy.systemTex.missing)).toBeInTheDocument();
    expect(screen.getByText(copy.tinytex.title)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: copy.tinytex.download }));
    await waitFor(() => expect(mocks.install).toHaveBeenCalled());
    expect(mocks.setEngine).not.toHaveBeenCalled();
  });

  it("offers to resume a partial download", () => {
    mocks.engine.info = null;
    mocks.engine.partialDownloadBytes = 42_000_000;
    render(<EnginePickerModal />);
    expect(
      screen.getByRole("button", {
        name: copy.tinytex.resume.replace("{{megabytes}}", "42"),
      }),
    ).toBeInTheDocument();
  });

  it("pins latexmk once the download produced one", async () => {
    mocks.engine.info = null;
    mocks.install.mockImplementation(async () => {
      mocks.engine.info = { latexmk: "/opt/tinytex/latexmk" };
    });
    render(<EnginePickerModal />);
    fireEvent.click(screen.getByRole("button", { name: copy.tinytex.download }));
    await waitFor(() => expect(mocks.setEngine).toHaveBeenCalledWith("latexmk", null));
    await waitFor(() =>
      expect(mocks.successUnique).toHaveBeenCalledExactlyOnceWith(
        "tinytex-install",
        copy.switchedAfterInstall.replace("{{engine}}", copy.engineNames.latexmk),
      ),
    );
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it("confirms a plain switch with one toast", async () => {
    render(<EnginePickerModal />);
    fireEvent.click(screen.getByTestId("engine-picker-use-system"));
    await waitFor(() =>
      expect(mocks.success).toHaveBeenCalledExactlyOnceWith(
        copy.switched.replace("{{engine}}", copy.engineNames.latexmk),
      ),
    );
    expect(mocks.successUnique).not.toHaveBeenCalled();
    expect(mocks.errorUnique).not.toHaveBeenCalled();
  });

  it("lists the findings that prompted the dialog", () => {
    mocks.picker.source = "compile-failure";
    mocks.fixes = true;
    mocks.picker.findings = [
      { id: "minted", level: "blocker", title: "minted needs a shell", detail: "why" },
    ];
    render(<EnginePickerModal />);
    expect(screen.getByText(copy.titleCompileFailure)).toBeInTheDocument();
    expect(screen.getByText("minted needs a shell")).toBeInTheDocument();
    expect(screen.getByText("why")).toBeInTheDocument();
    expect(screen.getByText(copy.shellEscape.needed)).toBeInTheDocument();
  });

  it("reports a failed switch and restores the consent box", async () => {
    const error = new Error("no engine");
    mocks.setEngine.mockRejectedValue(error);
    render(<EnginePickerModal />);
    fireEvent.click(screen.getByTestId("engine-picker-shell-escape"));
    fireEvent.click(screen.getByTestId("engine-picker-use-system"));
    await waitFor(() =>
      expect(mocks.errorUnique).toHaveBeenCalledExactlyOnceWith(
        "engine-switch:project-1",
        copy.switchFailed,
      ),
    );
    expect(mocks.logError).toHaveBeenCalledWith("switch compile engine", error);
    expect(screen.getByTestId("engine-picker-shell-escape")).not.toBeChecked();
    expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it("names the external command step when only that step of a switch fails", async () => {
    const error = new Error("denied");
    mocks.setShellEscape.mockRejectedValue(error);
    render(<EnginePickerModal />);
    fireEvent.click(screen.getByTestId("engine-picker-shell-escape"));
    fireEvent.click(screen.getByTestId("engine-picker-use-system"));
    await waitFor(() =>
      expect(mocks.errorUnique).toHaveBeenCalledExactlyOnceWith(
        "engine-switch:project-1",
        copy.shellEscapeFailed,
      ),
    );
    expect(mocks.logError).toHaveBeenCalledWith("update external command access", error);
    expect(mocks.setEngine).toHaveBeenCalledWith("latexmk", null);
    expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it("stores the shell escape consent for a latexmk project", async () => {
    mocks.files.engine = { id: "latexmk", allow_shell_escape: false };
    render(<EnginePickerModal />);
    fireEvent.click(screen.getByTestId("engine-picker-shell-escape"));
    await waitFor(() => expect(mocks.setShellEscape).toHaveBeenCalledWith(true));
    await waitFor(() =>
      expect(screen.getByTestId("engine-picker-shell-escape")).not.toBeDisabled(),
    );
    expect(screen.getByTestId("engine-picker-shell-escape")).toBeChecked();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.infoUnique).not.toHaveBeenCalled();
  });

  it("reports a failed shell escape change", async () => {
    mocks.files.engine = { id: "latexmk", allow_shell_escape: false };
    mocks.setShellEscape.mockRejectedValue(new Error("denied"));
    render(<EnginePickerModal />);
    fireEvent.click(screen.getByTestId("engine-picker-shell-escape"));
    await waitFor(() =>
      expect(mocks.errorUnique).toHaveBeenCalledExactlyOnceWith(
        "engine-switch:project-1",
        copy.shellEscapeFailed,
      ),
    );
    expect(mocks.logError).toHaveBeenCalledWith("update external command access", expect.any(Error));
    await waitFor(() =>
      expect(screen.getByTestId("engine-picker-shell-escape")).not.toBeChecked(),
    );
  });

  it("keeps the consent local until latexmk is pinned", async () => {
    render(<EnginePickerModal />);
    fireEvent.click(screen.getByTestId("engine-picker-shell-escape"));
    await waitFor(() =>
      expect(screen.getByTestId("engine-picker-shell-escape")).toBeChecked(),
    );
    expect(mocks.setShellEscape).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("engine-picker-use-system"));
    await waitFor(() => expect(mocks.setShellEscape).toHaveBeenCalledWith(true));
  });

  it("dismisses the hint when the reader keeps Tectonic", async () => {
    render(<EnginePickerModal />);
    fireEvent.click(screen.getByTestId("engine-picker-keep-tectonic"));
    await waitFor(() => expect(mocks.dismissEngineHint).toHaveBeenCalled());
    expect(mocks.close).toHaveBeenCalled();
    expect(mocks.setEngine).not.toHaveBeenCalled();
  });

  it("switches back to Tectonic from a latexmk project", async () => {
    mocks.files.engine = { id: "latexmk", allow_shell_escape: false };
    render(<EnginePickerModal />);
    expect(
      screen.getByRole("button", { name: copy.tectonic.switchBack }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("engine-picker-use-system")).toBeDisabled();
    fireEvent.click(screen.getByTestId("engine-picker-keep-tectonic"));
    await waitFor(() => expect(mocks.setEngine).toHaveBeenCalledWith("xetex"));
  });

  it("reports a failed switch back", async () => {
    mocks.files.engine = { id: "latexmk", allow_shell_escape: false };
    mocks.setEngine.mockRejectedValue(new Error("locked"));
    render(<EnginePickerModal />);
    fireEvent.click(screen.getByTestId("engine-picker-keep-tectonic"));
    await waitFor(() =>
      expect(mocks.errorUnique).toHaveBeenCalledExactlyOnceWith(
        "engine-switch:project-1",
        copy.switchFailed,
      ),
    );
    expect(mocks.logError).toHaveBeenCalledWith("switch compile engine", expect.any(Error));
    expect(mocks.close).toHaveBeenCalled();
  });
});
