// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  dismissEngineHint: vi.fn(),
  ensureLoaded: vi.fn(async () => {}),
  install: vi.fn(async () => {}),
  queueCompileAfterInstall: vi.fn(),
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
    source: "manual" as "manual" | "compile-failure" | "tex-missing",
    findings: [] as { id: string; level: string; title: string; detail: string }[],
  },
  files: {
    projectId: "project-1" as string | null,
    engine: { id: "latex", allow_shell_escape: false },
  },
  engine: {
    info: { latexmk: "/usr/bin/latexmk" } as {
      latexmk?: string;
      latexmk_blocker?: { code: string; params: Record<string, string> };
    } | null,
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
        queueCompileAfterInstall: mocks.queueCompileAfterInstall,
      }),
    },
  ),
}));
vi.mock("@oleafly/latex", () => ({
  IMPORT_COMPAT_CATALOG: {},
  latexmkFixesFinding: () => mocks.fixes,
  needsPdflatexFinding: (id: string) =>
    ["hyperref-pdftex-driver", "eps-image", "pdftex-only"].includes(id),
  needsShellEscapeFinding: (id: string) => ["minted", "pythontex", "shell-escape"].includes(id),
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

import enErrors from "@/i18n/locales/en/errors.json" with { type: "json" };
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { APP_ERROR_PREFIX } from "@/lib/app-error";
import { EnginePickerModal } from "./EnginePickerModal";
import { texDistributionNames } from "@/lib/tex-distributions";

const copy = enShell.enginePicker;
const missingTex = () =>
  copy.systemTex.missing.replace(
    "{{names}}",
    new Intl.ListFormat("en", { type: "disjunction" }).format(texDistributionNames()),
  );
const declined = `${APP_ERROR_PREFIX}${JSON.stringify({
  code: "project.shell_escape_declined",
  params: {},
  detail: null,
})}`;

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
    expect(screen.getByText(missingTex())).toBeInTheDocument();
    expect(screen.getByText(copy.tinytex.title)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: copy.tinytex.download }));
    await waitFor(() => expect(mocks.install).toHaveBeenCalled());
    expect(mocks.setEngine).not.toHaveBeenCalled();
  });

  it("recommends TinyTeX first and drops the system button it can't use without TeX", () => {
    mocks.engine.info = null;
    mocks.picker.source = "compile-failure";
    mocks.picker.findings = [{ id: "pdftex-only", level: "blocker", title: "pdfTeX packages", detail: "why" }];
    render(<EnginePickerModal />);
    const download = screen.getByTestId("engine-picker-download-tinytex");
    expect(download).toHaveTextContent(copy.tinytex.download);
    expect(download).toBeEnabled();
    expect(download).toHaveAttribute("data-modal-initial-focus");
    expect(screen.queryByTestId("engine-picker-use-system")).toBeNull();
    expect(screen.getByText(copy.systemTex.titlePdflatex)).toBeInTheDocument();
    const badge = screen.getByText(copy.recommended);
    const tinytexTitle = screen.getByText(copy.tinytex.title);
    expect(tinytexTitle.parentElement).toContainElement(badge);
    expect(
      tinytexTitle.compareDocumentPosition(screen.getByText(copy.systemTex.titlePdflatex)) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("holds the TinyTeX button while an install is already running", () => {
    mocks.engine.info = null;
    mocks.engine.installing = true;
    render(<EnginePickerModal />);
    expect(screen.getByTestId("engine-picker-download-tinytex")).toBeDisabled();
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

  it("lists the findings and says the switch also allows external commands", () => {
    mocks.picker.source = "compile-failure";
    mocks.fixes = true;
    mocks.picker.findings = [{ id: "minted", level: "blocker", title: "minted needs a shell", detail: "why" }];
    render(<EnginePickerModal />);
    expect(screen.getByText(copy.titleCompileFailure)).toBeInTheDocument();
    expect(screen.getByText(copy.descriptionCompileFailure)).toBeInTheDocument();
    expect(screen.getByText("minted needs a shell")).toBeInTheDocument();
    expect(screen.getByText("why")).toBeInTheDocument();
    expect(screen.getByText(copy.shellEscape.included)).toBeInTheDocument();
    expect(screen.queryByTestId("engine-picker-shell-escape")).toBeNull();
    expect(screen.getByText(copy.tectonic.withFailures_one)).toBeInTheDocument();
  });

  it("says the listed problems stay on Tectonic without naming each one", () => {
    mocks.picker.source = "compile-failure";
    mocks.fixes = true;
    mocks.picker.findings = [
      { id: "cjk-pdftex-package", level: "blocker", title: "CJKutf8 needs pdfLaTeX", detail: "why" },
      { id: "biblatex-biber", level: "warning", title: "Bibliography uses biblatex and Biber", detail: "why" },
    ];
    render(<EnginePickerModal />);
    expect(screen.getByText(copy.tectonic.withFailures_other)).toBeInTheDocument();
    expect(screen.queryByText(/is expected to keep failing|are expected to keep failing/)).toBeNull();
  });

  it("allows external commands with the switch when the project needs them", async () => {
    mocks.picker.source = "compile-failure";
    mocks.picker.findings = [{ id: "minted", level: "blocker", title: "minted needs a shell", detail: "why" }];
    render(<EnginePickerModal />);
    fireEvent.click(screen.getByTestId("engine-picker-use-system"));
    await waitFor(() => expect(mocks.recompile).toHaveBeenCalledOnce());
    expect(mocks.setEngine).toHaveBeenCalledWith("latexmk", null);
    expect(mocks.setShellEscape).toHaveBeenCalledExactlyOnceWith(true);
    expect(mocks.close).toHaveBeenCalled();
  });

  it("leaves external commands off when nothing in the project needs them", async () => {
    render(<EnginePickerModal />);
    expect(screen.queryByText(copy.shellEscape.included)).toBeNull();
    fireEvent.click(screen.getByTestId("engine-picker-use-system"));
    await waitFor(() => expect(mocks.close).toHaveBeenCalled());
    expect(mocks.setEngine).toHaveBeenCalledWith("latexmk", null);
    expect(mocks.setShellEscape).not.toHaveBeenCalled();
  });

  it("reports a failed switch and keeps the dialog open", async () => {
    const error = new Error("no engine");
    mocks.setEngine.mockRejectedValue(error);
    mocks.picker.findings = [{ id: "minted", level: "blocker", title: "minted needs a shell", detail: "why" }];
    render(<EnginePickerModal />);
    fireEvent.click(screen.getByTestId("engine-picker-use-system"));
    await waitFor(() =>
      expect(mocks.errorUnique).toHaveBeenCalledExactlyOnceWith(
        "engine-switch:project-1",
        copy.switchFailed,
      ),
    );
    expect(mocks.logError).toHaveBeenCalledWith("switch compile engine", error);
    expect(mocks.setShellEscape).not.toHaveBeenCalled();
    expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it("names the external command step when only that step of a switch fails", async () => {
    const error = new Error("denied");
    mocks.setShellEscape.mockRejectedValue(error);
    mocks.picker.findings = [{ id: "minted", level: "blocker", title: "minted needs a shell", detail: "why" }];
    render(<EnginePickerModal />);
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

  it("keeps the switch but skips the compile when the person cancels the shared project warning", async () => {
    mocks.setShellEscape.mockRejectedValue(declined);
    mocks.picker.source = "compile-failure";
    mocks.picker.findings = [{ id: "minted", level: "blocker", title: "minted needs a shell", detail: "why" }];
    render(<EnginePickerModal />);
    fireEvent.click(screen.getByTestId("engine-picker-use-system"));
    await waitFor(() => expect(mocks.close).toHaveBeenCalled());
    expect(mocks.setEngine).toHaveBeenCalledWith("latexmk", null);
    expect(mocks.setShellEscape).toHaveBeenCalledExactlyOnceWith(true);
    expect(mocks.success).toHaveBeenCalledExactlyOnceWith(
      copy.switched.replace("{{engine}}", copy.engineNames.latexmk),
    );
    expect(mocks.errorUnique).not.toHaveBeenCalled();
    expect(mocks.logError).not.toHaveBeenCalled();
    expect(mocks.recompile).not.toHaveBeenCalled();
  });

  it("stays open without an error when the person cancels the warning before a recompile", async () => {
    mocks.files.engine = { id: "latexmk", allow_shell_escape: false };
    mocks.picker.source = "compile-failure";
    mocks.picker.findings = [{ id: "minted", level: "blocker", title: "minted needs a shell", detail: "why" }];
    mocks.setShellEscape.mockRejectedValue(declined);
    render(<EnginePickerModal />);
    fireEvent.click(screen.getByTestId("engine-picker-use-system"));
    await waitFor(() => expect(mocks.setShellEscape).toHaveBeenCalledExactlyOnceWith(true));
    await waitFor(() => expect(screen.getByTestId("engine-picker-use-system")).toBeEnabled());
    expect(mocks.errorUnique).not.toHaveBeenCalled();
    expect(mocks.logError).not.toHaveBeenCalled();
    expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.recompile).not.toHaveBeenCalled();
  });

  it("allows external commands before recompiling a latexmk project that needs them", async () => {
    mocks.files.engine = { id: "latexmk", allow_shell_escape: false };
    mocks.picker.source = "compile-failure";
    mocks.picker.findings = [{ id: "minted", level: "blocker", title: "minted needs a shell", detail: "why" }];
    render(<EnginePickerModal />);
    fireEvent.click(screen.getByTestId("engine-picker-use-system"));
    await waitFor(() => expect(mocks.recompile).toHaveBeenCalledOnce());
    expect(mocks.setShellEscape).toHaveBeenCalledExactlyOnceWith(true);
    expect(mocks.setEngine).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalled();
  });

  it("stays open when external commands cannot be allowed before a recompile", async () => {
    mocks.files.engine = { id: "latexmk", allow_shell_escape: false };
    mocks.picker.findings = [{ id: "minted", level: "blocker", title: "minted needs a shell", detail: "why" }];
    mocks.setShellEscape.mockRejectedValue(new Error("denied"));
    render(<EnginePickerModal />);
    fireEvent.click(screen.getByTestId("engine-picker-use-system"));
    await waitFor(() =>
      expect(mocks.errorUnique).toHaveBeenCalledExactlyOnceWith(
        "engine-switch:project-1",
        copy.shellEscapeFailed,
      ),
    );
    expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.recompile).not.toHaveBeenCalled();
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
    expect(screen.getByTestId("engine-picker-use-system")).toHaveTextContent(enShell.compile.recompile);
    fireEvent.click(screen.getByTestId("engine-picker-keep-tectonic"));
    await waitFor(() => expect(mocks.setEngine).toHaveBeenCalledWith("xetex"));
  });

  it("says why when a read-only folder refuses the switch", async () => {
    mocks.setEngine.mockRejectedValue(`@oleafly/error:${JSON.stringify({
      code: "project.folder_read_only",
      params: { name: "project.json" },
      detail: null,
    })}`);
    render(<EnginePickerModal />);
    fireEvent.click(screen.getByTestId("engine-picker-use-system"));
    await waitFor(() =>
      expect(mocks.errorUnique).toHaveBeenCalledExactlyOnceWith(
        "engine-switch:project-1",
        "Oleafly can't make this change because project.json or its folder is read-only. Copy the folder you opened into your library and edit it there.",
      ),
    );
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

describe("EnginePickerModal with TeX that can't run latexmk", () => {
  const needsPerl = { code: "tex.latexmk_needs_perl", params: {} };

  it("treats a blocked latexmk as missing and explains why", () => {
    mocks.picker.source = "tex-missing";
    mocks.files.engine = { id: "latexmk", allow_shell_escape: false };
    mocks.engine.info = { latexmk: "C:/MiKTeX/bin/latexmk.exe", latexmk_blocker: needsPerl };
    render(<EnginePickerModal />);

    expect(screen.getByText(copy.titleTexMissing)).toBeInTheDocument();
    expect(screen.getByText(copy.descriptionTexMissing)).toBeInTheDocument();
    expect(screen.getByText(enErrors.tex.latexmk_needs_perl)).toBeInTheDocument();
    expect(screen.queryByTestId("engine-picker-use-system")).toBeNull();
    expect(screen.getByText(copy.tinytex.title).parentElement).toContainElement(
      screen.getByText(copy.recommended),
    );
  });

  it("names the folder when TeX has no latexmk, and keeps the plain text when there is no TeX", () => {
    mocks.engine.info = {
      latexmk_blocker: {
        code: "tex.latexmk_not_in_distribution_command",
        params: { binDir: "/usr/bin", command: "sudo apt install latexmk" },
      },
    };
    const { unmount } = render(<EnginePickerModal />);
    expect(screen.getByText(/sudo apt install latexmk/)).toBeInTheDocument();
    unmount();

    mocks.engine.info = { latexmk_blocker: { code: "tex.latexmk_missing", params: {} } };
    render(<EnginePickerModal />);
    expect(screen.getByText(missingTex())).toBeInTheDocument();
  });

  it("keeps the chosen compiler and lets the install run the one recompile", async () => {
    mocks.picker.source = "tex-missing";
    mocks.files.engine = { id: "latexmk", allow_shell_escape: false };
    mocks.engine.info = { latexmk_blocker: { code: "tex.latexmk_missing", params: {} } };
    mocks.install.mockImplementation(async () => {
      mocks.engine.info = { latexmk: "/home/ada/.oleafly/tinytex/bin/latexmk" };
    });
    render(<EnginePickerModal />);

    fireEvent.click(screen.getByRole("button", { name: copy.tinytex.download }));

    await waitFor(() => expect(mocks.close).toHaveBeenCalled());
    expect(mocks.queueCompileAfterInstall).toHaveBeenCalledExactlyOnceWith("explicit");
    expect(mocks.setEngine).not.toHaveBeenCalled();
    expect(mocks.recompile).not.toHaveBeenCalled();
  });

  it("stays open when the install didn't make latexmk usable", async () => {
    mocks.picker.source = "tex-missing";
    mocks.files.engine = { id: "latexmk", allow_shell_escape: false };
    mocks.engine.info = { latexmk_blocker: { code: "tex.latexmk_missing", params: {} } };
    render(<EnginePickerModal />);

    fireEvent.click(screen.getByRole("button", { name: copy.tinytex.download }));

    await waitFor(() => expect(mocks.install).toHaveBeenCalled());
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it("does not pin a Tectonic project to a latexmk the install left blocked", async () => {
    mocks.engine.info = null;
    mocks.install.mockImplementation(async () => {
      mocks.engine.info = { latexmk: "C:/MiKTeX/bin/latexmk.exe", latexmk_blocker: needsPerl };
    });
    render(<EnginePickerModal />);

    fireEvent.click(screen.getByRole("button", { name: copy.tinytex.download }));

    await waitFor(() => expect(mocks.install).toHaveBeenCalled());
    expect(mocks.setEngine).not.toHaveBeenCalled();
  });
});
